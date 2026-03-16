import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  NUM_CLIENTS,
  TEST_DURATION_MS,
  DELAY_MIN_MS,
  DELAY_MAX_MS,
  SERVER_RESTART_AT_MS,
  CLIENT_CONNECT_TIMEOUT_MS,
  SHUTDOWN_DRAIN_MS,
  FINAL_SYNC_GRACE_MS,
  QUIET_PERIOD_STABLE_MS,
  QUIET_PERIOD_TIMEOUT_MS,
  DEFAULT_PORT,
} from './config';
import { createRunLogger } from './runLogger';
import { startLifecycle, setServerLogCallback } from './serverLifecycle';
import { createSyncClient } from './syncClient';
import { addUpdate, addDeletion, getExpectedState, getEntryCount, clear as clearRecordsOfTruth } from './recordsOfTruth';
import { assertIntegrity, getIntegrityReport } from './integrityAssertions';
import { readServerRecords } from './readServerRecords';
import { syncTestCollection } from './types';
import type { SyncTestRecord } from './types';

function randomDelay(): Promise<void> {
  const ms = DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
  return new Promise(r => setTimeout(r, ms));
}

const rand = () => Math.random().toString(36).slice(2, 9);

/** Create a new record with full CRUD shape: nested metadata, optional name, tags array. */
function createNewRecord(clientId: string, id?: string): SyncTestRecord {
  const useMeta = Math.random() < 0.7;
  const useTags = Math.random() < 0.7;
  const useName = Math.random() < 0.6;
  const now = Date.now();
  return {
    id: id ?? Math.uniqueId(),
    clientId,
    updatedAt: now,
    ...(useName && { name: `n-${now}-${rand()}` }),
    ...(useMeta && { metadata: { count: Math.floor(Math.random() * 1000), tag: Math.random() < 0.5 ? `tag-${rand()}` : null } }),
    ...(useTags && { tags: Array.from({ length: 1 + Math.floor(Math.random() * 3) }, () => `t-${rand()}`) }),
    value: `v-${now}-${rand()}`,
  };
}

/** Mutate nested metadata (set/update or clear). */
function mutateNested(record: SyncTestRecord): SyncTestRecord {
  const now = Date.now();
  const choice = Math.random();
  if (choice < 0.33) {
    return { ...record, updatedAt: now, metadata: { count: Math.floor(Math.random() * 1000), tag: `tag-${rand()}` } };
  }
  if (choice < 0.66) {
    return { ...record, updatedAt: now, metadata: record.metadata ? { ...record.metadata, count: (record.metadata.count + 1) % 1000 } : { count: 0 } };
  }
  return { ...record, updatedAt: now, metadata: null };
}

/** Add or remove one element from tags array. */
function mutateTags(record: SyncTestRecord): SyncTestRecord {
  const now = Date.now();
  const tags = record.tags ?? [];
  if (tags.length === 0 || Math.random() < 0.5) {
    return { ...record, updatedAt: now, tags: [...tags, `t-${now}-${rand()}`] };
  }
  const idx = Math.floor(Math.random() * tags.length);
  return { ...record, updatedAt: now, tags: tags.filter((_, i) => i !== idx) };
}

/** Set or unset optional name. */
function mutateName(record: SyncTestRecord): SyncTestRecord {
  const now = Date.now();
  if (Math.random() < 0.5) {
    return { ...record, updatedAt: now, name: `n-${now}-${rand()}` };
  }
  return { ...record, updatedAt: now, name: null };
}

/** Pick a random mutation for an existing record. */
function mutateRecord(record: SyncTestRecord): SyncTestRecord {
  const mutations = [mutateNested, mutateTags, mutateName];
  return mutations[Math.floor(Math.random() * mutations.length)](record);
}

