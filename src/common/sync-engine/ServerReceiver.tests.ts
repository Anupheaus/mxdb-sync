import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@anupheaus/common'; // ensure Object.clone and other extensions are installed
import type { Logger } from '@anupheaus/common';
import { auditor, AuditEntryType } from '../auditor';
import {
  ServerReceiver,
  ServerDispatcher,
  type MXDBRecordStates,
  type ClientDispatcherRequest,
} from '.';

vi.mock('../auditor/hash', () => ({
  hashRecord: (record: any) => Promise.resolve(`mock-hash-${record.id}`),
  deterministicJson: (v: any) => JSON.stringify(v),
  contentHash: (v: any) => `content-${JSON.stringify(v)}`,
}));

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

describe('ServerReceiver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeSD() {
    // onDispatch returns success for all records in the payload to prevent infinite retry loops
    const onDispatch = vi.fn().mockImplementation(async (payload: any) => {
      return payload.map((col: any) => ({
        collectionName: col.collectionName,
        successfulRecordIds: col.records.map((r: any) => r.record?.id ?? r.recordId),
      }));
    });
    const sd = new ServerDispatcher(mockLogger, { onDispatch });
    return { sd, onDispatch };
  }

  it('pauses and resumes SD during process', async () => {
    const { sd } = makeSD();
    const pauseSpy = vi.spyOn(sd, 'pause');
    const resumeSpy = vi.spyOn(sd, 'resume');

    const onRetrieve = vi.fn().mockResolvedValue([]);
    const onUpdate = vi.fn().mockResolvedValue([]);
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    await sr.process([]);
    expect(pauseSpy).toHaveBeenCalledOnce();
    expect(resumeSpy).toHaveBeenCalledOnce();
  });

  it('resumes SD even if onUpdate throws', async () => {
    const { sd } = makeSD();
    const resumeSpy = vi.spyOn(sd, 'resume');

    const onRetrieve = vi.fn().mockResolvedValue([]);
    const onUpdate = vi.fn().mockRejectedValue(new Error('DB error'));
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    const record = makeRecord('r1', 'Alice');
    const audit = auditor.createAuditFrom(record);
    const request: ClientDispatcherRequest = [{
      collectionName: 'items',
      records: [{ id: 'r1', hash: 'mock-hash-r1', entries: audit.entries }],
    }];

    await expect(sr.process(request)).rejects.toThrow('DB error');
    expect(resumeSpy).toHaveBeenCalledOnce();
  });

  it('processes new record with Created entry', async () => {
    const { sd } = makeSD();

    const record = makeRecord('r1', 'Alice');
    const audit = auditor.createAuditFrom(record);

    const onRetrieve = vi.fn().mockResolvedValue([]); // no server state
    const onUpdate = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1'],
    }]);
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    const request: ClientDispatcherRequest = [{
      collectionName: 'items',
      records: [{ id: 'r1', hash: 'mock-hash-r1', entries: audit.entries }],
    }];

    const result = await sr.process(request);
    expect(onUpdate).toHaveBeenCalledOnce();
    const successIds = result.find(r => r.collectionName === 'items')?.successfulRecordIds ?? [];
    expect(successIds).toContain('r1');
  });

  it('skips new record if first entry is not Created', async () => {
    const { sd } = makeSD();

    const onRetrieve = vi.fn().mockResolvedValue([]);
    const onUpdate = vi.fn().mockResolvedValue([]);
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    // Entry that is Updated, not Created
    const fakeUpdateEntry = { type: AuditEntryType.Updated, id: 'ulid-1', ops: [] };
    const request: ClientDispatcherRequest = [{
      collectionName: 'items',
      records: [{ id: 'r1', entries: [fakeUpdateEntry as any] }],
    }];

    const result = await sr.process(request);
    expect(mockLogger.error).toHaveBeenCalled();
    const successIds = result.find(r => r.collectionName === 'items')?.successfulRecordIds ?? [];
    expect(successIds).not.toContain('r1');
  });

  it('merges existing record audit', async () => {
    const { sd } = makeSD();

    const record = makeRecord('r1', 'Alice');
    const serverAudit = auditor.createAuditFrom(record);

    const serverStates: MXDBRecordStates = [{
      collectionName: 'items',
      records: [{ record, audit: serverAudit.entries }],
    }];

    const onRetrieve = vi.fn().mockResolvedValue(serverStates);
    const onUpdate = vi.fn().mockResolvedValue([{
      collectionName: 'items',
      successfulRecordIds: ['r1'],
    }]);
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    // Client sends an update
    const updatedRecord = makeRecord('r1', 'Bob');
    const clientAudit = auditor.updateAuditWith(updatedRecord, serverAudit);

    const request: ClientDispatcherRequest = [{
      collectionName: 'items',
      records: [{ id: 'r1', hash: 'mock-hash-r1', entries: clientAudit.entries }],
    }];

    const result = await sr.process(request);
    expect(onUpdate).toHaveBeenCalledOnce();
    const successIds = result.find(r => r.collectionName === 'items')?.successfulRecordIds ?? [];
    expect(successIds).toContain('r1');

    // Verify the merged state was passed to onUpdate
    const updateArg = onUpdate.mock.calls[0][0] as MXDBRecordStates;
    const updatedState = updateArg[0]?.records[0];
    expect('record' in updatedState!).toBe(true);
  });

  it('handles branched-only active record — seeds filter, no onUpdate', async () => {
    const { sd } = makeSD();
    const updateFilterSpy = vi.spyOn(sd, 'updateFilter');

    const record = makeRecord('r1', 'Alice');
    const serverAudit = auditor.createAuditFrom(record);
    const branchId = auditor.generateUlid();
    const branchedAudit = auditor.collapseToAnchor(serverAudit, branchId);

    const serverStates: MXDBRecordStates = [{
      collectionName: 'items',
      records: [{ record, audit: serverAudit.entries }],
    }];

    const onRetrieve = vi.fn().mockResolvedValue(serverStates);
    const onUpdate = vi.fn().mockResolvedValue([]);
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    // Branched-only request (only Branched entry, stripped = empty)
    const request: ClientDispatcherRequest = [{
      collectionName: 'items',
      records: [{ id: 'r1', hash: 'mock-hash-r1', entries: branchedAudit.entries }],
    }];

    const result = await sr.process(request);

    // onUpdate should not be called since there are no pending changes
    expect(onUpdate).not.toHaveBeenCalled();

    // r1 should still be in successfulRecordIds
    const successIds = result.find(r => r.collectionName === 'items')?.successfulRecordIds ?? [];
    expect(successIds).toContain('r1');

    // updateFilter should have been called with the seed
    expect(updateFilterSpy).toHaveBeenCalled();
  });

  it('pushes cursor to SD when server hash differs from client hash', async () => {
    const { sd } = makeSD();
    const pushSpy = vi.spyOn(sd, 'push');

    const record = makeRecord('r1', 'Alice');
    const serverAudit = auditor.createAuditFrom(record);
    const branchId = auditor.generateUlid();
    const branchedAudit = auditor.collapseToAnchor(serverAudit, branchId);

    const serverStates: MXDBRecordStates = [{
      collectionName: 'items',
      records: [{ record, audit: serverAudit.entries }],
    }];

    const onRetrieve = vi.fn().mockResolvedValue(serverStates);
    const onUpdate = vi.fn().mockResolvedValue([]);
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    // Client sends branched-only with a DIFFERENT hash
    const request: ClientDispatcherRequest = [{
      collectionName: 'items',
      records: [{ id: 'r1', hash: 'different-hash', entries: branchedAudit.entries }],
    }];

    await sr.process(request);
    // Server hash is mock-hash-r1, client hash is different-hash — should push
    expect(pushSpy).toHaveBeenCalledOnce();
  });

  it('does not push when hashes match (client already up to date)', async () => {
    const { sd } = makeSD();
    const pushSpy = vi.spyOn(sd, 'push');

    const record = makeRecord('r1', 'Alice');
    const serverAudit = auditor.createAuditFrom(record);
    const branchId = auditor.generateUlid();
    const branchedAudit = auditor.collapseToAnchor(serverAudit, branchId);

    const serverStates: MXDBRecordStates = [{
      collectionName: 'items',
      records: [{ record, audit: serverAudit.entries }],
    }];

    const onRetrieve = vi.fn().mockResolvedValue(serverStates);
    const onUpdate = vi.fn().mockResolvedValue([]);
    const sr = new ServerReceiver(mockLogger, { onRetrieve, onUpdate, serverDispatcher: sd });

    // Client hash matches server hash (mock-hash-r1)
    const request: ClientDispatcherRequest = [{
      collectionName: 'items',
      records: [{ id: 'r1', hash: 'mock-hash-r1', entries: branchedAudit.entries }],
    }];

    await sr.process(request);
    expect(pushSpy).not.toHaveBeenCalled();
  });
});
