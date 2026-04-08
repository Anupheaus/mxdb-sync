import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { E2eTestRecord } from '../setup/types';
import type { E2EClientHandle } from '../setup';
import {
  resetE2E,
  setupE2E,
  teardownE2E,
  useClient,
  useServer,
  waitForAllClientsIdle,
  waitUntilAsync,
} from '../setup';
import {
  connectBoth,
  newRecordId,
  seedRowWithBOnGetAll,
} from './utils';

// ─── Snapshot wait helpers ────────────────────────────────────────────────────

async function waitForGetAllSnapshot(
  client: E2EClientHandle,
  predicate: (snapshot: E2eTestRecord[]) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  await waitUntilAsync(async () => predicate(client.getGetAllSubscriptionSnapshot()), label, timeoutMs);
}

async function waitForQuerySnapshot(
  client: E2EClientHandle,
  predicate: (snapshot: { records: E2eTestRecord[]; total: number }) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  await waitUntilAsync(async () => predicate(client.getQuerySnapshot()), label, timeoutMs);
}

async function waitForDistinctSnapshot(
  client: E2EClientHandle,
  predicate: (snapshot: unknown[]) => boolean,
  label: string,
  timeoutMs = 30_000,
): Promise<void> {
  await waitUntilAsync(async () => predicate(client.getDistinctSnapshot()), label, timeoutMs);
}

// ─── getAll subscription ──────────────────────────────────────────────────────

describe('e2e getAll subscription tests', () => {
  beforeAll(async () => {
    await setupE2E();
  }, 90_000);

  beforeEach(async () => {
    await resetE2E();
  });

  afterAll(async () => {
    await teardownE2E();
  }, 30_000);

  it('subscribe to empty collection then A creates: snapshot updates reactively', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);
    await b.subscribeGetAll();

    const id = newRecordId('sub-getall-empty');
    await a.upsert({ id, clientId: 'a', value: 'created-after-subscribe' });
    await useServer().waitForLiveRecord(id);

    await waitForGetAllSnapshot(
      b,
      snap => snap.some(r => r.id === id),
      'B getAll snapshot includes new record',
    );

    expect(b.getGetAllSubscriptionSnapshot().find(r => r.id === id)).toMatchObject({ value: 'created-after-subscribe' });
  }, 120_000);

  it('A creates before B subscribes getAll: snapshot includes existing record', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const id = newRecordId('sub-getall-late');
    await a.upsert({ id, clientId: 'a', value: 'pre-existing' });
    await useServer().waitForLiveRecord(id);

    await b.subscribeGetAll();

    await waitForGetAllSnapshot(
      b,
      snap => snap.some(r => r.id === id),
      'B late-subscribe snapshot includes pre-existing record',
    );

    expect(b.getGetAllSubscriptionSnapshot().find(r => r.id === id)).toMatchObject({ value: 'pre-existing' });
  }, 120_000);

  it('B subscribed getAll, A updates record: B snapshot has updated value', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('sub-getall-update');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await a.upsert({ ...created, value: 'updated-value' });
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(
      b,
      snap => snap.find(r => r.id === id)?.value === 'updated-value',
      'B getAll snapshot reflects updated value',
    );
  }, 120_000);

  it('B subscribed getAll, A deletes record: B snapshot no longer contains it', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('sub-getall-delete');
    await seedRowWithBOnGetAll(a, b, id);

    expect(b.getGetAllSubscriptionSnapshot().some(r => r.id === id)).toBe(true);

    await a.remove(id);
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(
      b,
      snap => !snap.some(r => r.id === id),
      'B getAll snapshot no longer contains deleted record',
    );
  }, 120_000);

  it('B subscribed getAll, offline while A upserts: reconnect delivers updated snapshot', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('sub-getall-offline');
    const created = await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();

    await a.upsert({ ...created, value: 'updated-while-b-offline' });
    await useServer().waitForLiveRecord(id);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(
      b,
      snap => snap.find(r => r.id === id)?.value === 'updated-while-b-offline',
      'B getAll snapshot reflects update received after reconnect',
    );
  }, 120_000);

  it('B subscribed getAll, offline while A deletes: reconnect snapshot excludes deleted record', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('sub-getall-offline-del');
    await seedRowWithBOnGetAll(a, b, id);

    await b.disconnect();
    await a.remove(id);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(
      b,
      snap => !snap.some(r => r.id === id),
      'B getAll snapshot excludes record deleted while offline',
    );
  }, 120_000);

  it('both subscribed getAll, A inserts: both snapshots update with the new record', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);
    await a.subscribeGetAll();
    await b.subscribeGetAll();

    const id = newRecordId('sub-getall-both');
    await a.upsert({ id, clientId: 'a', value: 'shared-record' });
    await useServer().waitForLiveRecord(id);

    await Promise.all([
      waitForGetAllSnapshot(a, snap => snap.some(r => r.id === id), 'A snapshot includes new record'),
      waitForGetAllSnapshot(b, snap => snap.some(r => r.id === id), 'B snapshot includes new record'),
    ]);

    expect(a.getGetAllSubscriptionSnapshot().find(r => r.id === id)).toMatchObject({ value: 'shared-record' });
    expect(b.getGetAllSubscriptionSnapshot().find(r => r.id === id)).toMatchObject({ value: 'shared-record' });
  }, 120_000);

  it('multiple records from different clients: getAll snapshot aggregates all', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);
    await b.subscribeGetAll();

    const idA = newRecordId('sub-getall-multi-a');
    const idB = newRecordId('sub-getall-multi-b');

    await a.upsert({ id: idA, clientId: 'a', value: 'from-a' });
    await b.upsert({ id: idB, clientId: 'b', value: 'from-b' });
    await useServer().waitForLiveRecord(idA);
    await useServer().waitForLiveRecord(idB);
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(
      b,
      snap => snap.some(r => r.id === idA) && snap.some(r => r.id === idB),
      'B snapshot contains records from both clients',
    );
  }, 120_000);

  it('server restart: getAll subscription recovers and delivers current state', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const id = newRecordId('sub-getall-restart');
    await seedRowWithBOnGetAll(a, b, id);

    await useServer().restartServer();
    await b.reconnect();
    await a.reconnect();
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(
      b,
      snap => snap.some(r => r.id === id),
      'B getAll snapshot restored after server restart',
    );
  }, 120_000);
});

