import type { E2eTestRecord, RunLogger } from '../setup/types';

export interface IntegrityReport {
  expectedCount: number;
  serverCount: number;
  matchedCount: number;
  missingCount: number;
  missingIds: string[];
  extraCount: number;
  extraIds: string[];
  valueMismatchCount: number;
  valueMismatches: Array<{ id: string; expected: E2eTestRecord; actual: E2eTestRecord }>;
  passed: boolean;
}

/**
 * Compute integrity stats without throwing. Use for reporting.
 */
export function getIntegrityReport(
  serverRecords: E2eTestRecord[],
  expectedState: Map<string, E2eTestRecord>,
): IntegrityReport {
  const serverById = new Map<string, E2eTestRecord>();
  for (const r of serverRecords) {
    serverById.set(r.id, r);
  }

  const missingIds: string[] = [];
  const extraIds: string[] = [];
  const valueMismatches: Array<{ id: string; expected: E2eTestRecord; actual: E2eTestRecord }> = [];
  let matchedCount = 0;

  for (const [id, expected] of expectedState) {
    const actual = serverById.get(id);
    if (actual == null) {
      missingIds.push(id);
    } else {
      serverById.delete(id);
      if (e2eTestRecordsEqual(expected, actual)) {
        matchedCount += 1;
      } else {
        valueMismatches.push({ id, expected, actual });
      }
    }
  }
  serverById.forEach((_, id) => extraIds.push(id));

  const passed =
    missingIds.length === 0 && valueMismatches.length === 0 && extraIds.length === 0;

  return {
    expectedCount: expectedState.size,
    serverCount: serverRecords.length,
    matchedCount,
    missingCount: missingIds.length,
    missingIds,
    extraCount: extraIds.length,
    extraIds,
    valueMismatchCount: valueMismatches.length,
    valueMismatches,
    passed,
  };
}

/**
 * Compare server records with expected state (see `recordsOfTruth.getExpectedState()`).
 * Logs diffs and throws if any mismatch.
 */
export function assertIntegrity(
  serverRecords: E2eTestRecord[],
  expectedState: Map<string, E2eTestRecord>,
  runLogger: RunLogger,
): void {
  const report = getIntegrityReport(serverRecords, expectedState);

  if (!report.passed) {
    runLogger.log('error', {
      missingOnServer: report.missingIds,
      valueMismatch: report.valueMismatches.map(({ id, expected, actual }) => ({ id, expected, actual })),
      extraOnServer: report.extraIds,
    });
    const messages: string[] = [];
    if (report.missingCount > 0) {
      messages.push(`Missing on server: ${report.missingIds.join(', ')}`);
    }
    if (report.valueMismatchCount > 0) {
      messages.push(
        `Value mismatch: ${report.valueMismatches.map(m => `${m.id} (expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)})`).join('; ')}`,
      );
    }
    if (report.extraCount > 0) {
      messages.push(`Server has extra records not in expected state: ${report.extraIds.join(', ')}`);
    }
    throw new Error(`Integrity assertion failed: ${messages.join('. ')}`);
  }
}

/** Deep equality for default e2e fixture rows (replay oracle, truth maps). */
export function e2eTestRecordsEqual(a: E2eTestRecord, b: E2eTestRecord): boolean {
  if (a.id !== b.id || a.clientId !== b.clientId || a.testDate !== b.testDate) return false;
  if ((a.name !== undefined || b.name !== undefined) && a.name !== b.name) return false;
  if ((a.value !== undefined || b.value !== undefined) && a.value !== b.value) return false;
  if (!nestedEqual(a.metadata, b.metadata)) return false;
  if (!arrayEqual(a.tags ?? undefined, b.tags ?? undefined)) return false;
  return true;
}

function nestedEqual(x: E2eTestRecord['metadata'], y: E2eTestRecord['metadata']): boolean {
  if (x === y) return true;
  if (x == null || y == null) return x == null && y == null;
  if (x.count !== y.count) return false;
  if ((x.tag !== undefined || y.tag !== undefined) && x.tag !== y.tag) return false;
  return true;
}

function arrayEqual(x: string[] | undefined, y: string[] | undefined): boolean {
  if (x === y) return true;
  if (x == null || y == null) return x == null && y == null;
  if (x.length !== y.length) return false;
  return x.every((v, i) => v === y[i]);
}