function waitConnected(client: ReturnType<typeof createSyncClient>, timeoutMs = CLIENT_CONNECT_TIMEOUT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const check = () => {
      if (client.getIsConnected()) {
        resolve();
        return;
      }
      if (Date.now() >= deadline) {
        reject(new Error('Timeout waiting for client to connect'));
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

async function waitAllIdle(
  clientsList: ReturnType<typeof createSyncClient>[],
  stableMs = QUIET_PERIOD_STABLE_MS,
  timeoutMs = QUIET_PERIOD_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | null = null;
  while (Date.now() < deadline) {
    const allConnected = clientsList.every(c => c.getIsConnected());
    const anySyncing = clientsList.some(c => c.getIsSynchronising());
    if (allConnected && !anySyncing) {
      if (stableSince == null) stableSince = Date.now();
      if (Date.now() - stableSince >= stableMs) return;
    } else {
      stableSince = null;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error('Timeout waiting for all clients to become idle');
}

describe('client sync integration', () => {
  let runLogger: ReturnType<typeof createRunLogger>;
  let lifecycle: Awaited<ReturnType<typeof startLifecycle>>;
  let clients: ReturnType<typeof createSyncClient>[] = [];
  let serverUrl: string;
  let reportEmitted = false;

  async function emitFinalReport(reason: string) {
    if (reportEmitted) return;
    reportEmitted = true;

    try {
      const expectedState = getExpectedState();
      const serverRecords = lifecycle?.mongoUri ? await readServerRecords(lifecycle.mongoUri) : [];
      const totalUpdatesWritten = getEntryCount();
      const report = getIntegrityReport(serverRecords, expectedState);

      runLogger?.log('integrity_report', {
        reason,
        totalUpdatesWritten,
        expectedCount: report.expectedCount,
        serverCount: report.serverCount,
        matchedCount: report.matchedCount,
        missingCount: report.missingCount,
        extraCount: report.extraCount,
        valueMismatchCount: report.valueMismatchCount,
        passed: report.passed,
        missingSample: report.missingIds.slice(0, 10),
        extraSample: report.extraIds.slice(0, 10),
        valueMismatchSample: report.valueMismatches.slice(0, 3).map(m => ({
          id: m.id,
          expectedUpdatedAt: m.expected.updatedAt,
          actualUpdatedAt: m.actual.updatedAt,
          expectedKeys: Object.keys(m.expected),
          actualKeys: Object.keys(m.actual),
        })),
      } as any);

      const summary = [
        '--- Sync test integrity report ---',
        `Reason: ${reason}`,
        `Total updates written (client-side): ${totalUpdatesWritten}`,
        `Expected unique records (last-write-wins): ${report.expectedCount}`,
        `Records on server: ${report.serverCount}`,
        `Matched (exact): ${report.matchedCount}`,
        `Missing on server: ${report.missingCount}`,
        `Extra on server: ${report.extraCount}`,
        `Value mismatches: ${report.valueMismatchCount}`,
        `Passed: ${report.passed ? 'yes' : 'no'}`,
        '---------------------------------',
      ].join('\n');

      runLogger?.log('sync_response', { phase: 'summary', summary });
      // eslint-disable-next-line no-console
      console.log(summary);
    } catch (error) {
      runLogger?.log('error', { type: 'final_report_failed', reason, error: String((error as any)?.message ?? error) });
    }
  }

  beforeAll(async () => {
    runLogger = createRunLogger();
    runLogger.log('test_start', { numClients: NUM_CLIENTS, testDurationMs: TEST_DURATION_MS });

    // Mirror real server stdout/stderr into the sync-test log for full traceability.
    setServerLogCallback((stream, line) => {
      runLogger.log('server_log', { stream, line });
    });

    process.on('unhandledRejection', reason => {
      runLogger.log('error', { type: 'unhandledRejection', reason: String((reason as any)?.message ?? reason) });
    });
    process.on('uncaughtException', error => {
      runLogger.log('error', { type: 'uncaughtException', error: String((error as any)?.message ?? error) });
    });

    const win = (global as unknown as { window: unknown; }).window;
    const doc = (global as unknown as { document: Document; }).document;
    delete (global as unknown as Record<string, unknown>).window;
    delete (global as unknown as Record<string, unknown>).document;
    try {
      lifecycle = await startLifecycle(DEFAULT_PORT, [syncTestCollection]);

      // Clear the database to ensure clean test state
      if (lifecycle.mongoUri) {
        const { MongoClient } = require('mongodb');
        const client = new MongoClient(lifecycle.mongoUri);
        await client.connect();
        const db = client.db('mxdb-sync-test');
        await db.collection('syncTest').deleteMany({});
        await db.collection('syncTest_audit').deleteMany({});
        await client.close();
        runLogger.log('test_setup', { action: 'database_cleared' });
      }
    } finally {
      (global as unknown as { window: unknown; }).window = win;
      (global as unknown as { document: Document; }).document = doc;
    }

    // socket-api client builds `wss://${host}` so we pass host without protocol.
    serverUrl = `localhost:${lifecycle.port}`;
    runLogger.log('server_start', { port: lifecycle.port });

    clients = Array.from({ length: NUM_CLIENTS }, (_, i) =>
      createSyncClient(`client-${i}`, runLogger),
    );

    await Promise.all(
      clients.map(client =>
        client.connect(serverUrl).then(() => waitConnected(client)),
      ),
    );

    clearRecordsOfTruth();
  }, 90_000);

  afterAll(async () => {
    // If the test timed out or failed before reaching the normal reporting block,
    // still emit a best-effort report from whatever state exists at teardown time.
    await emitFinalReport('afterAll');

    if (clients.length > 0) {
      for (const client of clients) {
        client.unmount();
      }
    }
    if (lifecycle != null) {
      await lifecycle.stopServer();
      runLogger.log('server_stop', {});
    }
    if (runLogger != null) {
      runLogger.log('test_end', {});
      runLogger.close();
    }
  }, 15_000);

  it('runs 50 clients for 30s with random updates and disconnects, restarts server once, then asserts integrity', async () => {
    const startTime = Date.now();
    let serverRestartDone = false;

    const restartTimer = (async () => {
      await new Promise(r => setTimeout(r, SERVER_RESTART_AT_MS));
      if (serverRestartDone) return;
      serverRestartDone = true;
      runLogger.log('server_restart', { atMs: Date.now() - startTime });
      await lifecycle.restartServer();
    })();

    const clientLoops = clients.map((client, i) => async () => {
      const clientId = `client-${i}`;
      while (Date.now() - startTime < TEST_DURATION_MS) {
        await randomDelay();
        const r = Math.random();
        const action: 'create' | 'update' | 'delete' | 'disconnect_cycle' =
          r < 0.35 ? 'create' : r < 0.6 ? 'update' : r < 0.8 ? 'delete' : 'disconnect_cycle';

        const runUpsert = async (record: SyncTestRecord, offline: boolean) => {
          try {
            const offlineActual = !client.getIsConnected();
            await client.upsert(record);
            addUpdate(clientId, record);
            runLogger.log(offlineActual ? 'client_upsert_offline' : 'client_upsert', { clientId, recordId: record.id, offlineActual, offlineRequested: offline });
          } catch (error) {
            runLogger.log('error', { type: offline ? 'client_upsert_offline_failed' : 'client_upsert_failed', clientId, recordId: record.id, error: String((error as any)?.message ?? error) });
          }
        };

        const runRemove = async (recordId: string, offline: boolean) => {
          try {
            const offlineActual = !client.getIsConnected();
            const removed = await client.remove(recordId);
            if (removed) {
              addDeletion(recordId, Date.now());
              runLogger.log(offlineActual ? 'client_remove_offline' : 'client_remove', { clientId, recordId, offlineActual, offlineRequested: offline });
            } else {
              // This commonly happens when `keepIfHasHistory: true` prevents deletion.
              runLogger.log('client_remove_kept_due_to_history', { clientId, recordId, offlineActual, offlineRequested: offline });
            }
          } catch (error) {
            runLogger.log('error', { type: offline ? 'client_remove_offline_failed' : 'client_remove_failed', clientId, recordId, error: String((error as any)?.message ?? error) });
          }
        };

        if (action === 'create') {
          const record = createNewRecord(clientId);
          await runUpsert(record, false);
        } else if (action === 'update') {
          const expected = getExpectedState();
          if (expected.size > 0) {
            const ids = Array.from(expected.keys());
            const id = ids[Math.floor(Math.random() * ids.length)];
            const existing = expected.get(id)!;
            const record = mutateRecord({ ...existing });
            await runUpsert(record, false);
          }
        } else if (action === 'delete') {
          const expected = getExpectedState();
          if (expected.size > 0) {
            const ids = Array.from(expected.keys());
            const id = ids[Math.floor(Math.random() * ids.length)];
            await runRemove(id, false);
          }
        } else {
          client.disconnect();
          await randomDelay();
          const sub = Math.random();
          if (sub < 0.4) {
            const record = createNewRecord(clientId);
            await runUpsert(record, true);
          } else if (sub < 0.7) {
            const expected = getExpectedState();
            if (expected.size > 0) {
              const ids = Array.from(expected.keys());
              const id = ids[Math.floor(Math.random() * ids.length)];
              const existing = expected.get(id)!;
              const record = mutateRecord({ ...existing });
              await runUpsert(record, true);
            }
          } else {
            const expected = getExpectedState();
            if (expected.size > 0) {
              const ids = Array.from(expected.keys());
              const id = ids[Math.floor(Math.random() * ids.length)];
              await runRemove(id, true);
            }
          }
          client.reconnect();
        }
      }
    });

    runLogger.log('sync_request', { phase: 'phase_marker', marker: 'workload_wait_begin' });
    await Promise.all([...clientLoops.map(fn => fn()), restartTimer]);
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'workload_wait_end', elapsedMs: Date.now() - startTime });

    await new Promise(r => setTimeout(r, SHUTDOWN_DRAIN_MS));
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'shutdown_drain_done', elapsedMs: Date.now() - startTime });

    // Quiet period: no more upserts; reconnect all clients and wait for sync to fully settle.
    runLogger.log('sync_request', { phase: 'quiet_period', stableMs: QUIET_PERIOD_STABLE_MS, timeoutMs: QUIET_PERIOD_TIMEOUT_MS });
    for (const client of clients) client.reconnect();
    await Promise.all(clients.map(c => waitConnected(c).catch(() => { })));
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'quiet_period_all_connected' });
    await waitAllIdle(clients);
    runLogger.log('sync_response', { phase: 'quiet_period', status: 'idle' });

    const expectedState = getExpectedState();
    // After clients are idle, wait until Mongo matches expected state: no missing, no extras (deletes applied).
    const settleDeadline = Date.now() + QUIET_PERIOD_TIMEOUT_MS;
    runLogger.log('sync_request', { phase: 'phase_marker', marker: 'mongo_settle_begin' });
    let lastMissing = Number.POSITIVE_INFINITY;
    let lastExtra = Number.POSITIVE_INFINITY;
    while (Date.now() < settleDeadline) {
      const currentServer = await readServerRecords(lifecycle.mongoUri);
      const serverIds = new Set(currentServer.map(r => r.id));
      const expectedIds = new Set(expectedState.keys());
      const missing = Array.from(expectedIds).filter(id => !serverIds.has(id)).length;
      const extra = currentServer.filter(r => !expectedIds.has(r.id)).length;
      if (missing === 0 && extra === 0) break;
      if (missing !== lastMissing || extra !== lastExtra) {
        runLogger.log('sync_response', { phase: 'quiet_period', status: 'waiting_server', missing, extra });
        lastMissing = missing;
        lastExtra = extra;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'mongo_settle_end' });

    // Small extra settle time for DB watchers after the last writes land.
    runLogger.log('sync_request', { phase: 'phase_marker', marker: 'final_grace_begin', ms: FINAL_SYNC_GRACE_MS });
    await new Promise(r => setTimeout(r, FINAL_SYNC_GRACE_MS));
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'final_grace_end' });

    const serverRecords = await readServerRecords(lifecycle.mongoUri);
    await emitFinalReport('normal_end');

    assertIntegrity(serverRecords, expectedState, runLogger);

    expect(serverRecords.length).toBe(expectedState.size);
  }, 300_000);
});