// ─── query subscription ───────────────────────────────────────────────────────

describe('e2e query subscription tests', () => {
  beforeAll(async () => {
    await setupE2E();
  }, 90_000);

  beforeEach(async () => {
    await resetE2E();
  });

  afterAll(async () => {
    await teardownE2E();
  }, 30_000);

  it('subscribe with value filter: only matching records returned', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const idMatch = newRecordId('sub-query-match');
    const idNoMatch = newRecordId('sub-query-nomatch');

    await a.upsert({ id: idMatch, clientId: 'a', value: 'target' });
    await a.upsert({ id: idNoMatch, clientId: 'a', value: 'other' });
    await useServer().waitForLiveRecord(idMatch);
    await useServer().waitForLiveRecord(idNoMatch);

    await b.subscribeQuery({ filters: { value: 'target' } });
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => snap.records.some(r => r.id === idMatch),
      'B query snapshot includes matching record',
    );

    const snap = b.getQuerySnapshot();
    expect(snap.records.some(r => r.id === idMatch)).toBe(true);
    expect(snap.records.some(r => r.id === idNoMatch)).toBe(false);
  }, 120_000);

  it('new record matching filter: appears in subscription snapshot', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await b.subscribeQuery({ filters: { value: 'watch-me' } });

    const id = newRecordId('sub-query-new-match');
    await a.upsert({ id, clientId: 'a', value: 'watch-me' });
    await useServer().waitForLiveRecord(id);
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => snap.records.some(r => r.id === id),
      'B query snapshot includes newly inserted matching record',
    );
  }, 120_000);

  it('new record not matching filter: does not appear in subscription snapshot', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await b.subscribeQuery({ filters: { value: 'watch-me' } });

    const id = newRecordId('sub-query-new-nomatch');
    await a.upsert({ id, clientId: 'a', value: 'not-it' });
    await useServer().waitForLiveRecord(id);
    await waitForAllClientsIdle([a, b]);

    // Give a moment for any spurious updates to fire
    await new Promise<void>(r => setTimeout(r, 500));

    expect(b.getQuerySnapshot().records.some(r => r.id === id)).toBe(false);
  }, 120_000);

  it('record updated to match filter: appears in subscription', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const id = newRecordId('sub-query-update-in');
    await a.upsert({ id, clientId: 'a', value: 'no-match-yet' });
    await useServer().waitForLiveRecord(id);

    await b.subscribeQuery({ filters: { value: 'now-matches' } });
    await waitForAllClientsIdle([a, b]);

    expect(b.getQuerySnapshot().records.some(r => r.id === id)).toBe(false);

    await a.upsert({ id, clientId: 'a', value: 'now-matches' });
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => snap.records.some(r => r.id === id),
      'B query snapshot includes record after it matched filter',
    );
  }, 120_000);

  it('record updated to no longer match filter: removed from subscription', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const id = newRecordId('sub-query-update-out');
    await a.upsert({ id, clientId: 'a', value: 'matches' });
    await useServer().waitForLiveRecord(id);

    await b.subscribeQuery({ filters: { value: 'matches' } });
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => snap.records.some(r => r.id === id),
      'B query snapshot initially includes matching record',
    );

    await a.upsert({ id, clientId: 'a', value: 'no-longer-matches' });
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => !snap.records.some(r => r.id === id),
      'B query snapshot excludes record after update removed it from filter',
    );
  }, 120_000);

  it('matching record deleted: removed from subscription snapshot', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const id = newRecordId('sub-query-delete-match');
    await a.upsert({ id, clientId: 'a', value: 'to-delete' });
    await useServer().waitForLiveRecord(id);

    await b.subscribeQuery({ filters: { value: 'to-delete' } });
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => snap.records.some(r => r.id === id),
      'B query snapshot initially includes record',
    );

    await a.remove(id);
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => !snap.records.some(r => r.id === id),
      'B query snapshot excludes deleted record',
    );
  }, 120_000);

  it('B offline, A inserts matching record: subscription reflects correct state after reconnect', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await b.subscribeQuery({ filters: { value: 'offline-match' } });
    await b.disconnect();

    const id = newRecordId('sub-query-offline-insert');
    await a.upsert({ id, clientId: 'a', value: 'offline-match' });
    await useServer().waitForLiveRecord(id);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => snap.records.some(r => r.id === id),
      'B query snapshot includes record inserted while offline',
    );
  }, 120_000);

  it('B offline, A deletes matching record: subscription excludes it after reconnect', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const id = newRecordId('sub-query-offline-delete');
    await a.upsert({ id, clientId: 'a', value: 'will-be-deleted' });
    await useServer().waitForLiveRecord(id);

    await b.subscribeQuery({ filters: { value: 'will-be-deleted' } });
    await waitForAllClientsIdle([a, b]);
    await waitForQuerySnapshot(b, snap => snap.records.some(r => r.id === id), 'initial match');

    await b.disconnect();
    await a.remove(id);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => !snap.records.some(r => r.id === id),
      'B query snapshot excludes record deleted while offline',
    );
  }, 120_000);

  it('two clients with different filters: each sees only its matching records', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const c = useClient('c');
    await connectBoth(a, b);
    await c.connect();

    const idForB = newRecordId('sub-query-b-filter');
    const idForC = newRecordId('sub-query-c-filter');

    await b.subscribeQuery({ filters: { clientId: 'a' } });
    await c.subscribeQuery({ filters: { value: 'c-only' } });

    await a.upsert({ id: idForB, clientId: 'a', value: 'any' });
    await a.upsert({ id: idForC, clientId: 'b', value: 'c-only' });
    await useServer().waitForLiveRecord(idForB);
    await useServer().waitForLiveRecord(idForC);
    await waitForAllClientsIdle([a, b, c]);

    await waitForQuerySnapshot(b, snap => snap.records.some(r => r.id === idForB), 'B sees its record');
    await waitForQuerySnapshot(c, snap => snap.records.some(r => r.id === idForC), 'C sees its record');

    expect(b.getQuerySnapshot().records.some(r => r.id === idForC)).toBe(false);
    expect(c.getQuerySnapshot().records.some(r => r.id === idForB)).toBe(false);
  }, 120_000);

  it('query total reflects accurate count for filtered results', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const ids = [newRecordId('sub-query-total-1'), newRecordId('sub-query-total-2'), newRecordId('sub-query-total-3')];
    for (const id of ids) {
      await a.upsert({ id, clientId: 'a', value: 'counted' });
      await useServer().waitForLiveRecord(id);
    }
    // One non-matching record
    const otherId = newRecordId('sub-query-total-other');
    await a.upsert({ id: otherId, clientId: 'a', value: 'not-counted' });
    await useServer().waitForLiveRecord(otherId);

    await b.subscribeQuery({ filters: { value: 'counted' } });
    await waitForAllClientsIdle([a, b]);

    await waitForQuerySnapshot(
      b,
      snap => snap.records.length === 3,
      'B query snapshot has exactly 3 matching records',
    );

    const snap = b.getQuerySnapshot();
    expect(snap.records).toHaveLength(3);
    expect(snap.records.every(r => r.value === 'counted')).toBe(true);
  }, 120_000);
});

