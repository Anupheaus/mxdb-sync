import { useRunLogger, useServer, type E2EClientHandle, type E2eTestRecord } from '../setup';
import {
  getEntryCount,
  getExpectedState,
  getHarnessMutationCount,
  getTruthAudits,
  replayTruthOpsInOrder,
  truthMapsEqual,
} from './recordsOfTruth';
import { getIntegrityReport } from './stressIntegrityAssertions';
import { compareTruthVsServerAudits, type TruthVsServerAuditReport } from './truthVsServerAuditCompare';
import { expectedStateFromClients } from './stressClientOracle';
import { collectIntegrityProblemRecordIds, logIntegrityMismatchRecordDetails } from './stressIntegrityDiagnostics';

export function createStressFinalReporter(getClients: () => readonly E2EClientHandle[]) {
  let reportEmitted = false;

  return {
    async emitFinalReport(
      reason: string,
      expectedStateOverride?: Map<string, E2eTestRecord>,
      options?: { enforceTruthAlignment?: boolean },
    ): Promise<void> {
      if (reportEmitted) return;
      reportEmitted = true;

      const runLogger = useRunLogger();
      const server = useServer();
      const clients = getClients();

      let truthMatchesClients = false;
      let truthMatchesServer = false;
      let truthVsServerAuditPassed = true;
      let truthVsServerAuditReport: TruthVsServerAuditReport | null = null;
      let truthVsServerReport = getIntegrityReport([], new Map());
      let reportBuilt = false;

      try {
        const expectedState =
          expectedStateOverride ?? (clients.length > 0 ? await expectedStateFromClients(clients) : getExpectedState());
        const serverRecords = await server.readLiveRecords();
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

        const serverAuditDocuments = await server.readAudits();
        truthVsServerAuditReport = compareTruthVsServerAudits(truthAudits, serverAuditDocuments);
        truthVsServerAuditPassed = truthVsServerAuditReport?.passed ?? true;

        const allAligned =
          report.passed && truthMatchesClients && truthMatchesServer && truthVsServerAuditPassed;

        runLogger.log('validation_summary', {
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
            expectedTestDate: m.expected.testDate,
            actualTestDate: m.actual.testDate,
            expectedKeys: Object.keys(m.expected),
            actualKeys: Object.keys(m.actual),
          })),
        } as any);

        if (!allAligned && clients.length > 0) {
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

        runLogger.log('sync_response', { phase: 'summary', summary });
        reportBuilt = true;
      } catch (error) {
        runLogger.log('error', { type: 'final_report_failed', reason, error: String((error as any)?.message ?? error) });
      }

      if (
        options?.enforceTruthAlignment === true
        && reportBuilt
        && (!truthMatchesClients || !truthMatchesServer || !truthVsServerAuditPassed)
      ) {
        runLogger.log('error', {
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
    },
  };
}
