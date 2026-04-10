import { decodeTime } from 'ulidx';
import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import {
  AuditEntryType,
  type AnyAuditOf,
  type AuditOf,
  type AuditEntry,
  type AuditCreatedEntry,
  type AuditUpdateEntry,
  type AuditBranchedEntry,
  type AuditDeletedEntry,
  type AuditRestoredEntry,
} from './auditor-models';
import { recordDiff } from './diff';
import { applyOp, filterValidEntries, replayHistory, replayHistoryEndState } from './replay';

export type UlidGenerator = () => string;

export { filterValidEntries };

/** After a tombstoned live row, append Created or Restored (+ optional Updated) to reach `targetRecord`. */
function appendResurrectionEntries<T extends MXDBRecord>(
  audit: AnyAuditOf<T>,
  targetRecord: T,
  generateUlid: UlidGenerator,
  baseRecord: T | undefined,
  logger: Logger | undefined,
): AuditEntry<T>[] {
  const prior = entriesOf(audit);
  const { shadow } = replayHistoryEndState(prior as AuditEntry<T>[], baseRecord, logger);
  const rid = generateUlid();
  if (shadow == null) {
    return [...prior, {
      type: AuditEntryType.Created,
      id: rid,
      record: Object.clone(targetRecord),
    } as AuditCreatedEntry<T>];
  }
  const ops = recordDiff(shadow, targetRecord);
  if (ops.length === 0) {
    return [...prior, { type: AuditEntryType.Restored, id: rid } as AuditRestoredEntry<T>];
  }
  return [...prior, {
    type: AuditEntryType.Restored,
    id: rid,
    record: Object.clone(targetRecord),
  } as AuditRestoredEntry<T>];
}

/** Entries array from an audit document (empty if missing or malformed). */
export function entriesOf<T extends MXDBRecord>(audit: AnyAuditOf<T>): AuditEntry<T>[] {
  const { entries } = audit;
  return (Array.isArray(entries) ? entries : []) as AuditEntry<T>[];
}

/** Normalised shape: only `id` + `entries` (preserves server-only fields on unchanged entries). */
function withEntries<T extends MXDBRecord>(audit: AnyAuditOf<T>, next: AuditEntry<T>[]): AnyAuditOf<T> {
  return { id: audit.id, entries: next } as AnyAuditOf<T>;
}

/** Structural guard: string `id` and an `entries` array. */
export function isAuditDocument<T extends MXDBRecord>(value: unknown): value is AnyAuditOf<T> {
  if (typeof value !== 'object' || value == null) return false;
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string') return false;
  return Array.isArray(o.entries);
}