// ─── distinct subscription ────────────────────────────────────────────────────

describe('e2e distinct subscription tests', () => {
  beforeAll(async () => {
    await setupE2E();
  }, 90_000);

  beforeEach(async () => {
    await resetE2E();
  });

  afterAll(async () => {
    await teardownE2E();
  }, 30_000);

  it('returns all distinct values for a field across existing records', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await a.upsert({ id: newRecordId('sub-dist-init-1'), clientId: 'a', value: 'alpha' });
    await a.upsert({ id: newRecordId('sub-dist-init-2'), clientId: 'b', value: 'beta' });
    await a.upsert({ id: newRecordId('sub-dist-init-3'), clientId: 'a', value: 'gamma' });
    await waitForAllClientsIdle([a]);

    await b.subscribeDistinct('clientId');
    await waitForAllClientsIdle([a, b]);

    await waitForDistinctSnapshot(
      b,
      snap => snap.includes('a') && snap.includes('b'),
      'B distinct snapshot includes all clientId values',
    );

    const snap = b.getDistinctSnapshot() as string[];
    expect(snap).toContain('a');
    expect(snap).toContain('b');
    expect(new Set(snap).size).toBe(snap.length); // no duplicates
  }, 120_000);

  it('new record with new distinct value: value appears in snapshot', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await a.upsert({ id: newRecordId('sub-dist-new-1'), clientId: 'a', value: 'existing' });
    await waitForAllClientsIdle([a]);

    await b.subscribeDistinct('value');
    await waitForAllClientsIdle([a, b]);
    await waitForDistinctSnapshot(b, snap => snap.includes('existing'), 'initial distinct value');

    const id = newRecordId('sub-dist-new-2');
    await a.upsert({ id, clientId: 'a', value: 'brand-new-value' });
    await useServer().waitForLiveRecord(id);
    await waitForAllClientsIdle([a, b]);

    await waitForDistinctSnapshot(
      b,
      snap => snap.includes('brand-new-value'),
      'B distinct snapshot includes newly added value',
    );
  }, 120_000);

  it('new record with existing distinct value: snapshot does not gain duplicates', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await a.upsert({ id: newRecordId('sub-dist-dup-1'), clientId: 'a', value: 'same' });
    await waitForAllClientsIdle([a]);

    await b.subscribeDistinct('value');
    await waitForAllClientsIdle([a, b]);
    await waitForDistinctSnapshot(b, snap => snap.includes('same'), 'initial distinct');

    const snapBefore = b.getDistinctSnapshot().length;

    const id = newRecordId('sub-dist-dup-2');
    await a.upsert({ id, clientId: 'a', value: 'same' }); // same value again
    await useServer().waitForLiveRecord(id);
    await waitForAllClientsIdle([a, b]);
    // Give subscription time to update if it were going to
    await new Promise<void>(r => setTimeout(r, 500));

    const snap = b.getDistinctSnapshot();
    expect(snap.filter(v => v === 'same')).toHaveLength(1); // still exactly one 'same'
    expect(snap.length).toBe(snapBefore); // total count unchanged
  }, 120_000);

  it('last record with a value deleted: value removed from distinct snapshot', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const id = newRecordId('sub-dist-del-last');
    await a.upsert({ id, clientId: 'a', value: 'will-vanish' });
    await a.upsert({ id: newRecordId('sub-dist-del-other'), clientId: 'a', value: 'stays' });
    await waitForAllClientsIdle([a]);

    await b.subscribeDistinct('value');
    await waitForAllClientsIdle([a, b]);
    await waitForDistinctSnapshot(b, snap => snap.includes('will-vanish'), 'initial distinct includes value');

    await a.remove(id);
    await waitForAllClientsIdle([a, b]);

    await waitForDistinctSnapshot(
      b,
      snap => !snap.includes('will-vanish'),
      'B distinct snapshot no longer contains deleted value',
    );
    expect(b.getDistinctSnapshot()).toContain('stays');
  }, 120_000);

  it('one of multiple records with same value deleted: value stays in distinct snapshot', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const idToDelete = newRecordId('sub-dist-del-one');
    const idToKeep = newRecordId('sub-dist-del-keep');
    await a.upsert({ id: idToDelete, clientId: 'a', value: 'shared' });
    await a.upsert({ id: idToKeep, clientId: 'a', value: 'shared' });
    await waitForAllClientsIdle([a]);

    await b.subscribeDistinct('value');
    await waitForAllClientsIdle([a, b]);
    await waitForDistinctSnapshot(b, snap => snap.includes('shared'), 'initial distinct includes shared');

    await a.remove(idToDelete);
    await waitForAllClientsIdle([a, b]);
    // Give subscription time to settle
    await new Promise<void>(r => setTimeout(r, 500));

    expect(b.getDistinctSnapshot()).toContain('shared'); // value persists since idToKeep still has it
  }, 120_000);

  it('record field updated to new value: new value appears and old value only gone if no other records share it', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    const id = newRecordId('sub-dist-update-val');
    await a.upsert({ id, clientId: 'a', value: 'original' });
    await waitForAllClientsIdle([a]);

    await b.subscribeDistinct('value');
    await waitForAllClientsIdle([a, b]);
    await waitForDistinctSnapshot(b, snap => snap.includes('original'), 'initial distinct');

    await a.upsert({ id, clientId: 'a', value: 'updated' });
    await waitForAllClientsIdle([a, b]);

    await waitForDistinctSnapshot(
      b,
      snap => snap.includes('updated') && !snap.includes('original'),
      'B distinct: updated value present, original gone',
    );
  }, 120_000);

  it('B offline while A adds new distinct value: snapshot reflects state after reconnect', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await a.upsert({ id: newRecordId('sub-dist-offline-seed'), clientId: 'a', value: 'seed' });
    await waitForAllClientsIdle([a]);

    await b.subscribeDistinct('value');
    await waitForAllClientsIdle([a, b]);
    await waitForDistinctSnapshot(b, snap => snap.includes('seed'), 'initial');

    await b.disconnect();

    const newId = newRecordId('sub-dist-offline-new');
    await a.upsert({ id: newId, clientId: 'a', value: 'offline-added' });
    await useServer().waitForLiveRecord(newId);

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);

    await waitForDistinctSnapshot(
      b,
      snap => snap.includes('offline-added'),
      'B distinct snapshot includes value added while offline',
    );
  }, 120_000);
});

