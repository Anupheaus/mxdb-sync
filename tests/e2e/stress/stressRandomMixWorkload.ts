import { expect } from 'vitest';
import {
  getAppLoggerErrorCount,
  useRunLogger,
  useServer,
  waitForAllClientsIdle,
  type E2EClientHandle,
  type E2eTestRecord,
} from '../setup';
import {
  CONNECTIVITY_DOWN_MAX_MS,
  CONNECTIVITY_DOWN_MIN_MS,
  CONNECTIVITY_ISSUE_CLIENT_COUNT,
  CONNECTIVITY_STOP_BEFORE_END_MS,
  CONNECTIVITY_UP_MAX_MS,
  CONNECTIVITY_UP_MIN_MS,
  E2E_STRESS_DELETE_ROLL_CHANCE,
  E2E_STRESS_MAX_RECORDS,
  FINAL_SYNC_GRACE_MS,
  QUIET_PERIOD_STABLE_MS,
  QUIET_PERIOD_TIMEOUT_MS,
  SERVER_RESTART_AT_MS,
  TEST_DURATION_MS,
} from './config';
import { recordHarnessDelete, recordHarnessUpsert } from './recordsOfTruth';
import { assertIntegrity, getIntegrityReport } from './stressIntegrityAssertions';
import { expectedStateFromClients } from './stressClientOracle';
import { createNewRecord, mutateRecordRandom, networkLatencyDelay, randomCrudGap } from './stressRandomCrud';
import { logPostSettleDiagnostics } from './stressIntegrityDiagnostics';
import type { RunLogger } from '../setup/types';

