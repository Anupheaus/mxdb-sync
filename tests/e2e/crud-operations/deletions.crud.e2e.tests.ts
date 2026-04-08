import { decodeTime } from 'ulidx';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditEntryType } from '../../../src/common';
import type { E2eTestRecord } from '../setup/types';
import {
  resetE2E,
  setupE2E,
  teardownE2E,
  useClient,
  useServer,
  waitForAllClientsIdle,
  waitForLiveRecordAbsent,
} from '../setup';
import {
  expectNoLocalRowOrAuditOnClients,
  getServerAudit,
  getLastLocalAuditEntry,
  mainAuditTypes,
  newRecordId,
  seedRowWithBOnGetAll,
  connectBoth,
} from './utils';

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
    const id = newRecordId('e2e-del');
    await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await a.remove(id);
    await waitForLiveRecordAbsent(id);

    const offlineEdit: E2eTestRecord = {
      id,
      clientId: 'b',
      value: 'b-offline-after-server-delete',
    };
    await b.upsert(offlineEdit);

    await b.reconnect();

    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audits = await useServer().readAudits();
    const audit = audits.get(id);
    expect(audit).toBeDefined();

    const main = mainAuditTypes(audit!.entries.map(e => e.type));
    expect(main.slice(0, 3)).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
      AuditEntryType.Updated,
    ]);
  }, 120_000);

  it('B on get-all, offline while A deletes on server: after reconnect and sync, B has no local row', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-offline');
    await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await a.remove(id);
    await waitForLiveRecordAbsent(id);

    await b.reconnect();

    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = (await useServer().readAudits()).get(id);
    expect(audit).toBeDefined();
    expect(mainAuditTypes(audit!.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
    ]);
  }, 120_000);

  it('both clients on get-all, A deletes while connected: B loses live row; audit create → delete', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-online');
    await seedRowWithBOnGetAll(a, b, id);

    await a.remove(id);
    await waitForLiveRecordAbsent(id);
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = (await useServer().readAudits()).get(id);
    expect(audit).toBeDefined();
    expect(mainAuditTypes(audit!.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
    ]);
  }, 120_000);

  it('both on get-all, B deletes while connected (A created row): A loses live row; audit create → delete', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-b-on-a-row');
    await seedRowWithBOnGetAll(a, b, id);

    await b.remove(id);
    await waitForLiveRecordAbsent(id);
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = (await useServer().readAudits()).get(id);
    expect(audit).toBeDefined();
    expect(mainAuditTypes(audit!.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
    ]);
  }, 120_000);

  it('A offline after create, B on get-all deletes, A reconnects: both have no live row', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-a-offline');
    await seedRowWithBOnGetAll(a, b, id);

    await a.disconnect();

    await b.remove(id);
    await waitForLiveRecordAbsent(id);

    await a.reconnect();

    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = (await useServer().readAudits()).get(id);
    expect(audit).toBeDefined();
    expect(mainAuditTypes(audit!.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
    ]);
  }, 120_000);

  it('B offline remove then A removes: server audit delete entries match gesture order (B ULID before A)', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-double');
    await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await b.remove(id);
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id))!;
    expect(bEntry).toBeDefined();
    expect(bEntry.type).toBe(AuditEntryType.Deleted);

    await a.remove(id);
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id))!;
    expect(aEntry).toBeDefined();
    expect(aEntry.type).toBe(AuditEntryType.Deleted);
    expect(decodeTime(bEntry.id)).toBeLessThan(decodeTime(aEntry.id));

    await waitForLiveRecordAbsent(id);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
      AuditEntryType.Deleted,
    ]);
    const delEntries = audit.entries.filterBy('type', AuditEntryType.Deleted);
    expect(delEntries.ids()).toEqual([bEntry.id, aEntry.id]);
  }, 120_000);

  it('B offline remove only (A does not delete): server and A lose live row after B reconnects', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-b-offline');
    await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await b.remove(id);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);
    await waitForLiveRecordAbsent(id);
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = await getServerAudit(id);
    expect(audit.entries.map(e => e.type)).toEqual([AuditEntryType.Created, AuditEntryType.Deleted]);
  }, 120_000);

  it('A offline remove then B removes on server: gesture order preserved on merged audit', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-a-queue-b');
    await seedRowWithBOnGetAll(a, b, id);

    await a.disconnect();

    await a.remove(id);
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id))!;
    expect(aEntry).toBeDefined();
    expect(aEntry.type).toBe(AuditEntryType.Deleted);

    await b.remove(id);
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id))!;
    expect(bEntry).toBeDefined();
    expect(bEntry.type).toBe(AuditEntryType.Deleted);
    expect(decodeTime(aEntry.id)).toBeLessThan(decodeTime(bEntry.id));

    await waitForLiveRecordAbsent(id);

    await a.reconnect();
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const serverAudit = await getServerAudit(id);
    expect(mainAuditTypes(serverAudit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
      AuditEntryType.Deleted,
    ]);
    const entries = serverAudit.entries.filterBy('type', AuditEntryType.Deleted);
    expect(entries).toHaveLength(2);
    expect(entries.ids()).toEqual([aEntry.id, bEntry.id]);
  }, 120_000);

  it('B offline update before A deletes: after reconnect no live row; audit create → update → delete', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-upd-first');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await b.upsert({
      ...created,
      clientId: 'b',
      value: 'b-offline-before-delete',
    });
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id))!;

    await a.remove(id);
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id))!;

    await waitForLiveRecordAbsent(id);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = await getServerAudit(id);
    expect(audit.entries.map(e => e.type)).toEqual([AuditEntryType.Created, AuditEntryType.Updated, AuditEntryType.Deleted]);
    const deletedEntries = audit.entries.filterBy('type', AuditEntryType.Deleted);
    expect(deletedEntries.ids()).toEqual([aEntry.id]);
    expect(decodeTime(bEntry.id)).toBeLessThan(decodeTime(aEntry.id));
    const updatedEntries = audit.entries.filterBy('type', AuditEntryType.Updated);
    expect(updatedEntries.ids()).toEqual([bEntry.id]);
  }, 120_000);

  it('two offline updates on B after A deletes: no live row; first main entries create → delete → update', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-multi-upd');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await a.remove(id);
    await waitForLiveRecordAbsent(id);

    await b.upsert({ ...created, clientId: 'b', value: 'b-offline-1' });
    await b.upsert({ ...created, clientId: 'b', value: 'b-offline-2' });

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = await getServerAudit(id);
    expect(audit).toBeDefined();
    expect(audit.entries.map(e => e.type)).toEqual([AuditEntryType.Created, AuditEntryType.Deleted, AuditEntryType.Updated, AuditEntryType.Updated]);
  }, 120_000);

  it('A deletes while connected, B issues second remove: two deletes in gesture order on server audit', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-idem');
    await seedRowWithBOnGetAll(a, b, id);

    await a.remove(id);
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id));
    expect(aEntry).toBeDefined();

    await waitForLiveRecordAbsent(id);
    await waitForAllClientsIdle([a, b]);

    expect(await b.getLocalRecord(id)).toBeUndefined();
    await b.remove(id);

    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
    ]);
    const deletedEntries = audit.entries.filterBy('type', AuditEntryType.Deleted);
    expect(deletedEntries.ids()).toEqual([aEntry!.id]);
  }, 120_000);

  it('both offline, A remove then B remove: merged audit deletes match that gesture order', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-both-off');
    await seedRowWithBOnGetAll(a, b, id);

    await a.disconnect();
    await b.disconnect();

    await a.remove(id);
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id));
    expect(aEntry).toBeDefined();

    await b.remove(id);
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id));
    expect(bEntry).toBeDefined();

    expect(decodeTime(aEntry!.id)).toBeLessThan(decodeTime(bEntry!.id));

    await a.reconnect();
    await waitForAllClientsIdle([a]);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await waitForLiveRecordAbsent(id);
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
      AuditEntryType.Deleted,
    ]);
    const deletedEntries = audit.entries.filterBy('type', AuditEntryType.Deleted);
    expect(deletedEntries).toHaveLength(2);
    expect(deletedEntries.ids()).toEqual([aEntry!.id, bEntry!.id]);
  }, 120_000);

  it('A creates and deletes while B offline without get-all; B reconnects and subscribes: never sees row', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-del-b-never-saw');

    await connectBoth(a, b);
    await b.disconnect();

    await a.upsert({
      id,
      clientId: 'a',
      value: 'short-lived',
    });
    await useServer().waitForLiveRecord(id);
    await a.remove(id);
    await waitForLiveRecordAbsent(id);

    await b.reconnect();
    await b.subscribeGetAll();
    await waitForAllClientsIdle([a, b]);

    await expectNoLocalRowOrAuditOnClients([a, b], [id]);
    expect(b.getGetAllSubscriptionSnapshot().ids().includes(id)).toBe(false);

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Deleted,
    ]);
  }, 120_000);

  // it('B deletes on server, A offline upsert after tombstone: both clients end with no live row', async () => {
  //   const a = useClient('a');
  //   const b = useClient('b');
  //   const id = newRecordId('e2e-del-a-after-b-del');
  //   const created = await seedRowWithBOnGetAll(a, b, id);

  //   await b.remove(id);
  //   await waitForLiveRecordAbsent(id);
  //   await waitForAllClientsIdle([a, b]);

  //   a.disconnect();
  //   await waitUntilAsync(async () => !a.getIsConnected(), 'A disconnected', 10_000);

  //   await a.upsert({
  //     ...created,
  //     clientId: 'a',
  //     value: 'a-offline-after-b-delete',
  //   });

  //   a.reconnect();
  //   await waitUntilAsync(async () => a.getIsConnected(), 'A reconnected', 30_000);
  //   await waitForAllClientsIdle([a, b]);

  //   expect(await a.getLocalRecord(id)).toBeUndefined();
  //   expect(await b.getLocalRecord(id)).toBeUndefined();

  //   const audit = (await useServer().readAudits()).get(id);
  //   expect(audit).toBeDefined();
  //   expect(mainAuditTypes(audit!.entries.map(e => e.type))[0]).toBe(AuditEntryType.Created);
  //   expect(mainAuditTypes(audit!.entries.map(e => e.type)).includes(AuditEntryType.Deleted)).toBe(true);

  //   // TODO: When C2S persists the client’s post-tombstone write here, assert server entries sort as
  //   // Created → Deleted → Updated|Restored with decodeTime(delete.id) < decodeTime(resurrection.id).
  // }, 120_000);

  // it('B subscribes get-all only after A deleted: empty local state for that id', async () => {
  //   const a = useClient('a');
  //   const b = useClient('b');
  //   const id = newRecordId('e2e-del-sub-late');

  //   await connectBoth(a, b);
  //   await a.upsert({
  //     id,
  //     clientId: 'a',
  //     value: 'gone-before-b-subscribes',
  //   });
  //   await useServer().waitForLiveRecord(id);
  //   await a.remove(id);
  //   await waitForLiveRecordAbsent(id);
  //   await waitForAllClientsIdle([a, b]);

  //   await b.subscribeGetAll();
  //   await waitForAllClientsIdle([a, b]);

  //   expect(await b.getLocalRecord(id)).toBeUndefined();
  // }, 120_000);

  // it('B disconnected before row exists; A creates then deletes; B reconnects and get-all: no row', async () => {
  //   const a = useClient('a');
  //   const b = useClient('b');
  //   const id = newRecordId('e2e-del-b-away-churn');

  //   await connectBoth(a, b);
  //   b.disconnect();
  //   await waitUntilAsync(async () => !b.getIsConnected(), 'B disconnected', 10_000);

  //   await a.upsert({
  //     id,
  //     clientId: 'a',
  //     value: 'churn',
  //   });
  //   await useServer().waitForLiveRecord(id);
  //   await a.remove(id);
  //   await waitForLiveRecordAbsent(id);

  //   b.reconnect();
  //   await waitUntilAsync(async () => b.getIsConnected(), 'B reconnected', 30_000);
  //   await b.subscribeGetAll();
  //   await waitForAllClientsIdle([a, b]);

  //   expect(await b.getLocalRecord(id)).toBeUndefined();
  // }, 120_000);
});
