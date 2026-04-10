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
import {
  clientsWithLocalRows,
  expectedStateFromClients,
  pickRandomWriterAndRecordIdForDelete,
} from './stressClientOracle';
import { createNewRecord, mutateRecordRandom, randomCrudGap } from './stressRandomCrud';
import { logPostSettleDiagnostics } from './stressIntegrityDiagnostics';

export interface StressRandomMixWorkloadDeps {
  clients: readonly E2EClientHandle[];
  emitFinalReport: (
    reason: string,
    expectedStateOverride?: Map<string, E2eTestRecord>,
    options?: { enforceTruthAlignment?: boolean },
  ) => Promise<void>;
}

export async function runStressRandomMixWorkload(deps: StressRandomMixWorkloadDeps): Promise<void> {
  const { clients, emitFinalReport } = deps;
  const runLogger = useRunLogger();
  const server = useServer();

  await Promise.all(clients.map(c => c.subscribeGetAll()));
  runLogger.log('sync_response', { phase: 'phase_marker', marker: 'all_clients_getAll_subscribed' });

  const harnessRecordIds = new Set<string>();
  const workloadStart = Date.now();
  let opIndex = 0;
  let deletesPerformed = 0;
  const maxIntegrationDeletes = Math.floor(E2E_STRESS_MAX_RECORDS / 2);

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

  while (Date.now() - workloadStart < TEST_DURATION_MS) {
    await randomCrudGap();
    let writerIdx = Math.floor(Math.random() * clients.length);
    let writer = clients[writerIdx]!;
    let writerClientId = `client-${writerIdx}`;

    const withRows = await clientsWithLocalRows(clients);
    const deletePick = await pickRandomWriterAndRecordIdForDelete(clients);
    const mayAttemptDelete =
      deletesPerformed < maxIntegrationDeletes
      && deletePick != null
      && Math.random() < E2E_STRESS_DELETE_ROLL_CHANCE;

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

    const atCap = harnessRecordIds.size >= E2E_STRESS_MAX_RECORDS;
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
      if ((await writer.getLocalRecords()).length === 0) {
        const w2 = withRows[Math.floor(Math.random() * withRows.length)]!;
        writerIdx = clients.indexOf(w2);
        writer = w2;
        writerClientId = `client-${writerIdx}`;
      }
      const lr = await writer.getLocalRecords();
      const basePick = lr[Math.floor(Math.random() * lr.length)]!;
      const localPrev = await writer.getLocalRecord(basePick.id);
      if (localPrev == null) {
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
    maxRecords: E2E_STRESS_MAX_RECORDS,
    maxIntegrationDeletes,
    deletesPerformed,
    distinctHarnessIds: harnessRecordIds.size,
  });

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
  expect(expectedState.size).toBeLessThanOrEqual(E2E_STRESS_MAX_RECORDS);
}
