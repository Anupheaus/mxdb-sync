import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Logger } from '@anupheaus/common';
import {
  ServerDispatcher,
  SyncPausedError,
  type MXDBRecordCursors,
  type ServerDispatcherFilter,
} from '.';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  silly: vi.fn(),
} as unknown as Logger;

function makeActiveCursor(id: string, hash: string, lastAuditEntryId: string) {
  return { record: { id }, lastAuditEntryId, hash } as any;
}

function makeDeletedCursor(recordId: string, lastAuditEntryId: string) {
  return { recordId, lastAuditEntryId };
}

describe('ServerDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  describe('pause / resume', () => {
    it('pause is idempotent', async () => {
      const onDispatch = vi.fn().mockResolvedValue([]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });
      sd.pause();
      sd.pause(); // no-op
      // Push something — should not dispatch since paused
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash1', 'u1')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it('resume calls dispatch if not in-flight and queue non-empty', async () => {
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });
      sd.pause();
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash1', 'u1')] }]);
      expect(onDispatch).not.toHaveBeenCalled();
      sd.resume();
      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();
    });
  });

  describe('push and dispatch', () => {
    it('dispatches immediately when not paused', async () => {
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash1', 'u1')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();
    });

    it('skips dispatch when fresh request is empty (all filtered)', async () => {
      // Set up a filter where the record is already up to date
      const onDispatch = vi.fn().mockResolvedValue([]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Add to filter first
      const filter: ServerDispatcherFilter[] = [{
        collectionName: 'items',
        records: [{ id: 'r1', hash: 'hash1', lastAuditEntryId: 'u1' }],
      }];
      sd.updateFilter(filter);

      // Push same record with same hash+lastAuditEntryId
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash1', 'u1')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it('dispatches when record hash differs from filter', async () => {
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      const filter: ServerDispatcherFilter[] = [{
        collectionName: 'items',
        records: [{ id: 'r1', hash: 'old-hash', lastAuditEntryId: 'u1' }],
      }];
      sd.updateFilter(filter);

      // Push with new hash
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'new-hash', 'u2')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();
    });
  });

  describe('filter management', () => {
    it('updateFilter merges records — updates or adds, never removes', async () => {
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r2'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      sd.updateFilter([{
        collectionName: 'items',
        records: [
          { id: 'r1', hash: 'hash1', lastAuditEntryId: 'u1' },
          { id: 'r2', hash: 'hash2', lastAuditEntryId: 'u2' },
        ],
      }]);

      // Update filter — r1 updated, r2 unchanged, r3 new
      sd.updateFilter([{
        collectionName: 'items',
        records: [
          { id: 'r1', hash: 'hash1-new', lastAuditEntryId: 'u3' },
          { id: 'r3', hash: 'hash3', lastAuditEntryId: 'u4' },
        ],
      }]);

      // Push r2 with new hash — should dispatch since it differs
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r2', 'hash2-new', 'u5')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();
    });

    it('registers deletedRecordIds into internal set', async () => {
      const onDispatch = vi.fn().mockResolvedValue([]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      sd.updateFilter([{
        collectionName: 'items',
        records: [],
        deletedRecordIds: ['deleted-r1', 'deleted-r2'],
      }]);

      // Push an update for deleted record — should be skipped
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('deleted-r1', 'hash1', 'u1')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it('delete wins over update in squash', async () => {
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Add r1 to filter so the SD knows the client has it
      sd.updateFilter([{
        collectionName: 'items',
        records: [{ id: 'r1', hash: 'hash1', lastAuditEntryId: 'u1' }],
      }]);

      // Pause first so both items are in queue before dispatch runs
      sd.pause();
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash2', 'u2')] }]);
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u3')] }]);
      sd.resume();

      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();
      const arg = onDispatch.mock.calls[0][0] as MXDBRecordCursors;
      const rec = arg[0]?.records[0];
      expect('recordId' in rec).toBe(true);
      expect((rec as any).recordId).toBe('r1');
    });

    it('successful delete removes from filter and adds to deletedRecordIds', async () => {
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Add to filter
      sd.updateFilter([{
        collectionName: 'items',
        records: [{ id: 'r1', hash: 'hash1', lastAuditEntryId: 'u1' }],
      }]);

      // Push delete
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u2')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();

      // After success, r1 should be in deletedRecordIds — subsequent update should be skipped
      vi.clearAllMocks();
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash2', 'u3')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it('unsuccessful delete marks record as pending deletion (hash absent)', async () => {
      // First call: delete fails. Second call (retry): returns success to stop the loop.
      let callCount = 0;
      const onDispatch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) return [{ collectionName: 'items', successfulRecordIds: [] }]; // delete fails
        return [{ collectionName: 'items', successfulRecordIds: ['r1'] }]; // retry succeeds
      });
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Add to filter
      sd.updateFilter([{
        collectionName: 'items',
        records: [{ id: 'r1', hash: 'hash1', lastAuditEntryId: 'u1' }],
      }]);

      // Push delete that initially fails
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u2')] }]);
      // Run only one tick to get the first dispatch
      await vi.runAllTimersAsync();

      // onDispatch called at least once (the failed delete)
      expect(onDispatch.mock.calls.length).toBeGreaterThanOrEqual(1);
    });

    it('pending deletion filter re-sends delete cursor when update is pushed', async () => {
      // SD with a filter showing r1 as pending deletion (hash absent)
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });
      sd.updateFilter([{
        collectionName: 'items',
        records: [{ id: 'r1', lastAuditEntryId: 'u2' }], // no hash = pending deletion
      }]);
      // Push an update — should be converted to delete cursor
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash2', 'u3')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();
      const arg = onDispatch.mock.calls[0][0] as MXDBRecordCursors;
      const rec = arg[0]?.records[0];
      expect('recordId' in rec).toBe(true);
    });
  });

  describe('delete-is-final semantics', () => {
    it('successful delete for a record never seen in filter still populates deletedRecordIds', async () => {
      // Regression: previously there was a `wasInFilter` gate that prevented the id
      // from being added to #deletedRecordIds when the record had never been in the
      // filter. That left the SD blind to stale active cursors arriving later via
      // bootstrap / concurrent routes, allowing resurrection races.
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // NOTE: no updateFilter call — r1 has never been in the filter
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u1')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).toHaveBeenCalledOnce();

      // A subsequent active cursor for r1 must be filtered out — delete is final,
      // even though r1 was never in the filter when the delete arrived.
      vi.clearAllMocks();
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash-new', 'u2')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it('sends delete cursors through even when record is unknown to filter', async () => {
      // The CR handles "no local state" deletes as already-consistent, so the SD
      // must not swallow delete cursors just because the record isn't tracked in
      // its filter. Previously a scaffolded "deferred deletes" path dropped these.
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['unknown-r'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Empty filter — unknown-r has never been seen
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('unknown-r', 'u1')] }]);
      await vi.runAllTimersAsync();

      expect(onDispatch).toHaveBeenCalledOnce();
      const arg = onDispatch.mock.calls[0][0] as MXDBRecordCursors;
      expect(arg[0].records).toHaveLength(1);
      expect((arg[0].records[0] as any).recordId).toBe('unknown-r');
    });

    it('change-stream delete (addToFilter=false) for unknown record still records tombstone', async () => {
      // Regression: previously, when the change-stream delete fan-out arrived for a
      // record that wasn't in the SD's per-connection filter, the SD dropped the
      // delete cursor AND did not record the tombstone. Any pre-delete active cursor
      // for the same id that was already queued (e.g. queued before the delete from
      // a parallel `pushActive` path) would then dispatch later and resurrect the
      // record on the CR. Stress test repro: a client reconnected after a server
      // restart, several pre-delete active cursors were queued, the change-stream
      // delete fanned out, was dropped here, then the queued active cursor landed
      // and re-created the record on the client.
      const onDispatch = vi.fn().mockResolvedValue([]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Step 1: change-stream delete for an unknown record — should be dropped
      // (nothing dispatched) but the id must still go into #deletedRecordIds.
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u2')] }], false);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();

      // Step 2: a stale pre-delete active cursor (authoritative push) for the same
      // id arrives. With the regression in place, this would dispatch and resurrect
      // the record on the CR. With the fix, #deletedRecordIds blocks it.
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'stale-hash', 'u1')] }], true);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });

    it('blocks active cursors when id is in deletedRecordIds and filterItem is null', async () => {
      // The "filterItem == null" branch for active cursors must still consult
      // deletedRecordIds — otherwise a stale active could slip through if the
      // collection's filterItem has been cleared.
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Seed deletedRecordIds via updateFilter (collection has no tracked records)
      sd.updateFilter([{
        collectionName: 'items',
        records: [],
        deletedRecordIds: ['r1'],
      }]);

      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash1', 'u1')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });
  });

  describe('updateFilter clears premature tombstones', () => {
    it('clears tombstone when client reports active record via updateFilter', async () => {
      // Reproduces the post-restart race:
      // 1. Change-stream delete arrives for unknown record → tombstone recorded
      // 2. Client's CD.start() triggers SR → SR calls updateFilter with the record as active
      // 3. SR detects server deleted → pushes authoritative delete cursor
      // Without the fix, the tombstone from step 1 blocks the delete in step 3.
      const onDispatch = vi.fn().mockResolvedValue([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Step 1: change-stream delete for unknown record → tombstone
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u2')] }], false);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();

      // Step 2: SR seeds filter — client says it has r1 as active
      sd.updateFilter([{
        collectionName: 'items',
        records: [{ id: 'r1', hash: 'hash1', lastAuditEntryId: 'u1' }],
      }]);

      // Step 3: SR pushes authoritative delete (server has deleted r1)
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u3')] }], true);
      await vi.runAllTimersAsync();

      // The delete cursor MUST reach the client — tombstone was cleared by updateFilter
      expect(onDispatch).toHaveBeenCalledOnce();
      const arg = onDispatch.mock.calls[0][0] as MXDBRecordCursors;
      expect(arg[0].records).toHaveLength(1);
      expect((arg[0].records[0] as any).recordId).toBe('r1');
    });

    it('does NOT clear tombstone when client reports deleted record via updateFilter', async () => {
      const onDispatch = vi.fn().mockResolvedValue([]);
      const sd = new ServerDispatcher(mockLogger, { onDispatch });

      // Tombstone via change-stream
      sd.push([{ collectionName: 'items', records: [makeDeletedCursor('r1', 'u2')] }], false);
      await vi.runAllTimersAsync();

      // Client reports r1 as deleted (hash == null) — tombstone should NOT be cleared
      sd.updateFilter([{
        collectionName: 'items',
        records: [{ id: 'r1', lastAuditEntryId: 'u1' }], // no hash = deleted
      }]);

      // A stale active cursor should still be blocked
      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'new-hash', 'u3')] }]);
      await vi.runAllTimersAsync();
      expect(onDispatch).not.toHaveBeenCalled();
    });
  });

  describe('SyncPausedError retry', () => {
    it('schedules retry on SyncPausedError and retries after interval', async () => {
      let callCount = 0;
      const onDispatch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) throw new SyncPausedError();
        return [{ collectionName: 'items', successfulRecordIds: ['r1'] }];
      });
      const sd = new ServerDispatcher(mockLogger, { onDispatch, retryInterval: 100 });

      sd.push([{ collectionName: 'items', records: [makeActiveCursor('r1', 'hash1', 'u1')] }]);
      await vi.runAllTimersAsync();

      expect(onDispatch).toHaveBeenCalledTimes(2);
    });
  });
});