// ─── cross-subscription edge cases ───────────────────────────────────────────

describe('e2e cross-subscription edge case tests', () => {
  beforeAll(async () => {
    await setupE2E();
  }, 90_000);

  beforeEach(async () => {
    await resetE2E();
  });

  afterAll(async () => {
    await teardownE2E();
  }, 30_000);

  it('client has simultaneous getAll and query subscriptions: both update independently', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await b.subscribeGetAll();
    await b.subscribeQuery({ filters: { value: 'special' } });

    const idSpecial = newRecordId('sub-cross-special');
    const idOther = newRecordId('sub-cross-other');

    await a.upsert({ id: idSpecial, clientId: 'a', value: 'special' });
    await a.upsert({ id: idOther, clientId: 'a', value: 'ordinary' });
    await useServer().waitForLiveRecord(idSpecial);
    await useServer().waitForLiveRecord(idOther);
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(
      b,
      snap => snap.some(r => r.id === idSpecial) && snap.some(r => r.id === idOther),
      'getAll includes both records',
    );
    await waitForQuerySnapshot(
      b,
      snap => snap.records.some(r => r.id === idSpecial),
      'query includes only special record',
    );

    expect(b.getGetAllSubscriptionSnapshot()).toHaveLength(2);
    expect(b.getQuerySnapshot().records).toHaveLength(1);
    expect(b.getQuerySnapshot().records[0].id).toBe(idSpecial);
  }, 120_000);

  it('B on getAll, C on query subscription: each client gets its appropriate view after same upsert', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const c = useClient('c');
    await connectBoth(a, b);
    await c.connect();

    await b.subscribeGetAll();
    await c.subscribeQuery({ filters: { value: 'c-only' } });

    const idFiltered = newRecordId('sub-cross-filtered');
    const idOther = newRecordId('sub-cross-other2');

    await a.upsert({ id: idFiltered, clientId: 'a', value: 'c-only' });
    await a.upsert({ id: idOther, clientId: 'a', value: 'for-everyone' });
    await useServer().waitForLiveRecord(idFiltered);
    await useServer().waitForLiveRecord(idOther);
    await waitForAllClientsIdle([a, b, c]);

    await waitForGetAllSnapshot(
      b,
      snap => snap.some(r => r.id === idFiltered) && snap.some(r => r.id === idOther),
      'B getAll sees both records',
    );
    await waitForQuerySnapshot(
      c,
      snap => snap.records.some(r => r.id === idFiltered) && !snap.records.some(r => r.id === idOther),
      'C query sees only its filtered record',
    );
  }, 120_000);

  it('getAll subscription and distinct subscription on same client: both update on same upsert', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);

    await b.subscribeGetAll();
    await b.subscribeDistinct('clientId');
    await waitForAllClientsIdle([a, b]);

    const id = newRecordId('sub-cross-both-subs');
    await a.upsert({ id, clientId: 'new-client', value: 'v' });
    await useServer().waitForLiveRecord(id);
    await waitForAllClientsIdle([a, b]);

    await waitForGetAllSnapshot(b, snap => snap.some(r => r.id === id), 'getAll updated');
    await waitForDistinctSnapshot(b, snap => snap.includes('new-client'), 'distinct updated');
  }, 120_000);

  it('B offline upsert (non-matching), then B also subscribes query before reconnect: subscription empty after reconnect', async () => {
    const a = useClient('a');
    const b = useClient('b');
    await connectBoth(a, b);
    await b.disconnect();

    const id = newRecordId('sub-cross-offline-no-match');
    await b.upsert({ id, clientId: 'b', value: 'no-match' });

    await b.subscribeQuery({ filters: { value: 'match-only' } });

    await b.reconnect();
    await waitForAllClientsIdle([a, b]);
    // Give subscription time to settle
    await new Promise<void>(r => setTimeout(r, 500));

    expect(b.getQuerySnapshot().records.some(r => r.id === id)).toBe(false);
  }, 120_000);

  it('three clients: two on getAll, one with query filter — all receive correct updates', async () => {
    const a = useClient('a');
    const b = useClient('b');
    const c = useClient('c');
    await connectBoth(a, b);
    await c.connect();

    await b.subscribeGetAll();
    await c.subscribeGetAll();
    await a.subscribeQuery({ filters: { value: 'important' } });

    const idImportant = newRecordId('sub-three-important');
    const idNormal = newRecordId('sub-three-normal');

    await a.upsert({ id: idImportant, clientId: 'a', value: 'important' });
    await a.upsert({ id: idNormal, clientId: 'a', value: 'normal' });
    await useServer().waitForLiveRecord(idImportant);
    await useServer().waitForLiveRecord(idNormal);
    await waitForAllClientsIdle([a, b, c]);

    await waitForGetAllSnapshot(b, snap => snap.some(r => r.id === idImportant) && snap.some(r => r.id === idNormal), 'B getAll');
    await waitForGetAllSnapshot(c, snap => snap.some(r => r.id === idImportant) && snap.some(r => r.id === idNormal), 'C getAll');
    await waitForQuerySnapshot(a, snap => snap.records.some(r => r.id === idImportant) && !snap.records.some(r => r.id === idNormal), 'A query');
  }, 120_000);
});