function typeDesc(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/** Human-readable reason when `value` is not {@link isAuditDocument}, or `null` if shape is ok. */
export function getAuditDocumentRejectionReason(value: unknown): string | null {
  if (typeof value !== 'object' || value == null) {
    return `expected non-null object (got ${typeDesc(value)})`;
  }
  const o = value as Record<string, unknown>;
  if (typeof o.id !== 'string') {
    return `audit.id must be a string (got ${typeDesc(o.id)})`;
  }
  if (!Array.isArray(o.entries)) {
    return `audit.entries must be an array (got ${typeDesc(o.entries)})`;
  }
  return null;
}

function isSyncOnlyAuditValid<T extends MXDBRecord>(audit: AnyAuditOf<T>): boolean {
  const e = entriesOf(audit);
  if (e.length === 0 || e.length > 2) return false;
  const t0 = e[0].type;
  if (t0 !== AuditEntryType.Created && t0 !== AuditEntryType.Branched) return false;
  if (e.length === 1) return true;
  const t1 = e[1].type;
  if (t1 === AuditEntryType.Updated) {
    const ops = (e[1] as AuditUpdateEntry).ops;
    return Array.isArray(ops) && ops.length === 0;
  }
  return t1 === AuditEntryType.Deleted;
}

function syncOnlyAuditRejectionReason<T extends MXDBRecord>(audit: AnyAuditOf<T>): string | null {
  if (isSyncOnlyAuditValid(audit)) return null;
  const e = entriesOf(audit);
  if (e.length === 0) return 'sync-only mode requires 1–2 entries (got 0)';
  if (e.length > 2) return `sync-only mode requires at most 2 entries (got ${e.length})`;
  const t0 = e[0].type;
  if (t0 !== AuditEntryType.Created && t0 !== AuditEntryType.Branched) {
    return `sync-only first entry must be Created(0) or Branched(4) (got type ${t0})`;
  }
  if (e.length < 2) {
    return 'sync-only audit rejected after anchor check (unexpected entry count)';
  }
  const t1 = e[1].type;
  if (t1 === AuditEntryType.Updated) {
    const ops = (e[1] as AuditUpdateEntry).ops;
    if (!Array.isArray(ops)) return 'sync-only second entry Updated.ops must be an array';
    return `sync-only second entry Updated must have empty ops (got ops.length=${ops.length})`;
  }
  return `sync-only second entry must be Updated(1) with empty ops or Deleted(2) (got type ${t1})`;
}

function isFullAuditValid<T extends MXDBRecord>(audit: AnyAuditOf<T>): boolean {
  const e = entriesOf(audit);
  if (e.length === 0) return false;
  const t0 = e[0].type;
  if (t0 !== AuditEntryType.Created && t0 !== AuditEntryType.Branched) return false;
  // Two-entry "anchor + empty Updated" is the sync-only pending shape, not a full microdiff audit.
  if (
    e.length === 2 &&
    e[1].type === AuditEntryType.Updated &&
    Array.isArray((e[1] as AuditUpdateEntry).ops) &&
    (e[1] as AuditUpdateEntry).ops.length === 0
  ) {
    return false;
  }
  return true;
}

function fullAuditRejectionReason<T extends MXDBRecord>(audit: AnyAuditOf<T>): string | null {
  if (isFullAuditValid(audit)) return null;
  const e = entriesOf(audit);
  if (e.length === 0) return 'full audit requires at least one entry (got 0)';
  const t0 = e[0].type;
  if (t0 !== AuditEntryType.Created && t0 !== AuditEntryType.Branched) {
    return `full audit first entry must be Created(0) or Branched(4) (got type ${t0})`;
  }
  if (
    e.length === 2 &&
    e[1].type === AuditEntryType.Updated &&
    Array.isArray((e[1] as AuditUpdateEntry).ops) &&
    (e[1] as AuditUpdateEntry).ops.length === 0
  ) {
    return 'full audit rejects anchor + empty Updated (sync-only pending shape); use non-empty ops or more entries';
  }
  return 'full audit validation failed (unexpected)';
}

/**
 * Why {@link isAudit} would reject `value`, or `null` if it would accept (including document shape).
 */
export function getIsAuditRejectionReason(value: unknown, fullAudit: boolean): string | null {
  const docReason = getAuditDocumentRejectionReason(value);
  if (docReason != null) return docReason;
  const audit = value as AnyAuditOf<MXDBRecord>;
  return fullAudit ? fullAuditRejectionReason(audit) : syncOnlyAuditRejectionReason(audit);
}

/**
 * Whether `value` is an acceptable audit for the collection mode.
 * `fullAudit` must match `MXDBCollectionConfig.disableAudit !== true` (full audit when true).
 * Pass `logger` to emit a warning with {@link getIsAuditRejectionReason} when validation fails.
 */
export function isAudit<T extends MXDBRecord>(
  value: unknown,
  fullAudit: boolean,
  logger?: Logger,
): value is AnyAuditOf<T> {
  const reason = getIsAuditRejectionReason(value, fullAudit);
  if (reason == null) return true;
  const id =
    typeof value === 'object' && value != null && typeof (value as AnyAuditOf<T>).id === 'string'
      ? (value as AnyAuditOf<T>).id
      : '?';
  logger?.warn(`[auditor] isAudit(fullAudit=${fullAudit}) rejected id="${id}": ${reason}`);
  return false;
}

// ─── Core API functions (pure, dependency-injected ULID) ──────────────────────

export function createAuditFrom<T extends MXDBRecord>(record: T, generateUlid: UlidGenerator): AuditOf<T> {
  const entryId = generateUlid();
  return {
    id: record.id,
    entries: [{
      type: AuditEntryType.Created,
      id: entryId,
      record: Object.clone(record),
    } as AuditCreatedEntry<T>],
  };
}

export function updateAuditWith<T extends MXDBRecord>(
  currentRecord: T | undefined,
  audit: AnyAuditOf<T>,
  generateUlid: UlidGenerator,
  baseRecord?: T,
  logger?: Logger,
): AnyAuditOf<T> {
  if (currentRecord == null) return deleteRecord(audit, generateUlid);

  const existingRecord = baseRecord ?? createRecordFrom(audit, undefined, logger);

  if (existingRecord == null) {
    return withEntries(audit, appendResurrectionEntries(audit, currentRecord, generateUlid, baseRecord, logger));
  }

  const ops = recordDiff(existingRecord, currentRecord);
  if (ops.length === 0) return audit;

  const entryId = generateUlid();
  return withEntries(audit, [...entriesOf(audit), {
    type: AuditEntryType.Updated,
    id: entryId,
    ops,
  } as AuditUpdateEntry]);
}

export function createRecordFrom<T extends MXDBRecord>(
  audit: AnyAuditOf<T>,
  baseRecord?: T,
  logger?: Logger,
): T | undefined {
  return replayHistory(entriesOf(audit) as AuditEntry<T>[], baseRecord, logger);
}

export function deleteRecord<T extends MXDBRecord>(audit: AnyAuditOf<T>, generateUlid: UlidGenerator): AnyAuditOf<T> {
  if (isDeleted(audit)) return audit;
  const entryId = generateUlid();
  return withEntries(audit, [...entriesOf(audit), {
    type: AuditEntryType.Deleted,
    id: entryId,
  } as AuditDeletedEntry]);
}

export function restoreTo<T extends MXDBRecord>(
  audit: AnyAuditOf<T>,
  record: T,
  generateUlid: UlidGenerator,
  baseRecord?: T,
  logger?: Logger,
): AnyAuditOf<T> {
  return withEntries(audit, appendResurrectionEntries(audit, record, generateUlid, baseRecord, logger));
}

export function createBranchFrom<T extends MXDBRecord>(recordId: string, lastSyncedEntryId: string): AuditOf<T> {
  return {
    id: recordId,
    entries: [{
      type: AuditEntryType.Branched,
      id: lastSyncedEntryId,
    } as AuditBranchedEntry],
  };
}

/**
 * Log full audit entry ULIDs — do not truncate to 8 chars: monotonic ULIDs from the same
 * millisecond share an identical timestamp prefix (often 10+ chars), so a short prefix looks
 * like duplicate ids when entries are distinct.
 */
function entryTypeSummary<T extends MXDBRecord>(list: AuditEntry<T>[], maxEntries = 24): string {
  return list
    .slice(0, maxEntries)
    .map(e => `${e.type}:${String(e.id)}`)
    .join(',');
}

/**
 * True when every entry is a materialisation op (no Created/Branched anchor).
 * Such payloads fail {@link isAudit}(…, true) but are safe to append when the server
 * already holds a valid full audit (Created/… history).
 */
function isPendingOnlyClientAudit<T extends MXDBRecord>(audit: AnyAuditOf<T>): boolean {
  const e = entriesOf(audit);
  if (e.length === 0) return false;
  const allowed = new Set([
    AuditEntryType.Updated,
    AuditEntryType.Deleted,
    AuditEntryType.Restored,
  ]);
  return e.every(entry => allowed.has(entry.type));
}

export function merge<T extends MXDBRecord>(
  serverAudit: AnyAuditOf<T>,
  clientAudit: AuditOf<T>,
  logger?: Logger,
  fullAudit = true,
): AnyAuditOf<T> {
  if (!isAuditDocument(serverAudit) || !isAuditDocument(clientAudit)) {
    if (!isAuditDocument(serverAudit)) {
      logger?.warn(
        `[auditor] merge skipped: server audit invalid document: ${getAuditDocumentRejectionReason(serverAudit)}`,
      );
    }
    if (!isAuditDocument(clientAudit)) {
      logger?.warn(
        `[auditor] merge skipped: client audit invalid document: ${getAuditDocumentRejectionReason(clientAudit)}`,
      );
    }
    return serverAudit;
  }

  const clientPasses = isAudit(clientAudit, fullAudit, logger);
  const pendingOnlyFallback =
    fullAudit &&
    !clientPasses &&
    isPendingOnlyClientAudit(clientAudit) &&
    isAudit(serverAudit, fullAudit, logger);

  if (!clientPasses && !pendingOnlyFallback) {
    const clientId = (clientAudit as AnyAuditOf<T>).id;
    logger?.debug(
      `[merge-diag] client audit rejected by isAudit(fullAudit=${fullAudit}) — keeping server entries only`,
      {
        recordId: clientId.slice(0, 8),
        serverEntryCount: entriesOf(serverAudit).length,
        clientEntryCount: entriesOf(clientAudit).length,
        clientTypes: entriesOf(clientAudit).map(e => e.type),
        clientSummary: entryTypeSummary(entriesOf(clientAudit)),
      },
    );
    return serverAudit;
  }

  if (pendingOnlyFallback) {
    const clientIdPending = (clientAudit as AnyAuditOf<T>).id;
    logger?.debug(
      '[merge-diag] client pending-only audit — merging into server full audit',
      {
        recordId: clientIdPending.slice(0, 8),
        serverEntryCount: entriesOf(serverAudit).length,
        clientEntryCount: entriesOf(clientAudit).length,
        clientSummary: entryTypeSummary(entriesOf(clientAudit)),
      },
    );
  }

  const ignoredTypes = new Set([AuditEntryType.Branched, AuditEntryType.Created]);
  const clientEntries = entriesOf(clientAudit).filter(e => !ignoredTypes.has(e.type));

  const existingIds = new Set(entriesOf(serverAudit).map(e => e.id));
  let duplicateCount = 0;
  const newEntries = clientEntries.filter(e => {
    if (existingIds.has(e.id)) {
      duplicateCount += 1;
      logger?.debug(`[auditor] §6.9#8 duplicate entry id "${e.id}" — keeping existing`);
      return false;
    }
    return true;
  });

  const merged = [...entriesOf(serverAudit), ...newEntries].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  const mergedDiag =
    `[merge-diag] merged record="${serverAudit.id.slice(0, 8)}" `
    + `server=${entriesOf(serverAudit).length} clientNonIgnored=${clientEntries.length} `
    + `appended=${newEntries.length} duplicatesSkipped=${duplicateCount} total=${merged.length}`;
  logger?.debug(mergedDiag, { mergedSummary: entryTypeSummary(merged) });

  return withEntries(serverAudit, merged);
}

export function collapseToAnchor<T extends MXDBRecord>(audit: AnyAuditOf<T>, lastSyncedEntryId: string): AnyAuditOf<T> {
  const list = entriesOf(audit);
  const idx = list.findIndex(e => e.id === lastSyncedEntryId);
  const pendingEntries = idx >= 0 ? list.slice(idx + 1) : [];

  const branch: AuditBranchedEntry = {
    type: AuditEntryType.Branched,
    id: lastSyncedEntryId,
  };

  return withEntries(audit, [branch, ...pendingEntries]);
}

export function hasHistory<T extends MXDBRecord>(audit: AnyAuditOf<T>): boolean {
  if (!isAuditDocument(audit)) return false;
  return entriesOf(audit).some(e =>
    e.type !== AuditEntryType.Created &&
    e.type !== AuditEntryType.Branched,
  );
}

export function hasPendingChanges<T extends MXDBRecord>(audit: AnyAuditOf<T>): boolean {
  if (!isAuditDocument(audit)) return false;
  const list = entriesOf(audit);
  const branchIdx = list.findIndex(e => e.type === AuditEntryType.Branched);
  if (branchIdx < 0) {
    return list.length > 0;
  }
  return list.slice(branchIdx + 1).some(e => e.type !== AuditEntryType.Branched && e.type !== AuditEntryType.Created);
}

export function isDeleted<T extends MXDBRecord>(audit: AnyAuditOf<T>): boolean {
  if (!isAuditDocument(audit)) return false;
  // Delete-is-final: find the latest Deleted or Restored entry by ULID order. Updates after
  // a Delete (higher ULIDs, still appended to the audit because merge does not prune them)
  // must NOT flip the tombstone state — only a subsequent Restored can. Previously this
  // scanned the array in insertion order and returned the last non-Branched entry, which
  // silently resurrected tombstoned records whenever a post-delete Update merged in and
  // caused `#buildAndPush` to bypass the §10.1 filter and push a stale cursor to a client
  // that had branched at an earlier entry.
  let latestTransition: { type: AuditEntryType; id: string } | undefined;
  for (const e of entriesOf(audit)) {
    if (e.type !== AuditEntryType.Deleted && e.type !== AuditEntryType.Restored) continue;
    if (latestTransition == null || e.id > latestTransition.id) latestTransition = e;
  }
  return latestTransition?.type === AuditEntryType.Deleted;
}

export function isBranchOnly<T extends MXDBRecord>(audit: AnyAuditOf<T>): boolean {
  if (!isAuditDocument(audit)) return false;
  return entriesOf(audit).every(e => e.type === AuditEntryType.Branched || e.type === AuditEntryType.Created);
}

export function getBranchUlid<T extends MXDBRecord>(audit: AnyAuditOf<T>): string | undefined {
  const branch = entriesOf(audit).find((e): e is AuditBranchedEntry => e.type === AuditEntryType.Branched);
  return branch?.id;
}

export function getLastEntryId<T extends MXDBRecord>(audit: AnyAuditOf<T>): string | undefined {
  const list = entriesOf(audit);
  if (list.length === 0) return undefined;
  const sorted = [...list].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return sorted[sorted.length - 1].id;
}

/** Millisecond timestamp of the lexicographically latest audit entry (same ordering as {@link getLastEntryId}). */
export function getLastEntryTimestamp<T extends MXDBRecord>(audit: AnyAuditOf<T>): number | undefined {
  const list = entriesOf(audit);
  if (list.length === 0) return undefined;
  const sorted = [...list].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const last = sorted[sorted.length - 1];
  try {
    return decodeTime(last.id);
  } catch {
    return undefined;
  }
}

/**
 * §6.3 — Rebase `userRecord` local edits on top of `newServerRecord`.
 */
export function rebaseRecord<T extends MXDBRecord>(
  oldServerRecord: T,
  userRecord: T,
  newServerRecord: T,
): T {
  const localOps = recordDiff(oldServerRecord, userRecord);
  if (localOps.length === 0) return newServerRecord;
  const result = Object.clone(newServerRecord) as T;
  for (const op of localOps) {
    applyOp(result, op);
  }
  return result;
}
