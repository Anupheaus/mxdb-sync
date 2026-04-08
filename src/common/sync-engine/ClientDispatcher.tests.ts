import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@anupheaus/common'; // ensure Object.clone and other extensions are installed
import type { Logger } from '@anupheaus/common';
import { auditor } from '../auditor';

vi.mock('../auditor/hash', () => ({
  hashRecord: (record: any) => Promise.resolve(`mock-hash-${record.id}`),
  deterministicJson: (v: any) => JSON.stringify(v),
  contentHash: (v: any) => `content-${JSON.stringify(v)}`,
}));
import {
  ClientDispatcher,
  ClientReceiver,
  type MXDBRecordStates,
  type MXDBSyncEngineResponse,
  type MXDBUpdateRequest,
} from '.';

const mockLogger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  silly: vi.fn(),
} as unknown as Logger;

function makeRecord(id: string, name: string) {
  return { id, name };
}

describe('ClientDispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function makeCR() {
    const onRetrieve = vi.fn().mockReturnValue([]);
    const onUpdate = vi.fn().mockReturnValue([]);
    return new ClientReceiver(mockLogger, { onRetrieve, onUpdate });
  }

  it('enqueue is no-op when stopped', () => {
    const cr = makeCR();
    const onDispatch = vi.fn().mockResolvedValue([]);
    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest: vi.fn().mockReturnValue([]),
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate: vi.fn(),
      onStart: vi.fn().mockReturnValue([]),
      timerInterval: 100,
    });

    cd.enqueue({ collectionName: 'items', recordId: 'r1' });
    // Not started, so no dispatch
    vi.runAllTimers();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it('start triggers onStart dispatch', async () => {
    const cr = makeCR();
    const record = makeRecord('r1', 'Alice');
    const audit = auditor.createAuditFrom(record);

    const onStart = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record, audit: audit.entries }],
    }]);

    const onDispatch = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1'],
    }]);

    const onUpdate = vi.fn();

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest: vi.fn().mockReturnValue([]),
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate,
      onStart,
      timerInterval: 100,
    });

    cd.start();
    await vi.runAllTimersAsync();

    expect(onStart).toHaveBeenCalledOnce();
    expect(onDispatch).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledOnce();
  });

  it('stop invalidates in-flight response (epoch mismatch)', async () => {
    const cr = makeCR();
    let resolveDispatch: (v: MXDBSyncEngineResponse) => void;

    const onDispatch = vi.fn().mockImplementation(() =>
      new Promise<MXDBSyncEngineResponse>(resolve => { resolveDispatch = resolve; }),
    );

    const onUpdate = vi.fn();
    const onStart = vi.fn().mockReturnValue([]);

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest: vi.fn().mockReturnValue([]),
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate,
      onStart,
      timerInterval: 100,
    });

    cd.start();
    await vi.runAllTimersAsync();

    // stop() before dispatch resolves
    cd.stop();

    // Now resolve the dispatch
    resolveDispatch!([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
    await vi.runAllTimersAsync();

    // onUpdate should NOT have been called due to epoch mismatch
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('timer fires after enqueue', async () => {
    const cr = makeCR();
    const record = makeRecord('r1', 'Alice');
    const audit = auditor.createAuditFrom(record);

    const onPayloadRequest = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record, audit: audit.entries }],
    }]);

    const onDispatch = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1'],
    }]);

    const onUpdate = vi.fn();

    // onStart returns empty to skip initial dispatch quickly
    const onStart = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record, audit: audit.entries }],
    }]);

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest,
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate,
      onStart,
      timerInterval: 50,
    });

    cd.start();
    await vi.runAllTimersAsync(); // process initial onStart

    // Now enqueue something
    cd.enqueue({ collectionName: 'items', recordId: 'r1' });
    await vi.runAllTimersAsync(); // timer fires

    expect(onPayloadRequest).toHaveBeenCalled();
  });

  it('onUpdate is called on success with correct data', async () => {
    const cr = makeCR();
    const record = makeRecord('r1', 'Alice');
    const audit = auditor.createAuditFrom(record);

    const onStart = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record, audit: audit.entries }],
    }]);

    const onDispatch = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1'],
    }]);

    const onUpdate = vi.fn();

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest: vi.fn().mockReturnValue([]),
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate,
      onStart,
      timerInterval: 100,
    });

    cd.start();
    await vi.runAllTimersAsync();

    expect(onUpdate).toHaveBeenCalledOnce();
    const updateArg = onUpdate.mock.calls[0][0] as MXDBUpdateRequest;
    expect(updateArg[0].collectionName).toBe('items');
    expect(updateArg[0].records?.[0].record).toEqual(record);
    expect(updateArg[0].records?.[0].lastAuditEntryId).toBeDefined();
  });

  it('duplicate enqueue is no-op', async () => {
    const cr = makeCR();
    const record1 = makeRecord('r1', 'Alice');
    const record2 = makeRecord('r2', 'Bob');
    const audit1 = auditor.createAuditFrom(record1);
    const audit2 = auditor.createAuditFrom(record2);

    const onPayloadRequest = vi.fn().mockImplementation((req: any) => {
      // Return states for both requested records
      return [{
        collectionName: 'items',
        records: [
          { record: record1, audit: audit1.entries },
          { record: record2, audit: audit2.entries },
        ],
      }];
    });

    const onDispatch = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1', 'r2'],
    }]);
    const onStart = vi.fn().mockReturnValue([]);

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest,
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate: vi.fn(),
      onStart,
      timerInterval: 100,
    });

    cd.start();
    await vi.runAllTimersAsync(); // process onStart

    vi.clearAllMocks();
    cd.enqueue({ collectionName: 'items', recordId: 'r1' });
    cd.enqueue({ collectionName: 'items', recordId: 'r1' }); // duplicate
    cd.enqueue({ collectionName: 'items', recordId: 'r2' }); // different record

    // The queue should only have 2 items (r1 deduplicated)
    await vi.runAllTimersAsync();
    expect(onPayloadRequest).toHaveBeenCalledOnce();
    const requestArg = onPayloadRequest.mock.calls[0][0];
    expect(requestArg[0].recordIds).toHaveLength(2);
    expect(requestArg[0].recordIds).toContain('r1');
    expect(requestArg[0].recordIds).toContain('r2');
  });

  it('start is idempotent', async () => {
    const cr = makeCR();
    const onStart = vi.fn().mockReturnValue([]);
    const onDispatch = vi.fn().mockResolvedValue([]);

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest: vi.fn().mockReturnValue([]),
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate: vi.fn(),
      onStart,
      timerInterval: 100,
    });

    cd.start();
    cd.start(); // should be no-op
    await vi.runAllTimersAsync();

    expect(onStart).toHaveBeenCalledOnce();
  });

  it('re-enqueues a record whose enqueue arrived while it was in-flight', async () => {
    // Regression: if enqueue(X) is called while X is already being dispatched,
    // the original enqueue() used to no-op (because X was already in the queue),
    // and #processSuccessResponse then removed X — silently losing the update.
    // #pendingReEnqueue must capture this case and re-queue X after success.
    const cr = makeCR();
    const record = makeRecord('r1', 'Alice');
    const audit = auditor.createAuditFrom(record);

    let resolveDispatch: (v: MXDBSyncEngineResponse) => void;
    const onDispatch = vi.fn().mockImplementation(() =>
      new Promise<MXDBSyncEngineResponse>(resolve => { resolveDispatch = resolve; }),
    );

    const onPayloadRequest = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record, audit: audit.entries }],
    }]);

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest,
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate: vi.fn(),
      onStart: vi.fn().mockReturnValue([]),
      timerInterval: 50,
    });

    cd.start();
    await vi.runAllTimersAsync(); // initial onStart completes (empty)

    // First enqueue — kicks off a timer tick + dispatch that we keep pending
    cd.enqueue({ collectionName: 'items', recordId: 'r1' });
    await vi.advanceTimersByTimeAsync(50); // fire the timer
    // dispatch is now in-flight (waiting on resolveDispatch)

    // While in-flight, enqueue r1 again — this is the racing update
    cd.enqueue({ collectionName: 'items', recordId: 'r1' });

    // Resolve the in-flight dispatch successfully
    resolveDispatch!([{ collectionName: 'items', successfulRecordIds: ['r1'] }]);
    await vi.runAllTimersAsync();

    // The timer should have been restarted to pick up the re-enqueued record,
    // and a second dispatch should have fired for r1.
    expect(onDispatch).toHaveBeenCalledTimes(2);
  });

  it('drops queue entries whose state has disappeared before dispatch', async () => {
    // Regression: if a record is deleted locally (e.g. by an incoming S2C push)
    // while it sits in the CD queue, onPayloadRequest will not return a state
    // for it. Without the drop-filter, the stale queue entry would live forever.
    const cr = makeCR();
    const record1 = makeRecord('r1', 'Alice');
    const record2 = makeRecord('r2', 'Bob');
    const audit1 = auditor.createAuditFrom(record1);
    const audit2 = auditor.createAuditFrom(record2);

    // onPayloadRequest returns ONLY r2 — r1 has disappeared locally
    const onPayloadRequest = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record: record2, audit: audit2.entries }],
    }]);

    const onDispatch = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r2'],
    }]);

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest,
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate: vi.fn(),
      onStart: vi.fn().mockReturnValue([]),
      timerInterval: 50,
    });

    cd.start();
    await vi.runAllTimersAsync(); // onStart completes (dispatches empty)

    onDispatch.mockClear();
    cd.enqueue({ collectionName: 'items', recordId: 'r1' });
    cd.enqueue({ collectionName: 'items', recordId: 'r2' });
    await vi.runAllTimersAsync();

    // dispatch called with only r2 (r1 disappeared → filtered out)
    expect(onDispatch).toHaveBeenCalled();
    const dispatchArg = onDispatch.mock.calls[0][0];
    const ids = dispatchArg[0].records.map((r: any) => r.id);
    expect(ids).toEqual(['r2']);

    // After completion, no second dispatch should be scheduled for orphan r1
    vi.clearAllMocks();
    await vi.runAllTimersAsync();
    expect(onDispatch).not.toHaveBeenCalled();
  });

  it('uses the last audit entry (insertion order) for lastAuditEntryId, not the max ULID', async () => {
    // Regression: getLastEntryId previously picked the entry with the largest
    // ULID. After collapseToAnchor, the audit may look like:
    //   [Branched(server-ulid-NEW), Updated(client-ulid-OLD)]
    // where the Branched anchor's id is lexicographically greater than the
    // client-generated Updated id. Picking the max would return the anchor,
    // leaving pending Updated entries after the collapse point — the audit
    // would never become branch-only again. Fix: use insertion order.
    const cr = makeCR();
    const record = makeRecord('r1', 'Alice');

    // Hand-crafted audit: a Branched entry with a high ULID followed by an
    // Updated entry with a lower ULID (out-of-order vs. ULID sort).
    const audit = [
      { id: 'zzz-high-branched-anchor', type: 3 /* Branched */, at: 1, by: 'srv', changes: {} },
      { id: 'aaa-low-client-update', type: 2 /* Updated */, at: 2, by: 'cli', changes: { name: { from: 'Alice', to: 'Bob' } } },
    ] as any;

    const onStart = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record, audit }],
    }]);

    const onDispatch = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1'],
    }]);

    const onUpdate = vi.fn();

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest: vi.fn().mockReturnValue([]),
      onDispatching: vi.fn(),
      onDispatch,
      onUpdate,
      onStart,
      timerInterval: 100,
    });

    cd.start();
    await vi.runAllTimersAsync();

    expect(onUpdate).toHaveBeenCalledOnce();
    const updateArg = onUpdate.mock.calls[0][0] as MXDBUpdateRequest;
    // Must be the insertion-order last entry ('aaa-low-client-update'), NOT
    // the max-ULID entry ('zzz-high-branched-anchor').
    expect(updateArg[0].records?.[0].lastAuditEntryId).toBe('aaa-low-client-update');
  });

  it('onDispatching is called true/false around dispatch', async () => {
    const cr = makeCR();
    const onDispatching = vi.fn();
    const record = makeRecord('r1', 'Alice');
    const audit = auditor.createAuditFrom(record);

    const onStart = vi.fn().mockReturnValue([{
      collectionName: 'items',
      records: [{ record, audit: audit.entries }],
    }]);
    const onDispatch = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1'],
    }]);

    const cd = new ClientDispatcher(mockLogger, {
      clientReceiver: cr,
      onPayloadRequest: vi.fn().mockReturnValue([]),
      onDispatching,
      onDispatch,
      onUpdate: vi.fn(),
      onStart,
      timerInterval: 100,
    });

    cd.start();
    await vi.runAllTimersAsync();

    expect(onDispatching).toHaveBeenCalledWith(true);
    expect(onDispatching).toHaveBeenCalledWith(false);
  });
});
