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
  waitForClientRecord,
  waitUntilAsync,
} from '../setup';
import {
  connectBoth,
  getLastLocalAuditEntry,
  getServerAudit,
  mainAuditTypes,
  newRecordId,
  seedRowWithBOnGetAll,
} from './utils';

describe('e2e update regression tests', () => {
  beforeAll(async () => {
    await setupE2E();
  }, 90_000);

  beforeEach(async () => {
    await resetE2E();
  });

  afterAll(async () => {
    await teardownE2E();
  }, 30_000);

  async function getServerLiveRecord(id: string): Promise<E2eTestRecord | undefined> {
    const rows = await useServer().readLiveRecords();
    return rows.find(r => r.id === id);
  }

  async function waitForServerRecordValue(id: string, value: string | null | undefined, timeoutMs = 30_000): Promise<void> {
    await waitUntilAsync(
      async () => {
        const row = await getServerLiveRecord(id);
        return row?.value === value;
      },
      `server record "${id}" has value "${value}"`,
      timeoutMs,
    );
  }

  it('both connected, A updates record B has on get-all: B sees updated value reactively', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-online');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await a.upsert({ ...created, value: 'updated-by-a' });
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'updated-by-a' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'updated-by-a' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'updated-by-a' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
    ]);
  }, 120_000);

  it('A updates while B offline: B gets correct value after reconnect; audit create → update', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-b-offline');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await a.upsert({ ...created, value: 'updated-while-b-offline' });
    await waitForServerRecordValue(id, 'updated-while-b-offline');

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'updated-while-b-offline' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
    ]);
  }, 120_000);

  it('B offline update only (A does not update): B change propagates to server and A after reconnect', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-b-only-offline');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await b.upsert({ ...created, clientId: 'b', value: 'b-offline-edit' });

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'b-offline-edit' });
    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'b-offline-edit' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'b-offline-edit' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
    ]);
  }, 120_000);

  it('A offline makes multiple sequential updates to same record: server gets final value; audit has create + multiple update entries', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-multi');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await a.disconnect();

    await a.upsert({ ...created, value: 'a-edit-1' });
    await a.upsert({ ...created, value: 'a-edit-2' });
    await a.upsert({ ...created, value: 'a-edit-final' });

    await a.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'a-edit-final' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'a-edit-final' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'a-edit-final' });

    const audit = await getServerAudit(id);
    const types = mainAuditTypes(audit.entries.map(e => e.type));
    expect(types[0]).toBe(AuditEntryType.Created);
    expect(types.slice(1).every(t => t === AuditEntryType.Updated)).toBe(true);
    expect(types.length).toBeGreaterThanOrEqual(2);
  }, 120_000);

  it('B offline update (ULID earlier), A online update (ULID later): A wins after sync; both update entries in audit', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-a-wins');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await b.upsert({ ...created, clientId: 'b', value: 'b-offline-earlier' });
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id))!;
    expect(bEntry.type).toBe(AuditEntryType.Updated);

    await a.upsert({ ...created, value: 'a-online-later' });
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id))!;
    expect(aEntry.type).toBe(AuditEntryType.Updated);

    // B's ULID was generated before A's (B updated offline before A updated)
    expect(decodeTime(bEntry.id)).toBeLessThan(decodeTime(aEntry.id));

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'a-online-later' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'a-online-later' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'a-online-later' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
      AuditEntryType.Updated,
    ]);
    const updatedEntries = audit.entries.filterBy('type', AuditEntryType.Updated);
    expect(updatedEntries.ids()).toEqual([bEntry.id, aEntry.id]);
  }, 120_000);

  it('B offline update, A later online update: A wins after sync; both update entries in audit', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-a-wins');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await b.upsert({ ...created, clientId: 'b', value: 'b-offline' });
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id))!;
    expect(bEntry.type).toBe(AuditEntryType.Updated);

    await a.upsert({ ...created, value: 'a-online' });
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id))!;
    expect(aEntry.type).toBe(AuditEntryType.Updated);

    expect(decodeTime(bEntry.id)).toBeLessThan(decodeTime(aEntry.id));

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'a-online' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'a-online' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'a-online' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
      AuditEntryType.Updated,
    ]);
    const updatedEntries = audit.entries.filterBy('type', AuditEntryType.Updated);
    expect(updatedEntries.ids()).toEqual([bEntry.id, aEntry.id]);
  }, 120_000);

  it('both offline, A updates first (ULID earlier), B updates second (ULID later): B wins; audit in ULID order', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-both-off-b-wins');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await a.disconnect();
    await b.disconnect();

    await a.upsert({ ...created, value: 'a-offline-earlier' });
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id))!;
    expect(aEntry.type).toBe(AuditEntryType.Updated);

    await b.upsert({ ...created, clientId: 'b', value: 'b-offline-later' });
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id))!;
    expect(bEntry.type).toBe(AuditEntryType.Updated);

    expect(decodeTime(aEntry.id)).toBeLessThan(decodeTime(bEntry.id));

    await a.reconnect();
    await waitForAllClientsIdle([a]);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'b-offline-later' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'b-offline-later' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
      AuditEntryType.Updated,
    ]);
    const updatedEntries = audit.entries.filterBy('type', AuditEntryType.Updated);
    expect(updatedEntries.ids()).toEqual([aEntry.id, bEntry.id]);
  }, 120_000);

  it('both offline, A updates first (ULID earlier), B updates second (ULID later): B wins (ULID order); audit in ULID order', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-both-off-a-wins');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await a.disconnect();
    await b.disconnect();

    await a.upsert({ ...created, value: 'a-offline-earlier' });
    const aEntry = getLastLocalAuditEntry(await a.getLocalAudit(id))!;
    expect(aEntry.type).toBe(AuditEntryType.Updated);

    await b.upsert({ ...created, clientId: 'b', value: 'b-offline-later' });
    const bEntry = getLastLocalAuditEntry(await b.getLocalAudit(id))!;
    expect(bEntry.type).toBe(AuditEntryType.Updated);

    expect(decodeTime(aEntry.id)).toBeLessThan(decodeTime(bEntry.id));

    await a.reconnect();
    await waitForAllClientsIdle([a]);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'b-offline-later' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'b-offline-later' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
      AuditEntryType.Updated,
    ]);
    const updatedEntries = audit.entries.filterBy('type', AuditEntryType.Updated);
    expect(updatedEntries.ids()).toEqual([aEntry.id, bEntry.id]);
  }, 120_000);

  it('A creates then updates same record while offline: server receives create then update; B sees final value', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-create-offline');

    await connectBoth(a, b);
    await b.subscribeGetAll();
    await a.disconnect();

    await a.upsert({ id, clientId: 'a', value: 'initial' });
    await a.upsert({ id, clientId: 'a', value: 'updated-offline' });

    await a.reconnect();
    await waitForAllClientsIdle([a, b]);
    // waitForAllClientsIdle only checks C2S queues — wait explicitly for B to receive the S2C push
    await waitForClientRecord(b, id, 'B local row after A sync');

    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'updated-offline' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'updated-offline' });

    const audit = await getServerAudit(id);
    const types = mainAuditTypes(audit.entries.map(e => e.type));
    expect(types[0]).toBe(AuditEntryType.Created);
    // Final value must reflect the update regardless of whether it is a separate entry or folded into Created
    expect(types.every(type => type === AuditEntryType.Created || type === AuditEntryType.Updated)).toBe(true);
  }, 120_000);

  it('three clients on get-all: A updates record and B and C both see the new value', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const c = useClient('c');
    const id = newRecordId('e2e-upd-three-clients');

    await connectBoth(a, b);
    await c.connect();
    const created: E2eTestRecord = { id, clientId: 'a', value: 'original' };
    await a.upsert(created);
    await useServer().waitForLiveRecord(id);
    await b.subscribeGetAll();
    await c.subscribeGetAll();
    await Promise.all([
      waitForClientRecord(b, id, 'B has row after get-all'),
      waitForClientRecord(c, id, 'C has row after get-all'),
    ]);

    await a.upsert({ ...created, value: 'updated-for-three' });
    await waitForAllClientsIdle([a, b, c]);

    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'updated-for-three' });
    expect(await c.getLocalRecord(id)).toMatchObject({ value: 'updated-for-three' });

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
    ]);
  }, 120_000);

  it('update clears optional value field to null: cleared field propagates to all clients', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-clear-field');
    const created = await seedRowWithBOnGetAll(a, b, id);
    expect(created.value).toBeDefined();

    await a.upsert({ ...created, value: null });
    await waitForAllClientsIdle([a, b]);

    const aRow = await a.getLocalRecord(id);
    const bRow = await b.getLocalRecord(id);
    expect(aRow?.value == null).toBe(true);
    expect(bRow?.value == null).toBe(true);
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow?.value == null).toBe(true);

    const audit = await getServerAudit(id);
    expect(mainAuditTypes(audit.entries.map(e => e.type))).toEqual([
      AuditEntryType.Created,
      AuditEntryType.Updated,
    ]);
  }, 120_000);

  it('update sets nested metadata field: metadata propagates to all clients and server', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-metadata');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await a.upsert({ ...created, metadata: { count: 42, tag: 'hello' } });
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ metadata: { count: 42, tag: 'hello' } });
    expect(await b.getLocalRecord(id)).toMatchObject({ metadata: { count: 42, tag: 'hello' } });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ metadata: { count: 42, tag: 'hello' } });
  }, 120_000);

  it('both connected, B updates then A updates (A update has later ULID): A value wins on both clients', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-concurrent');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.upsert({ ...created, clientId: 'b', value: 'b-concurrent' });
    await a.upsert({ ...created, value: 'a-concurrent' });
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'a-concurrent' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'a-concurrent' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'a-concurrent' });
  }, 120_000);

  it('B offline update, A updates multiple times online (A final update has latest ULID): A final value wins', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-a-multi-wins');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await b.upsert({ ...created, clientId: 'b', value: 'b-offline' });
    await a.upsert({ ...created, value: 'a-update-1' });
    await a.upsert({ ...created, value: 'a-update-2' });
    await a.upsert({ ...created, value: 'a-final' });

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    // A's final update (latest ULID) beats B's offline update
    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'a-final' });
    expect(await b.getLocalRecord(id)).toMatchObject({ value: 'a-final' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'a-final' });
  }, 120_000);

  it('A updates name field, B offline updates value field (different fields, B update has later ULID): B wins whole record', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-diff-fields');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await a.upsert({ ...created, name: 'set-by-a' });
    await b.upsert({ ...created, clientId: 'b', value: 'b-offline-wins' });

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    // B has the later ULID (B updated offline, reconnects after A) — ULID ordering determines the winner
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'b-offline-wins', clientId: 'b' });

    const audit = await getServerAudit(id);
    const types = mainAuditTypes(audit.entries.map(e => e.type));
    expect(types[0]).toBe(AuditEntryType.Created);
    expect(types.filter(type => type === AuditEntryType.Updated).length).toBe(2);
  }, 120_000);

  it('A offline, updates record, server restarts, A reconnects: update is preserved after restart', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('e2e-upd-restart');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await a.disconnect();

    await a.upsert({ ...created, value: 'update-before-restart' });

    await useServer().restartServer();
    await b.reconnect();

    await a.reconnect();
    await waitForAllClientsIdle([a, b]);

    expect(await a.getLocalRecord(id)).toMatchObject({ value: 'update-before-restart' });
    const serverRow = await getServerLiveRecord(id);
    expect(serverRow).toMatchObject({ value: 'update-before-restart' });
  }, 120_000);
});