export interface StressRandomMixWorkloadDeps {
  clients: readonly E2EClientHandle[];
  emitFinalReport: (
    reason: string,
    expectedStateOverride?: Map<string, E2eTestRecord>,
    options?: { enforceTruthAlignment?: boolean },
  ) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Shared mutable state across all concurrent workers (safe in single-threaded JS
// as long as we don't yield between read and write of the same field).
// ---------------------------------------------------------------------------
interface SharedWorkloadState {
  harnessRecordIds: Set<string>;
  deletesPerformed: number;
  maxDeletes: number;
  opIndex: number;
}

// ---------------------------------------------------------------------------
// Per-client concurrent worker
// ---------------------------------------------------------------------------
async function runClientWorker(
  client: E2EClientHandle,
  clientId: string,
  shared: SharedWorkloadState,
  deadline: number,
  runLogger: RunLogger,
): Promise<void> {
  while (Date.now() < deadline) {
    // User think-time + simulated network RTT
    await randomCrudGap();
    await networkLatencyDelay();

    const opIndex = shared.opIndex++;
    const localRecords = await client.getLocalRecords();

    // ---- delete roll ----
    const mayDelete =
      shared.deletesPerformed < shared.maxDeletes
      && localRecords.length > 0
      && Math.random() < E2E_STRESS_DELETE_ROLL_CHANCE;

    if (mayDelete) {
      const pick = localRecords[Math.floor(Math.random() * localRecords.length)]!;
      const removed = await client.remove(pick.id);
      if (removed) {
        recordHarnessDelete(pick.id);
        shared.deletesPerformed++;
        shared.harnessRecordIds.delete(pick.id);
        runLogger.log('client_remove', {
          clientId,
          recordId: pick.id,
          phase: 'random_mix_delete',
          opIndex,
          deletesPerformed: shared.deletesPerformed,
          maxIntegrationDeletes: shared.maxDeletes,
        } as any);
      } else {
        runLogger.log('client_remove_kept_due_to_history', {
          clientId,
          recordId: pick.id,
          phase: 'random_mix_delete_skipped',
          opIndex,
        } as any);
      }
      continue;
    }

    // ---- create / update decision ----
    const atCap = shared.harnessRecordIds.size >= E2E_STRESS_MAX_RECORDS;
    const canUpdate = localRecords.length > 0;

    let doCreate: boolean;
    if (atCap) doCreate = false;
    else if (!canUpdate) doCreate = true;
    else doCreate = Math.random() < 0.5;

    if (doCreate) {
      const record = createNewRecord(clientId);
      // Add to shared set BEFORE the yield so the soft cap is visible to other
      // workers immediately (prevents concurrent cap-overshoot).
      shared.harnessRecordIds.add(record.id);
      await client.upsert(record);
      recordHarnessUpsert(clientId, undefined, record);
      runLogger.log('client_upsert', {
        clientId,
        recordId: record.id,
        phase: 'random_mix_create',
        opIndex,
        distinctRecordCount: shared.harnessRecordIds.size,
      });
    } else if (canUpdate) {
      const basePick = localRecords[Math.floor(Math.random() * localRecords.length)]!;
      const localPrev = await client.getLocalRecord(basePick.id);
      if (localPrev == null) continue;
      const record = mutateRecordRandom({ ...localPrev, clientId }, clientId);
      await client.upsert(record);
      recordHarnessUpsert(clientId, localPrev, record);
      runLogger.log('client_upsert', {
        clientId,
        recordId: record.id,
        phase: 'random_mix_update',
        opIndex,
        distinctRecordCount: shared.harnessRecordIds.size,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Random connectivity disruptions for a single flaky client
// ---------------------------------------------------------------------------
async function runSingleClientDisruption(
  client: E2EClientHandle,
  clientId: string,
  stopAt: number,
  runLogger: RunLogger,
): Promise<void> {
  // Initial delay before first disruption (3-8 s) so the client establishes
  // baseline sync before we start pulling the rug.
  await new Promise<void>(r => setTimeout(r, 3_000 + Math.random() * 5_000));

  while (Date.now() < stopAt) {
    // Disconnect
    runLogger.log('client_disconnect', {
      clientId,
      phase: 'connectivity_disruption',
    });
    try {
      await client.disconnect();
    } catch (err) {
      // Client may already be disconnected (e.g. server restart mid-disruption)
      runLogger.log('sync_response', {
        phase: 'connectivity_disruption_disconnect_error',
        clientId,
        error: String((err as any)?.message ?? err),
      } as any);
    }

    // Stay disconnected
    const downMs =
      CONNECTIVITY_DOWN_MIN_MS +
      Math.random() * (CONNECTIVITY_DOWN_MAX_MS - CONNECTIVITY_DOWN_MIN_MS);
    await new Promise<void>(r => setTimeout(r, downMs));

    // Reconnect (may block if server is also restarting — the 30 s
    // timeout inside reconnect() covers that)
    runLogger.log('client_connect', {
      clientId,
      phase: 'connectivity_disruption_reconnect',
    });
    try {
      await client.reconnect();
    } catch (err) {
      runLogger.log('sync_response', {
        phase: 'connectivity_disruption_reconnect_error',
        clientId,
        error: String((err as any)?.message ?? err),
      } as any);
      // If reconnect fails we bail out of the disruption loop for this
      // client — the settle phase's waitForAllClientsIdle will catch it.
      return;
    }

    // Stay connected before next disruption
    const upMs =
      CONNECTIVITY_UP_MIN_MS +
      Math.random() * (CONNECTIVITY_UP_MAX_MS - CONNECTIVITY_UP_MIN_MS);
    await new Promise<void>(r => setTimeout(r, upMs));
  }
}

/**
 * Launch connectivity disruption loops for a random subset of clients.
 * At least one client is guaranteed to be flaky.
 */
async function runConnectivityDisruptions(
  clients: readonly E2EClientHandle[],
  stopAt: number,
  runLogger: RunLogger,
): Promise<void> {
  const numFlaky = Math.min(
    Math.max(1, CONNECTIVITY_ISSUE_CLIENT_COUNT),
    clients.length,
  );

  // Pick random distinct client indices
  const flakyIndices = new Set<number>();
  while (flakyIndices.size < numFlaky) {
    flakyIndices.add(Math.floor(Math.random() * clients.length));
  }

  const flakyClientIds = [...flakyIndices].map(i => `client-${i}`);
  runLogger.log('test_setup', {
    phase: 'connectivity_disruption_config',
    flakyClients: flakyClientIds,
    stopBeforeEndMs: CONNECTIVITY_STOP_BEFORE_END_MS,
  } as any);

  await Promise.all(
    [...flakyIndices].map(idx =>
      runSingleClientDisruption(
        clients[idx]!,
        `client-${idx}`,
        stopAt,
        runLogger,
      ),
    ),
  );
}

// ---------------------------------------------------------------------------
// Main workload orchestrator
// ---------------------------------------------------------------------------
export async function runStressRandomMixWorkload(deps: StressRandomMixWorkloadDeps): Promise<void> {
  const { clients, emitFinalReport } = deps;
  const runLogger = useRunLogger();
  const server = useServer();

  await Promise.all(clients.map(c => c.subscribeGetAll()));
  runLogger.log('sync_response', { phase: 'phase_marker', marker: 'all_clients_getAll_subscribed' });

  const maxIntegrationDeletes = Math.floor(E2E_STRESS_MAX_RECORDS / 2);
  const shared: SharedWorkloadState = {
    harnessRecordIds: new Set<string>(),
    deletesPerformed: 0,
    maxDeletes: maxIntegrationDeletes,
    opIndex: 0,
  };

  const workloadStart = Date.now();
  const deadline = workloadStart + TEST_DURATION_MS;

  runLogger.log('test_start', {
    numClients: clients.length,
    maxRecords: E2E_STRESS_MAX_RECORDS,
    maxDeletes: maxIntegrationDeletes,
    deleteRollChance: E2E_STRESS_DELETE_ROLL_CHANCE,
    workloadDurationMs: TEST_DURATION_MS,
    serverRestartAtMs: SERVER_RESTART_AT_MS,
    mode: 'concurrent',
    note: 'concurrent per-client workers with random create/update/delete, simulated network latency, random connectivity disruptions, and optional mid-workload server restart',
  });

  // ---- background: server restart ----
  const restartDuringWorkload = (async () => {
    if (SERVER_RESTART_AT_MS <= 0) return;
    await new Promise<void>(r => setTimeout(r, SERVER_RESTART_AT_MS));
    runLogger.log('server_restart', {
      phase: 'random_mix_workload',
      atMsSinceWorkloadStart: Date.now() - workloadStart,
      scheduledAtMs: SERVER_RESTART_AT_MS,
    } as any);
    await server.restartServer();
  })();

  // ---- background: connectivity disruptions ----
  const connectivityDisruption = runConnectivityDisruptions(
    clients,
    deadline - CONNECTIVITY_STOP_BEFORE_END_MS,
    runLogger,
  );

  // ---- concurrent client workers ----
  const workerPromises = clients.map((client, idx) =>
    runClientWorker(client, `client-${idx}`, shared, deadline, runLogger),
  );

  await Promise.all([...workerPromises, restartDuringWorkload, connectivityDisruption]);

  runLogger.log('sync_response', {
    phase: 'phase_marker',
    marker: 'random_mix_workload_done',
    workloadDurationMs: TEST_DURATION_MS,
    elapsedWorkloadMs: Date.now() - workloadStart,
    totalOps: shared.opIndex,
    maxRecords: E2E_STRESS_MAX_RECORDS,
    maxIntegrationDeletes,
    deletesPerformed: shared.deletesPerformed,
    distinctHarnessIds: shared.harnessRecordIds.size,
  });

  // ===========================================================================
  // Settle phase — wait for server to converge with all clients
  // ===========================================================================
  const settleDeadline = Date.now() + QUIET_PERIOD_TIMEOUT_MS;
  runLogger.log('sync_request', { phase: 'phase_marker', marker: 'mongo_settle_begin' });
  let lastMissing = Number.POSITIVE_INFINITY;
  let lastExtra = Number.POSITIVE_INFINITY;
  let lastValueMismatch = Number.POSITIVE_INFINITY;
  let lastPassed = false;
  let expectedState!: Map<string, E2eTestRecord>;
  while (Date.now() < settleDeadline) {
    expectedState = await expectedStateFromClients(clients);
    const currentServer = await server.readLiveRecords();
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
  await logPostSettleDiagnostics('after_mongo_settle', clients, runLogger);

  runLogger.log('sync_request', { phase: 'phase_marker', marker: 'final_grace_begin', ms: FINAL_SYNC_GRACE_MS });
  await new Promise(r => setTimeout(r, FINAL_SYNC_GRACE_MS));
  runLogger.log('sync_response', { phase: 'phase_marker', marker: 'final_grace_end' });
  await logPostSettleDiagnostics('after_final_grace_before_final_report', clients, runLogger);

  runLogger.log('sync_request', { phase: 'quiet_period', stableMs: QUIET_PERIOD_STABLE_MS, timeoutMs: QUIET_PERIOD_TIMEOUT_MS });
  await waitForAllClientsIdle(clients, {
    timeoutMs: QUIET_PERIOD_TIMEOUT_MS,
    stableTicksRequired: Math.ceil(QUIET_PERIOD_STABLE_MS / 200),
    pollMs: 200,
    requireConnected: true,
  });
  runLogger.log('sync_response', { phase: 'quiet_period', status: 'idle' });

  expectedState = await expectedStateFromClients(clients);
  const serverRecords = await server.readLiveRecords();
  await emitFinalReport('normal_end', expectedState, { enforceTruthAlignment: true });

  expect(getAppLoggerErrorCount(), 'no Logger.error during stress workload / settle').toBe(0);

  assertIntegrity(serverRecords, expectedState, runLogger);

  expect(serverRecords.length).toBe(expectedState.size);
  expect(expectedState.size).toBeLessThanOrEqual(E2E_STRESS_MAX_RECORDS * 2);
}
