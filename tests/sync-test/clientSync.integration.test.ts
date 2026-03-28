import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Must live in this file (not setupFiles) so Vitest hoists it before resolving `@anupheaus/common`
 * for this suite’s imports. See setup.ts — avoid eager common import there.
 */
vi.mock('@anupheaus/common', async importOriginal => {
  const { getSyncTestRunLogger } = await import('./syncTestRunLoggerSink');
  const actual = (await importOriginal()) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- avoid `import()` type in cast
  const RealLogger = actual.Logger as typeof import('@anupheaus/common').Logger;

  class SyncTestLogger extends RealLogger {
    /**
     * Base `createSubLogger` does `new Logger(...)` using the lexical `Logger` from `logger.ts`
     * (the real class), so sub-loggers would bypass this mock. Always instantiate `SyncTestLogger`.
     */
    public override createSubLogger(name: string, settings?: unknown): InstanceType<typeof RealLogger> {
      const subLogger = new SyncTestLogger(name, settings as ConstructorParameters<typeof RealLogger>[1]);
      (subLogger as unknown as { parent: InstanceType<typeof RealLogger> | undefined; }).parent = this;
      return subLogger;
    }

    protected override report(
      level: number,
      message: string,
      meta?: Record<string, unknown>,
      _ignoreLevel = false,
    ): void {
      const lr = getSyncTestRunLogger();
      if (lr != null) {
        const loggerPath = this.allNames.join(' > ');
        lr.log('app_logger', {
          level: RealLogger.getLevelAsString(level),
          message,
          ...(loggerPath.length > 0 ? { logger: loggerPath } : {}),
          ...(meta != null && typeof meta === 'object' && Object.keys(meta).length > 0 ? { meta } : {}),
        });
      }
      super.report(level, message, meta, true);
    }
  }

  return {
    ...actual,
    Logger: SyncTestLogger,
  };
});

/** Longer than default 5s so mxdbClientToServerSyncAction / mxdbGet can outlive a forked server restart. */
vi.mock('../../src/client/utils/actionTimeout', async importOriginal => {
  const actual = await importOriginal<typeof import('../../src/client/utils/actionTimeout')>();
  return {
    ...actual,
    ACTION_TIMEOUT_MS: 45_000,
  };
});

import {
  NUM_CLIENTS,
  SYNC_TEST_INTEGRATION_DELETE_ROLL_CHANCE,
  SYNC_TEST_INTEGRATION_MAX_RECORDS,
  TEST_DURATION_MS,
  // SHUTDOWN_DRAIN_MS,
  FINAL_SYNC_GRACE_MS,
  QUIET_PERIOD_STABLE_MS,
  QUIET_PERIOD_TIMEOUT_MS,
  DEFAULT_PORT,
  CRUD_GAP_MIN_MS,
  CRUD_GAP_MAX_MS,
  SERVER_RESTART_AT_MS,
} from './config';
import { createRunLogger } from './runLogger';
import { setSyncTestRunLogger } from './syncTestRunLoggerSink';
import { startLifecycle, setServerLogCallback } from './serverLifecycle';
import { formatServerLogDetail } from './formatServerLogDetail';
import { createSyncClient } from './syncClient';
import {
  recordHarnessUpsert,
  recordHarnessDelete,
  getExpectedState,
  getEntryCount,
  getHarnessMutationCount,
  getTruthAudits,
  replayTruthOpsInOrder,
  truthMapsEqual,
  clear as clearRecordsOfTruth,
} from './recordsOfTruth';
import {
  assertIntegrity,
  getIntegrityReport,
  syncTestRecordsEqual,
  type IntegrityReport,
} from './integrityAssertions';
import { readServerRecords } from './readServerRecords';
import { readServerAuditDocuments } from './readServerAudits';
import { compareTruthVsServerAudits, type TruthVsServerAuditReport } from './truthVsServerAuditCompare';
import { syncTestCollection } from './types';
import type { SyncTestMetadata, SyncTestRecord } from './types';
import type { AuditOf, ServerAuditOf } from '../../src/common';

