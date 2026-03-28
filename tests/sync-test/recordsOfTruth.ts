/**
 * Records of truth mirror {@link AuditOf}: per record id, the same audit entry shapes the client uses
 * ({@link auditor.createAuditFrom}, {@link auditor.updateAuditWith}, {@link auditor.delete}).
 * Expected rows are {@link auditor.createRecordFrom} on each audit. ULIDs come from the shared
 * auditor generator so ordering matches client audit semantics (replay sorts by entry id).
 *
 * Sync-test policy: no `Branched` audit entries — `truthVsServerAuditCompare` treats them as errors on truth or server.
 */
import type { AuditOf } from '../../src/common';
import { auditor } from '../../src/common';
import type { SyncTestRecord } from './types';
import { syncTestRecordsEqual } from './integrityAssertions';

const auditByRecordId = new Map<string, AuditOf<SyncTestRecord>>();
let harnessMutationCount = 0;

function cloneRecord(record: SyncTestRecord): SyncTestRecord {
  return JSON.parse(JSON.stringify(record)) as SyncTestRecord;
}

/**
 * Log an upsert the same way the client {@link DbCollection.upsert} builds audit:
 * new id → Created; otherwise → Updated (or Restored after a delete) via {@link auditor.updateAuditWith}.
 *
 * @param prev Baseline row before this write (the client’s `oldRecord`). Use `undefined` for first create
 *             or when the writer has no row (e.g. restore after delete).
 */
export function recordHarnessUpsert(clientId: string, prev: SyncTestRecord | undefined, next: SyncTestRecord): void {
  if (next.clientId !== clientId) {
    throw new Error(`recordHarnessUpsert: clientId mismatch (arg "${clientId}" vs record "${next.clientId}")`);
  }
  harnessMutationCount += 1;
  const nextClone = cloneRecord(next);
  const existing = auditByRecordId.get(next.id);
  if (existing == null) {
    auditByRecordId.set(next.id, auditor.createAuditFrom(nextClone));
    return;
  }
  auditByRecordId.set(
    next.id,
    auditor.updateAuditWith(nextClone, existing, prev ?? undefined),
  );
}

/** Log a successful remove (same audit effect as client {@link DbCollection.delete} with default audit). */
export function recordHarnessDelete(recordId: string): void {
  const existing = auditByRecordId.get(recordId);
  if (existing == null) {
    throw new Error(`recordHarnessDelete: no truth audit for record "${recordId}"`);
  }
  harnessMutationCount += 1;
  auditByRecordId.set(recordId, auditor.delete(existing));
}

/** Immutable snapshot: record id → audit document (entries match client/server audit shapes). */
export function getTruthAudits(): ReadonlyMap<string, AuditOf<SyncTestRecord>> {
  return new Map(auditByRecordId);
}

/** Materialise every tracked audit; ids with no live row are omitted. */
export function getExpectedState(): Map<string, SyncTestRecord> {
  const result = new Map<string, SyncTestRecord>();
  for (const [id, audit] of auditByRecordId) {
    const r = auditor.createRecordFrom(audit);
    if (r != null) result.set(id, cloneRecord(r));
  }
  return result;
}

/** Same as {@link getExpectedState}; kept for call sites that name it “replay”. */
export function replayTruthOpsInOrder(): Map<string, SyncTestRecord> {
  return getExpectedState();
}

export function clear(): void {
  auditByRecordId.clear();
  harnessMutationCount = 0;
}

/** Number of harness {@link recordHarnessUpsert} / {@link recordHarnessDelete} calls. */
export function getHarnessMutationCount(): number {
  return harnessMutationCount;
}

/** Sum of audit entry counts across all tracked records. */
export function getEntryCount(): number {
  let n = 0;
  for (const audit of auditByRecordId.values()) {
    n += auditor.entriesOf(audit).length;
  }
  return n;
}

/** Deep equality for two id → record maps (sync test record shape). */
export function truthMapsEqual(a: Map<string, SyncTestRecord>, b: Map<string, SyncTestRecord>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, ra] of a) {
    const rb = b.get(id);
    if (rb == null || !syncTestRecordsEqual(ra, rb)) return false;
  }
  return true;
}
