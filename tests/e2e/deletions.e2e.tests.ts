import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditEntryType } from '../../src/common/auditor';
import type { E2eTestRecord } from './setup';
import {
  auditEntryTypesChronological,
  resetE2E,
  setupE2E,
  teardownE2E,
  useClient,
  useServer,
  waitForAllClientsIdle,
  waitForLiveRecordAbsent,
  waitUntilAsync,
} from './setup';

describe('e2e deletions regression tests', () => {
  beforeAll(async () => {
    await setupE2E();
  }, 90_000);

  beforeEach(async () => {
    await resetE2E();
  });

  afterAll(async () => {
    await teardownE2E();
  }, 30_000);

  it('B subscribed via get-all, offline update after A deletes: both lose live row; audit is create → delete → update', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await Promise.all([a.connect(), b.connect()]);

    const id = `e2e-del-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const created: E2eTestRecord = {
      id,
      clientId: 'a',
      value: 'created-by-a',
    };

    await a.upsert(created);
    await useServer().waitForLiveRecord(id);

    // Equivalent to useGetAll: full-collection subscription so B receives the row from the server.
    await b.subscribeGetAll();
    await waitUntilAsync(
      async () => (await b.getLocalRecord(id)) != null,
      'B local row after get-all subscription',
      30_000,
    );

    b.disconnect();
    await waitUntilAsync(async () => !b.getIsConnected(), 'B disconnected', 10_000);

    await a.remove(id);
    await waitForLiveRecordAbsent(id);

    const offlineEdit: E2eTestRecord = {
      ...created,
      clientId: 'b',
      value: 'b-offline-after-server-delete',
    };
    await b.upsert(offlineEdit);

    b.reconnect();
    await waitUntilAsync(async () => b.getIsConnected(), 'B reconnected', 30_000);

    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toBeUndefined();
    expect(await b.getLocalRecord(id)).toBeUndefined();

    const audits = await useServer().readAudits();
    const audit = audits.get(id);
    expect(audit).toBeDefined();

    const types = auditEntryTypesChronological(audit!);
    const main = types.filter(
      t =>
        t === AuditEntryType.Created
        || t === AuditEntryType.Deleted
        || t === AuditEntryType.Updated,
    );

    expect(main.slice(0, 3)).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
      AuditEntryType.Updated,
    ]);
  }, 120_000);

  it.only('B on get-all, offline while A deletes on server: after reconnect and sync, B has no local row', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await Promise.all([a.connect(), b.connect()]);

    const id = `e2e-del-offline-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const created: E2eTestRecord = {
      id,
      clientId: 'a',
      value: 'created-by-a',
    };

    await a.upsert(created);
    await useServer().waitForLiveRecord(id);

    await b.subscribeGetAll();
    await waitUntilAsync(
      async () => (await b.getLocalRecord(id)) != null,
      'B local row after get-all subscription',
      30_000,
    );

    b.disconnect();
    await waitUntilAsync(async () => !b.getIsConnected(), 'B disconnected', 10_000);

    await a.remove(id);
    await waitForLiveRecordAbsent(id);

    b.reconnect();
    await waitUntilAsync(async () => b.getIsConnected(), 'B reconnected', 30_000);

    await waitForAllClientsIdle([a, b]);

    expect(await b.getLocalRecord(id)).toBeUndefined();
  }, 120_000);
});
