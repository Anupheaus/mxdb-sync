import type { AuditOf, ServerAuditOf } from '../../../src/common';
import type { E2EClientHandle, E2eTestRecord, RunLogger } from '../setup';
import { e2eTestRecordsEqual, type IntegrityReport } from './stressIntegrityAssertions';
import type { TruthVsServerAuditReport } from './truthVsServerAuditCompare';
import { expectedStateFromClients } from './stressClientOracle';

export function jsonClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export async function logPostSettleDiagnostics(
  when: 'after_mongo_settle' | 'after_final_grace_before_final_report',
  clientList: readonly E2EClientHandle[],
  runLog: RunLogger,
): Promise<void> {
  const expectedState = await expectedStateFromClients(clientList);
  const perClient = clientList.map((c, i) => ({
    clientId: `client-${i}`,
    pending: c.getPendingC2SSyncQueueSize(),
  }));
  const nonZero = perClient.filter(p => p.pending > 0);
  const totalPending = perClient.reduce((s, p) => s + p.pending, 0);
  runLog.log('sync_idle_snapshot', {
    when,
    expectedStateFromClientsInvoked: true,
    expectedStateFromClientsRecordCount: expectedState.size,
    c2sPendingEntryTotal: totalPending,
    c2sPendingNonZeroClients: nonZero,
  } as any);
}

export function collectIntegrityProblemRecordIds(
  report: IntegrityReport,
  oracle: Map<string, E2eTestRecord>,
  truthLive: Map<string, E2eTestRecord>,
  truthVsServer: TruthVsServerAuditReport | null,
): string[] {
  const s = new Set<string>();
  for (const id of report.missingIds) s.add(id);
  for (const id of report.extraIds) s.add(id);
  for (const m of report.valueMismatches) s.add(m.id);
  for (const [id, row] of oracle) {
    const t = truthLive.get(id);
    if (t == null || !e2eTestRecordsEqual(row, t)) s.add(id);
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

export async function logIntegrityMismatchRecordDetails(
  recordIds: string[],
  clientList: readonly E2EClientHandle[],
  runLog: RunLogger,
  params: {
    oracle: Map<string, E2eTestRecord>;
    truthLive: Map<string, E2eTestRecord>;
    truthAudits: ReadonlyMap<string, AuditOf<E2eTestRecord>>;
    serverRecords: E2eTestRecord[];
    serverAudits: Map<string, ServerAuditOf<E2eTestRecord>> | null;
  },
): Promise<void> {
  if (recordIds.length === 0 || clientList.length === 0) return;

  const serverById = new Map(params.serverRecords.map(r => [r.id, r]));

  for (const recordId of recordIds) {
    const perClient: Array<{
      clientId: string;
      localRecord: E2eTestRecord | null;
      localAudit: AuditOf<E2eTestRecord> | null;
    }> = [];

    for (let i = 0; i < clientList.length; i++) {
      const c = clientList[i]!;
      const [row, audit] = await Promise.all([c.getLocalRecord(recordId), c.getLocalAudit(recordId)]);
      if (row == null && audit == null) continue;
      perClient.push({
        clientId: `client-${i}`,
        localRecord: row != null ? jsonClone(row) : null,
        localAudit: audit != null ? jsonClone(audit) : null,
      });
    }

    runLog.log('validation_record_detail', {
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