// TEMPORARY: restored with the full random multi-client workload below.
// function randomDelay(): Promise<void> {
//   const ms = DELAY_MIN_MS + Math.random() * (DELAY_MAX_MS - DELAY_MIN_MS);
//   return new Promise(r => setTimeout(r, ms));
// }

const rand = () => Math.random().toString(36).slice(2, 9);

function randomCrudGap(): Promise<void> {
  const ms = CRUD_GAP_MIN_MS + Math.random() * (CRUD_GAP_MAX_MS - CRUD_GAP_MIN_MS);
  return new Promise(r => setTimeout(r, ms));
}

function createNewRecord(clientId: string, id?: string): SyncTestRecord {
  const now = Date.now();
  return {
    id: id ?? Math.uniqueId(),
    clientId,
    updatedAt: now,
    value: `v-${now}-${rand()}`,
  };
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

function randomMetadata(): SyncTestMetadata {
  return {
    count: Math.floor(Math.random() * 1000),
    tag: Math.random() < 0.35 ? null : `tag-${rand()}`,
  };
}

function randomTags(): string[] | null {
  if (Math.random() < 0.2) return null;
  const n = 1 + Math.floor(Math.random() * 4);
  return Array.from({ length: n }, () => `t-${rand()}`);
}

/**
 * Each edit touches a random non-empty subset of `value` | `name` | `metadata` | `tags`,
 * always bumps `updatedAt`, and sets `clientId` to the writing client.
 * The harness logs each upsert via {@link recordHarnessUpsert} with the same `prev` / `next` the client
 * uses so truth audits match {@link DbCollection.upsert} (Created / Updated / Restored + ULIDs).
 */
function mutateRecordRandom(base: SyncTestRecord, writerClientId: string): SyncTestRecord {
  const now = Date.now();
  const pool = shuffle(['value', 'name', 'metadata', 'tags'] as const);
  const numFields = 1 + Math.floor(Math.random() * pool.length);
  const chosen = new Set(pool.slice(0, numFields));
  const next: SyncTestRecord = { ...base, id: base.id, clientId: writerClientId, updatedAt: now };
  if (chosen.has('value')) next.value = `v-${now}-${rand()}`;
  if (chosen.has('name')) {
    const r = Math.random();
    if (r < 0.3) next.name = null;
    else next.name = `n-${rand()}`;
  }
  if (chosen.has('metadata')) next.metadata = randomMetadata();
  if (chosen.has('tags')) next.tags = randomTags();
  return next;
}

/**
 * Authoritative expected rows after settle: for each id, the row with the greatest `updatedAt`
 * across clients (LWW). Plain last-client-wins iteration disagreed with sequential truth replay.
 */
function expectedStateFromClients(clientList: ReturnType<typeof createSyncClient>[]): Map<string, SyncTestRecord> {
  const byId = new Map<string, SyncTestRecord>();
  for (const c of clientList) {
    for (const r of c.getLocalRecords()) {
      const prev = byId.get(r.id);
      const clone = JSON.parse(JSON.stringify(r)) as SyncTestRecord;
      if (prev == null || clone.updatedAt > prev.updatedAt) {
        byId.set(r.id, clone);
      }
    }
  }
  return byId;
}

/** Logs C2S queue depth per client and LWW oracle size (runs `expectedStateFromClients` once). */
function logPostSettleDiagnostics(
  when: 'after_mongo_settle' | 'after_final_grace_before_final_report',
  clientList: ReturnType<typeof createSyncClient>[],
  runLog: ReturnType<typeof createRunLogger>,
): void {
  const expectedState = expectedStateFromClients(clientList);
  const perClient = clientList.map((c, i) => ({
    clientId: `client-${i}`,
    pending: c.getPendingC2SSyncQueueSize(),
  }));
  const nonZero = perClient.filter(p => p.pending > 0);
  const totalPending = perClient.reduce((s, p) => s + p.pending, 0);
  runLog.log('post_settle_diag', {
    when,
    expectedStateFromClientsInvoked: true,
    expectedStateFromClientsRecordCount: expectedState.size,
    c2sPendingEntryTotal: totalPending,
    c2sPendingNonZeroClients: nonZero,
  } as any);
}

function jsonClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/** Union of ids implicated in client↔server, oracle↔truth, or truth↔server _sync audit mismatches. */
function collectIntegrityProblemRecordIds(
  report: IntegrityReport,
  oracle: Map<string, SyncTestRecord>,
  truthLive: Map<string, SyncTestRecord>,
  truthVsServer: TruthVsServerAuditReport | null,
): string[] {
  const s = new Set<string>();
  for (const id of report.missingIds) s.add(id);
  for (const id of report.extraIds) s.add(id);
  for (const m of report.valueMismatches) s.add(m.id);
  for (const [id, row] of oracle) {
    const t = truthLive.get(id);
    if (t == null || !syncTestRecordsEqual(row, t)) s.add(id);
  }
  for (const id of truthLive.keys()) {
    if (!oracle.has(id)) s.add(id);
  }
  if (truthVsServer != null) {
    for (const id of truthVsServer.missingOnServer) s.add(id);
    for (const id of truthVsServer.extraOnServer) s.add(id);
    for (const m of truthVsServer.lengthMismatches) s.add(m.recordId);
    for (const m of truthVsServer.entryMismatches) s.add(m.recordId);
  }
  return [...s].sort();
}

async function logIntegrityMismatchRecordDetails(
  recordIds: string[],
  clientList: ReturnType<typeof createSyncClient>[],
  runLog: ReturnType<typeof createRunLogger>,
  params: {
    oracle: Map<string, SyncTestRecord>;
    truthLive: Map<string, SyncTestRecord>;
    truthAudits: ReadonlyMap<string, AuditOf<SyncTestRecord>>;
    serverRecords: SyncTestRecord[];
    serverAudits: Map<string, ServerAuditOf<SyncTestRecord>> | null;
  },
): Promise<void> {
  if (recordIds.length === 0 || clientList.length === 0) return;

  const serverById = new Map(params.serverRecords.map(r => [r.id, r]));

  for (const recordId of recordIds) {
    const perClient: Array<{
      clientId: string;
      localRecord: SyncTestRecord | null;
      localAudit: AuditOf<SyncTestRecord> | null;
    }> = [];

    for (let i = 0; i < clientList.length; i++) {
      const c = clientList[i]!;
      const [row, audit] = await Promise.all([c.getLocal(recordId), c.getLocalAudit(recordId)]);
      if (row == null && audit == null) continue;
      perClient.push({
        clientId: `client-${i}`,
        localRecord: row != null ? jsonClone(row) : null,
        localAudit: audit != null ? jsonClone(audit) : null,
      });
    }

    runLog.log('integrity_mismatch_record', {
      recordId,
      oracleLwwRow: params.oracle.has(recordId) ? jsonClone(params.oracle.get(recordId)!) : null,
      truthLiveRow: params.truthLive.has(recordId) ? jsonClone(params.truthLive.get(recordId)!) : null,
      truthAudit: params.truthAudits.has(recordId) ? jsonClone(params.truthAudits.get(recordId)!) : null,
      serverRow: serverById.has(recordId) ? jsonClone(serverById.get(recordId)!) : null,
      serverAudit: params.serverAudits?.has(recordId) ? jsonClone(params.serverAudits.get(recordId)!) : null,
      clientsWithLocalRowOrAudit: perClient,
    } as any);
  }
}

function pickRandomWriterAndRecordIdForDelete(
  clientList: ReturnType<typeof createSyncClient>[],
):
  | { writer: ReturnType<typeof createSyncClient>; writerClientId: string; recordId: string; }
  | undefined {
  const withRows = clientsWithLocalRows(clientList);
  if (withRows.length === 0) return undefined;
  const writer = withRows[Math.floor(Math.random() * withRows.length)]!;
  const lr = writer.getLocalRecords();
  const pick = lr[Math.floor(Math.random() * lr.length)]!;
  const writerIdx = clientList.indexOf(writer);
  return { writer, writerClientId: `client-${writerIdx}`, recordId: pick.id };
}

function clientsWithLocalRows(clientList: ReturnType<typeof createSyncClient>[]) {
  return clientList.filter(c => c.getLocalRecords().length > 0);
}

async function waitAllIdle(
  clientsList: ReturnType<typeof createSyncClient>[],
  runLog: ReturnType<typeof createRunLogger>,
  stableMs = QUIET_PERIOD_STABLE_MS,
  timeoutMs = QUIET_PERIOD_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let stableSince: number | null = null;
  let lastLogAt = 0;
  while (Date.now() < deadline) {
    const statuses = clientsList.map((c, i) => ({
      id: `client-${i}`,
      connected: c.getIsConnected(),
      syncing: c.getIsSynchronising(),
    }));
    const allConnected = statuses.every(s => s.connected);
    const anySyncing = statuses.some(s => s.syncing);
    const now = Date.now();
    if (now - lastLogAt >= 2000) {
      lastLogAt = now;
      runLog.log('idle_status' as any, {
        allConnected,
        anySyncing,
        stableForMs: stableSince != null ? now - stableSince : null,
        clients: statuses,
      } as any);
    }
    if (allConnected && !anySyncing) {
      if (stableSince == null) stableSince = now;
      if (now - stableSince >= stableMs) return;
    } else {
      stableSince = null;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  const statuses = clientsList.map((c, i) => ({
    id: `client-${i}`,
    connected: c.getIsConnected(),
    syncing: c.getIsSynchronising(),
  }));
  runLog.log('idle_status' as any, { timedOut: true, clients: statuses } as any);
  throw new Error('Timeout waiting for all clients to become idle');
}

describe('client sync integration', () => {
  let runLogger: ReturnType<typeof createRunLogger>;
  let lifecycle: Awaited<ReturnType<typeof startLifecycle>>;
  let clients: ReturnType<typeof createSyncClient>[] = [];
  let serverUrl: string;
  let reportEmitted = false;

  async function emitFinalReport(
    reason: string,
    expectedStateOverride?: Map<string, SyncTestRecord>,
    options?: { enforceTruthAlignment?: boolean; },
  ) {
    if (reportEmitted) return;
    reportEmitted = true;

    let truthMatchesClients = false;
    let truthMatchesServer = false;
    let truthVsServerAuditPassed = true;
    let truthVsServerAuditReport: TruthVsServerAuditReport | null = null;
    let truthVsServerReport = getIntegrityReport([], new Map());
    let reportBuilt = false;

    try {
      const expectedState = expectedStateOverride ?? (clients.length > 0 ? expectedStateFromClients(clients) : getExpectedState());
      const serverRecords = lifecycle?.mongoUri ? await readServerRecords(lifecycle.mongoUri) : [];
      const totalAuditEntries = getEntryCount();
      const totalHarnessMutations = getHarnessMutationCount();
      const report = getIntegrityReport(serverRecords, expectedState);

      const fromTruth = replayTruthOpsInOrder();
      truthMatchesClients = truthMapsEqual(fromTruth, expectedState);
      truthVsServerReport = getIntegrityReport(serverRecords, fromTruth);
      truthMatchesServer = truthVsServerReport.passed;

      const truthAudits = getTruthAudits();
      const truthAuditSummary = [...truthAudits.entries()].map(([id, a]) => ({
        id: id.slice(0, 8),
        entries: a.entries.length,
      }));

      const serverAuditDocuments =
        lifecycle?.mongoUri != null
          ? await readServerAuditDocuments(lifecycle.mongoUri, syncTestCollection.name)
          : null;
      truthVsServerAuditReport =
        serverAuditDocuments != null ? compareTruthVsServerAudits(truthAudits, serverAuditDocuments) : null;
      truthVsServerAuditPassed = truthVsServerAuditReport?.passed ?? true;

      const allAligned =
        report.passed && truthMatchesClients && truthMatchesServer && truthVsServerAuditPassed;

      runLogger?.log('integrity_report', {
        reason,
        totalHarnessMutations,
        totalAuditEntries,
        truthAuditRecordCount: truthAudits.size,
        truthAuditSummary,
        truthVsServerAuditPassed,
        truthVsServerAuditMissingOnServer: truthVsServerAuditReport?.missingOnServer.slice(0, 8) ?? [],
        truthVsServerAuditExtraOnServer: truthVsServerAuditReport?.extraOnServer.slice(0, 8) ?? [],
        truthVsServerAuditBranchedViolations: truthVsServerAuditReport?.branchedViolations.slice(0, 6) ?? [],
        truthVsServerAuditLengthMismatches: truthVsServerAuditReport?.lengthMismatches.slice(0, 6) ?? [],
        truthVsServerAuditEntryMismatches: truthVsServerAuditReport?.entryMismatches.slice(0, 6) ?? [],
        oracle: expectedStateOverride != null || clients.length > 0 ? 'client_local' : 'op_log_replay',
        expectedCount: report.expectedCount,
        serverCount: report.serverCount,
        matchedCount: report.matchedCount,
        missingCount: report.missingCount,
        extraCount: report.extraCount,
        valueMismatchCount: report.valueMismatchCount,
        passed: allAligned,
        clientOracleVsServerPassed: report.passed,
        truthReplayRecordCount: fromTruth.size,
        truthMatchesClients,
        truthMatchesServer,
        truthVsServerMissingCount: truthVsServerReport.missingCount,
        truthVsServerExtraCount: truthVsServerReport.extraCount,
        truthVsServerValueMismatchCount: truthVsServerReport.valueMismatchCount,
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

      if (!allAligned && runLogger != null && clients.length > 0) {
        const problemIds = collectIntegrityProblemRecordIds(
          report,
          expectedState,
          fromTruth,
          truthVsServerAuditReport,
        );
        await logIntegrityMismatchRecordDetails(problemIds, clients, runLogger, {
          oracle: expectedState,
          truthLive: fromTruth,
          truthAudits,
          serverRecords,
          serverAudits: serverAuditDocuments,
        });
      }

      const summary = [
        '--- Sync test integrity report ---',
        `Reason: ${reason}`,
        `Harness mutations (upsert/delete calls): ${totalHarnessMutations}; total audit entries: ${totalAuditEntries}`,
        `Expected unique records (oracle): ${report.expectedCount}`,
        `Records on server: ${report.serverCount}`,
        `Matched client oracle vs server (exact): ${report.matchedCount}`,
        `Missing on server: ${report.missingCount}`,
        `Extra on server: ${report.extraCount}`,
        `Value mismatches (client oracle vs server): ${report.valueMismatchCount}`,
        `Records-of-truth replay vs client oracle: ${truthMatchesClients ? 'match' : 'MISMATCH'}`,
        `Records-of-truth replay vs server: ${truthMatchesServer ? 'match' : 'MISMATCH'}`,
        `Truth audits vs Mongo _sync (no Branched; ops after ULID sort): ${truthVsServerAuditPassed ? 'match' : 'MISMATCH'}`,
        `Overall passed (client↔server + truth↔client + truth↔server + audits): ${allAligned ? 'yes' : 'no'}`,
        '---------------------------------',
      ].join('\n');

      runLogger?.log('sync_response', { phase: 'summary', summary });
      // eslint-disable-next-line no-console
      console.log(summary);
      reportBuilt = true;
    } catch (error) {
      runLogger?.log('error', { type: 'final_report_failed', reason, error: String((error as any)?.message ?? error) });
    }

    if (
      options?.enforceTruthAlignment === true
      && reportBuilt
      && (!truthMatchesClients || !truthMatchesServer || !truthVsServerAuditPassed)
    ) {
      runLogger?.log('error', {
        type: 'truth_oracle_mismatch',
        truthMatchesClients,
        truthMatchesServer,
        truthVsServerAuditPassed,
        truthVsServerMissingCount: truthVsServerReport.missingCount,
        truthVsServerExtraCount: truthVsServerReport.extraCount,
        truthVsServerValueMismatchCount: truthVsServerReport.valueMismatchCount,
        truthVsServerAuditReport: truthVsServerAuditReport
          ? {
            missingOnServer: truthVsServerAuditReport.missingOnServer,
            extraOnServer: truthVsServerAuditReport.extraOnServer,
            branchedViolations: truthVsServerAuditReport.branchedViolations,
            lengthMismatches: truthVsServerAuditReport.lengthMismatches,
            entryMismatches: truthVsServerAuditReport.entryMismatches,
          }
          : null,
      } as any);
      throw new Error(
        `Records-of-truth alignment failed: truthMatchesClients=${truthMatchesClients} truthMatchesServer=${truthMatchesServer} truthVsServerAuditPassed=${truthVsServerAuditPassed}`,
      );
    }
  }

  beforeAll(async () => {
    runLogger = createRunLogger();
    setSyncTestRunLogger(runLogger);
    runLogger.log('test_start', {
      numClients: NUM_CLIENTS,
      maxRecords: SYNC_TEST_INTEGRATION_MAX_RECORDS,
      maxDeletes: Math.floor(SYNC_TEST_INTEGRATION_MAX_RECORDS / 2),
      deleteRollChance: SYNC_TEST_INTEGRATION_DELETE_ROLL_CHANCE,
      workloadDurationMs: TEST_DURATION_MS,
      serverRestartAtMs: SERVER_RESTART_AT_MS,
      note: 'random create/update/delete until duration elapses, getAll on all clients; optional mid-workload server restart; no wait after delete (peers may still edit → restoration)',
    });

    // Server child lines: parse structured JSON into compact fields (see formatServerLogDetail).
    setServerLogCallback((stream, line) => {
      const detail = formatServerLogDetail(stream, line);
      if (detail != null) runLogger.log('server_log', detail);
    });

    process.on('unhandledRejection', reason => {
      runLogger.log('error', { type: 'unhandledRejection', reason: String((reason as any)?.message ?? reason) });
    });
    process.on('uncaughtException', error => {
      runLogger.log('error', { type: 'uncaughtException', error: String((error as any)?.message ?? error), stack: String((error as any)?.stack ?? '') });
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
        await db.collection('syncTest_sync').deleteMany({});
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

    clearRecordsOfTruth();

    await clients.mapAsync(client => client.connect(serverUrl));

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
      setSyncTestRunLogger(undefined);
      runLogger.close();
    }
  }, 15_000);

  it('runs clients with random create/update/delete (capped live rows + capped deletes), then asserts integrity', async () => {
    // No harness settling or quiet period before the post-workload block below (`quiet_period` + waitAllIdle +
    // mongo_settle + final grace). Do not add waitAllIdle, extra sleeps, or “let clients catch up” around server
    // restart or mid-test — only `randomCrudGap()` between CRUD ops. Exception: serverLifecycle’s
    // SERVER_RESTART_WAIT_MS after child exit before respawn is server-side only, not client settle.

    // Every client subscribes so each socket receives getAll-driven pushes for new ids (not only peers of client-0).
    await Promise.all(clients.map(c => c.subscribeGetAll()));
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'all_clients_getAll_subscribed' });

    const harnessRecordIds = new Set<string>();
    const workloadStart = Date.now();
    let opIndex = 0;
    let deletesPerformed = 0;
    const maxIntegrationDeletes = Math.floor(SYNC_TEST_INTEGRATION_MAX_RECORDS / 2);
    // Server restart in parallel with the workload (no harness pause): closer to production where
    // the process dies while clients may still be mutating / reconnecting on their own.
    const restartDuringWorkload = (async () => {
      if (SERVER_RESTART_AT_MS <= 0) return;
      await new Promise<void>(r => setTimeout(r, SERVER_RESTART_AT_MS));
      runLogger.log('server_restart', {
        phase: 'random_mix_workload',
        atMsSinceWorkloadStart: Date.now() - workloadStart,
        scheduledAtMs: SERVER_RESTART_AT_MS,
      } as any);
      await lifecycle.restartServer();
    })();

    while (Date.now() - workloadStart < TEST_DURATION_MS) {
      await randomCrudGap();
      let writerIdx = Math.floor(Math.random() * clients.length);
      let writer = clients[writerIdx]!;
      let writerClientId = `client-${writerIdx}`;

      const withRows = clientsWithLocalRows(clients);
      const deletePick = pickRandomWriterAndRecordIdForDelete(clients);
      const mayAttemptDelete =
        deletesPerformed < maxIntegrationDeletes
        && deletePick != null
        && Math.random() < SYNC_TEST_INTEGRATION_DELETE_ROLL_CHANCE;

      if (mayAttemptDelete) {
        const { writer: dw, writerClientId: delClientId, recordId } = deletePick;
        const removed = await dw.remove(recordId);
        if (removed) {
          recordHarnessDelete(recordId);
          deletesPerformed += 1;
          harnessRecordIds.delete(recordId);
          runLogger.log('client_remove', {
            clientId: delClientId,
            recordId,
            phase: 'random_mix_delete',
            opIndex,
            deletesPerformed,
            maxIntegrationDeletes,
          } as any);
        } else {
          runLogger.log('client_remove_kept_due_to_history', {
            clientId: delClientId,
            recordId,
            phase: 'random_mix_delete_skipped',
            opIndex,
          } as any);
        }
        opIndex += 1;
        continue;
      }

      const atCap = harnessRecordIds.size >= SYNC_TEST_INTEGRATION_MAX_RECORDS;
      const canUpdate = withRows.length > 0;

      let doCreate: boolean;
      if (atCap) {
        doCreate = false;
      } else if (!canUpdate) {
        doCreate = true;
      } else {
        doCreate = Math.random() < 0.5;
      }

      if (doCreate) {
        const record = createNewRecord(writerClientId);
        await writer.upsert(record);
        recordHarnessUpsert(writerClientId, undefined, record);
        harnessRecordIds.add(record.id);
        runLogger.log('client_upsert', {
          clientId: writerClientId,
          recordId: record.id,
          phase: 'random_mix_create',
          opIndex,
          distinctRecordCount: harnessRecordIds.size,
        });
      } else {
        if (writer.getLocalRecords().length === 0) {
          const w2 = withRows[Math.floor(Math.random() * withRows.length)]!;
          writerIdx = clients.indexOf(w2);
          writer = w2;
          writerClientId = `client-${writerIdx}`;
        }
        const lr = writer.getLocalRecords();
        const basePick = lr[Math.floor(Math.random() * lr.length)]!;
        const base = JSON.parse(JSON.stringify(basePick)) as SyncTestRecord;
        const localPrev = await writer.getLocal(base.id);
        if (localPrev == null) {
          // Record was deleted via S2C between getLocalRecords() and getLocal() — skip this op
          continue;
        }
        const record = mutateRecordRandom({ ...localPrev, clientId: writerClientId }, writerClientId);
        await writer.upsert(record);
        recordHarnessUpsert(writerClientId, localPrev, record);
        runLogger.log('client_upsert', {
          clientId: writerClientId,
          recordId: record.id,
          phase: 'random_mix_update',
          opIndex,
          distinctRecordCount: harnessRecordIds.size,
        });
      }
      opIndex += 1;
    }

    await restartDuringWorkload;

    runLogger.log('sync_response', {
      phase: 'phase_marker',
      marker: 'random_mix_workload_done',
      workloadDurationMs: TEST_DURATION_MS,
      elapsedWorkloadMs: Date.now() - workloadStart,
      totalOps: opIndex,
      maxRecords: SYNC_TEST_INTEGRATION_MAX_RECORDS,
      maxIntegrationDeletes,
      deletesPerformed,
      distinctHarnessIds: harnessRecordIds.size,
    });

    /* FULL STRESS WORKLOAD (temporary commented out — reconnect with imports + randomDelay)
    const startTime = Date.now();
    let serverRestartDone = false;

    const restartTimer = (async () => {
      if (SERVER_RESTART_AT_MS <= 0) return;
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
        const roll = Math.random();
        // Workload is intentionally limited to create/update only for now. The `delete` and final
        // `else` (disconnect + offline ops) branches below are kept so we can re-enable them without
        // rewriting helpers — do not remove as "dead code".
        const action: 'create' | 'update' = roll < 0.5 ? 'create' : 'update';

        const runUpsert = async (record: SyncTestRecord, prev: SyncTestRecord | undefined, offline: boolean) => {
          try {
            const offlineActual = !client.getIsConnected();
            await client.upsert(record);
            recordHarnessUpsert(clientId, prev, record);
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
              recordHarnessDelete(recordId);
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
          await runUpsert(record, undefined, false);
        } else if (action === 'update') {
          // Use the client's LOCAL records for mutation — not the shared expectedState.
          // Using expectedState can cause ops relative to a version the client doesn't have,
          // leading to duplicate array entries or wrong diffs when merged on the server.
          const localRecords = client.getLocalRecords();
          if (localRecords.length > 0) {
            const existing = localRecords[Math.floor(Math.random() * localRecords.length)]!;
            const record = mutateRecordRandom({ ...existing }, clientId);
            await runUpsert(record, existing, false);
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
            await runUpsert(record, undefined, true);
          } else if (sub < 0.7) {
            const expected = getExpectedState();
            if (expected.size > 0) {
              const ids = Array.from(expected.keys());
              const id = ids[Math.floor(Math.random() * ids.length)]!;
              const existing = expected.get(id)!;
              const record = mutateRecordRandom({ ...existing }, clientId);
              await runUpsert(record, existing, true);
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
    */

    // Post-workload only (after TEST_DURATION_MS): no harness CRUD until assertions — wait for sockets idle, then Mongo settle below.
    runLogger.log('sync_request', { phase: 'quiet_period', stableMs: QUIET_PERIOD_STABLE_MS, timeoutMs: QUIET_PERIOD_TIMEOUT_MS });
    await waitAllIdle(clients, runLogger);
    runLogger.log('sync_response', { phase: 'quiet_period', status: 'idle' });

    // Oracle = client live query rows. Re-read each poll: S2C can update the client while we wait for Mongo.
    const settleDeadline = Date.now() + QUIET_PERIOD_TIMEOUT_MS;
    runLogger.log('sync_request', { phase: 'phase_marker', marker: 'mongo_settle_begin' });
    let lastMissing = Number.POSITIVE_INFINITY;
    let lastExtra = Number.POSITIVE_INFINITY;
    let lastValueMismatch = Number.POSITIVE_INFINITY;
    let lastPassed = false;
    let expectedState!: Map<string, SyncTestRecord>;
    while (Date.now() < settleDeadline) {
      expectedState = expectedStateFromClients(clients);
      const currentServer = await readServerRecords(lifecycle.mongoUri);
      const report = getIntegrityReport(currentServer, expectedState);
      lastPassed = report.passed;
      if (report.passed) break;
      const { missingCount, extraCount, valueMismatchCount } = report;
      if (
        missingCount !== lastMissing
        || extraCount !== lastExtra
        || valueMismatchCount !== lastValueMismatch
      ) {
        runLogger.log('sync_response', {
          phase: 'mongo_settle',
          status: 'waiting_server',
          missing: missingCount,
          extra: extraCount,
          valueMismatches: valueMismatchCount,
        } as any);
        lastMissing = missingCount;
        lastExtra = extraCount;
        lastValueMismatch = valueMismatchCount;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'mongo_settle_end', lastPassed });
    logPostSettleDiagnostics('after_mongo_settle', clients, runLogger);

    // Small extra settle time for DB watchers after the last writes land.
    runLogger.log('sync_request', { phase: 'phase_marker', marker: 'final_grace_begin', ms: FINAL_SYNC_GRACE_MS });
    await new Promise(r => setTimeout(r, FINAL_SYNC_GRACE_MS));
    runLogger.log('sync_response', { phase: 'phase_marker', marker: 'final_grace_end' });
    logPostSettleDiagnostics('after_final_grace_before_final_report', clients, runLogger);

    expectedState = expectedStateFromClients(clients);
    const serverRecords = await readServerRecords(lifecycle.mongoUri);
    await emitFinalReport('normal_end', expectedState, { enforceTruthAlignment: true });

    assertIntegrity(serverRecords, expectedState, runLogger);

    expect(serverRecords.length).toBe(expectedState.size);
    expect(expectedState.size).toBeLessThanOrEqual(SYNC_TEST_INTEGRATION_MAX_RECORDS);
  }, 300_000);
});
