import { is } from '@anupheaus/common';
import {
  AuditEntryType,
  auditor,
  type AuditEntry,
  type AuditOf,
  type AuditUpdateEntry,
  type ServerAuditOf,
} from '../../../src/common';
import type { E2eTestRecord } from '../setup/types';

/** E2e stress policy: harness and settled server audits must not use {@link AuditEntryType.Branched}. */
export function assertNoBranchedEntries(
  recordId: string,
  entries: ReadonlyArray<{ type: AuditEntryType }>,
  side: 'truth' | 'server',
): string[] {
  const violations: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    if (entries[i]!.type === AuditEntryType.Branched) {
      violations.push(`${side} record "${recordId}" entry[${i}] is Branched (not allowed in e2e fixture audits)`);
    }
  }
  return violations;
}

function sortByEntryUlid<T extends { id: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function stableJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

export interface TruthVsServerAuditEntryMismatch {
  recordId: string;
  index: number;
  kind: 'type' | 'payload';
  truthSummary: string;
  serverSummary: string;
}

export interface TruthVsServerAuditReport {
  passed: boolean;
  missingOnServer: string[];
  extraOnServer: string[];
  branchedViolations: string[];
  lengthMismatches: Array<{ recordId: string; truthLen: number; serverLen: number }>;
  entryMismatches: TruthVsServerAuditEntryMismatch[];
}

function typeLabel(t: AuditEntryType): string {
  return AuditEntryType[t] ?? String(t);
}

function summarizeTruthEntry(e: AuditEntry<E2eTestRecord>): string {
  switch (e.type) {
    case AuditEntryType.Created:
      return `${typeLabel(e.type)}(record.id=${(e as { record?: { id?: string } }).record?.id ?? '?'})`;
    case AuditEntryType.Restored:
      return (e as { record?: { id?: string } }).record != null
        ? `${typeLabel(e.type)}(record.id=${(e as { record?: { id?: string } }).record?.id ?? '?'})`
        : typeLabel(e.type);
    case AuditEntryType.Updated:
      return `${typeLabel(e.type)}(ops=${(e as AuditUpdateEntry).ops?.length ?? 0})`;
    case AuditEntryType.Deleted:
      return typeLabel(e.type);
    case AuditEntryType.Branched:
      return 'Branched';
    default:
      return String((e as { type: unknown }).type);
  }
}

function summarizeServerEntry(e: AuditEntry<E2eTestRecord>): string {
  return summarizeTruthEntry(e);
}

/** Both sides are compared as audit entry shapes; server entries omit some client-only fields in types only. */
function comparePairAtIndex(
  recordId: string,
  index: number,
  t: AuditEntry<E2eTestRecord>,
  s: AuditEntry<E2eTestRecord>,
): TruthVsServerAuditEntryMismatch | undefined {
  if (t.type !== s.type) {
    return {
      recordId,
      index,
      kind: 'type',
      truthSummary: summarizeTruthEntry(t),
      serverSummary: summarizeServerEntry(s),
    };
  }
  switch (t.type) {
    case AuditEntryType.Created: {
      const tr = (t as { record: E2eTestRecord }).record;
      const sr = (s as { record: E2eTestRecord }).record;
      if (!is.deepEqual(stableJson(tr), stableJson(sr))) {
        return {
          recordId,
          index,
          kind: 'payload',
          truthSummary: summarizeTruthEntry(t),
          serverSummary: summarizeServerEntry(s),
        };
      }
      return undefined;
    }
    case AuditEntryType.Restored: {
      const tr = (t as { record?: E2eTestRecord }).record;
      const sr = (s as { record?: E2eTestRecord }).record;
      if (tr === undefined && sr === undefined) return undefined;
      if (!is.deepEqual(stableJson(tr), stableJson(sr))) {
        return {
          recordId,
          index,
          kind: 'payload',
          truthSummary: summarizeTruthEntry(t),
          serverSummary: summarizeServerEntry(s),
        };
      }
      return undefined;
    }
    case AuditEntryType.Updated: {
      const tops = (t as AuditUpdateEntry).ops;
      const sops = (s as AuditUpdateEntry).ops;
      if (!is.deepEqual(tops, sops)) {
        return {
          recordId,
          index,
          kind: 'payload',
          truthSummary: summarizeTruthEntry(t),
          serverSummary: summarizeServerEntry(s),
        };
      }
      return undefined;
    }
    case AuditEntryType.Deleted:
      return undefined;
    case AuditEntryType.Branched:
      return {
        recordId,
        index,
        kind: 'type',
        truthSummary: 'Branched',
        serverSummary: 'Branched',
      };
    default:
      return {
        recordId,
        index,
        kind: 'type',
        truthSummary: summarizeTruthEntry(t),
        serverSummary: summarizeServerEntry(s),
      };
  }
}

/**
 * For each records-of-truth id, compare harness {@link AuditOf} to Mongo `_sync` {@link ServerAuditOf}.
 * Entry ULIDs are not compared; entries are sorted by ULID on each side, then compared pairwise (type + payload).
 * {@link AuditEntryType.Branched} must not appear on either side (e2e fixture invariant).
 */
export function compareTruthVsServerAudits(
  truth: ReadonlyMap<string, AuditOf<E2eTestRecord>>,
  server: ReadonlyMap<string, ServerAuditOf<E2eTestRecord>>,
): TruthVsServerAuditReport {
  const missingOnServer: string[] = [];
  const extraOnServer: string[] = [];
  const branchedViolations: string[] = [];
  const lengthMismatches: Array<{ recordId: string; truthLen: number; serverLen: number }> = [];
  const entryMismatches: TruthVsServerAuditEntryMismatch[] = [];

  for (const [recordId, tAudit] of truth) {
    const tEntries = auditor.entriesOf(tAudit);
    branchedViolations.push(...assertNoBranchedEntries(recordId, tEntries, 'truth'));

    const sAudit = server.get(recordId);
    if (sAudit == null) {
      missingOnServer.push(recordId);
      continue;
    }

    const sEntries = auditor.entriesOf(sAudit);
    branchedViolations.push(...assertNoBranchedEntries(recordId, sEntries, 'server'));

    const tChain = sortByEntryUlid(tEntries);
    const sChain = sortByEntryUlid(sEntries);

    if (tChain.length !== sChain.length) {
      lengthMismatches.push({ recordId, truthLen: tChain.length, serverLen: sChain.length });
      continue;
    }

    for (let i = 0; i < tChain.length; i++) {
      const m = comparePairAtIndex(recordId, i, tChain[i]!, sChain[i]!);
      if (m != null) entryMismatches.push(m);
    }
  }

  for (const recordId of server.keys()) {
    if (!truth.has(recordId)) extraOnServer.push(recordId);
  }

  const passed =
    missingOnServer.length === 0 &&
    extraOnServer.length === 0 &&
    branchedViolations.length === 0 &&
    lengthMismatches.length === 0 &&
    entryMismatches.length === 0;

  return {
    passed,
    missingOnServer,
    extraOnServer,
    branchedViolations,
    lengthMismatches,
    entryMismatches,
  };
}
