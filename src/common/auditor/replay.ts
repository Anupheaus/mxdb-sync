import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import {
  AuditEntryType,
  TargetPosition,
  type AuditEntry,
  type AuditOperation,
  type AuditCreatedEntry,
  type AuditUpdateEntry,
  type AuditRestoredEntry,
} from './auditor-models';
import { contentHash } from './hash';

// ─── Path resolution helpers ──────────────────────────────────────────────────

/** Parse an audit path string into segments. */
export function parsePath(path: string): (string | number)[] {
  if (!path) return [];
  const segments: (string | number)[] = [];
  for (const seg of path.split('.')) {
    if (/^\[_?id:.+\]$/.test(seg)) {
      segments.push(seg); // boxed-id, kept as-is
      continue;
    }
    const num = Number(seg);
    segments.push(Number.isInteger(num) && seg !== '' ? num : seg);
  }
  return segments;
}

/** Resolve a segment within an array using boxed-id or hash anchoring. */
export function resolveArrayIndex(arr: unknown[], seg: string | number, hash?: string): number | undefined {
  if (typeof seg === 'number') {
    if (hash == null) return seg < arr.length ? seg : undefined;
    // Hash-anchored: find by content hash
    const idx = arr.findIndex(el => contentHash(el) === hash);
    return idx >= 0 ? idx : undefined;
  }
  // Boxed-id: [id:abc] or [_id:abc]
  const boxed = String(seg).match(/^\[(_?id):(.+)\]$/);
  if (boxed) {
    const field = boxed[1];
    const val = boxed[2];
    const idx = arr.findIndex(el => el != null && typeof el === 'object' && String((el as Record<string, unknown>)[field]) === val);
    return idx >= 0 ? idx : undefined;
  }
  return undefined;
}

// ─── Replay ───────────────────────────────────────────────────────────────────

export function filterValidEntries<T extends MXDBRecord>(entries: unknown[], logger?: Logger): AuditEntry<T>[] {
  const valid: AuditEntry<T>[] = [];

  for (const e of entries) {
    if (e == null || typeof e !== 'object') continue;
    const entry = e as Partial<AuditEntry<T>>;
    if (typeof entry.id !== 'string') continue;
    if (typeof entry.type !== 'number') continue;
    valid.push(entry as AuditEntry<T>);
  }

  if (valid.length !== entries.length) {
    logger?.warn(`[auditor] filtered ${entries.length - valid.length} invalid audit entries`);
  }

  return valid;
}

export function applyOp(record: unknown, op: AuditOperation, logger?: Logger): unknown {
  const rawSegs = parsePath(op.path);
  if (rawSegs.length === 0) {
    logger?.debug('[auditor] ignoring op with empty path');
    return record;
  }

  let parent: unknown = record;
  for (let i = 0; i < rawSegs.length - 1; i++) {
    const seg = rawSegs[i];
    if (parent == null || typeof parent !== 'object') {
      logger?.warn(`[auditor] §6.9#1 missing parent at "${rawSegs.slice(0, i).join('.')}" — ignoring op`);
      return record;
    }
    if (Array.isArray(parent)) {
      const idx = resolveArrayIndex(parent, seg, i === rawSegs.length - 2 ? op.hash : undefined);
      if (idx == null) {
        logger?.warn(`[auditor] §6.9#2/3 cannot resolve array index at seg "${seg}" — ignoring op`);
        return record;
      }
      parent = (parent as unknown[])[idx];
    } else {
      parent = (parent as Record<string, unknown>)[String(seg)];
    }
  }

  const lastSeg = rawSegs[rawSegs.length - 1];

  if (parent == null || typeof parent !== 'object') {
    logger?.warn('[auditor] §6.9#1 missing parent for last seg — ignoring op');
    return record;
  }

  try {
    if (Array.isArray(parent)) {
      const idx = resolveArrayIndex(parent, lastSeg, op.hash);
      // 0 = Remove, 1 = Replace, 2 = Move, 3 = Add
      if (op.type === 0) {
        if (idx == null) return record;
        (parent as unknown[]).splice(idx, 1);
      } else if (op.type === 1) {
        if (idx == null) return record;
        (parent as unknown[])[idx] = op.value;
      } else if (op.type === 3) {
        if (op.position === TargetPosition.First) {
          (parent as unknown[]).unshift(op.value);
        } else if (op.position === TargetPosition.Last || op.position == null) {
          (parent as unknown[]).push(op.value);
        } else {
          const insertIdx = idx ?? (parent as unknown[]).length;
          (parent as unknown[]).splice(insertIdx, 0, op.value);
        }
      } else if (op.type === 2) {
        if (idx == null) return record;
        const [item] = (parent as unknown[]).splice(idx, 1);
        if (op.position === TargetPosition.First) {
          (parent as unknown[]).unshift(item);
        } else {
          (parent as unknown[]).push(item);
        }
      }
    } else {
      const key = String(lastSeg);
      if (op.type === 0) {
        delete (parent as Record<string, unknown>)[key];
      } else if (op.type === 1 || op.type === 3) {
        (parent as Record<string, unknown>)[key] = op.value;
      }
    }
  } catch (err) {
    logger?.warn(`[auditor] §6.9#5 op threw: ${(err as Error)?.message} — ignoring op`);
  }

  return record;
}

function applyUpdateEntryToClone<T extends MXDBRecord>(
  record: T,
  entry: AuditUpdateEntry,
  logger?: Logger,
): T {
  const clone = Object.clone(record) as T;
  const ops = entry.ops ?? [];
  for (const op of ops) {
    applyOp(clone, op, logger);
  }
  return clone;
}

/** End state after replaying `entries` in ULID order (see {@link replayHistory}). */
export interface ReplayEndState<T extends MXDBRecord> {
  /** Semantic live row (undefined while tombstoned until {@link AuditEntryType.Restored}). */
  live: T | undefined;
  /**
   * Shadow row: same as live when live is set; after {@link AuditEntryType.Deleted}, keeps advancing
   * with {@link AuditEntryType.Updated} so a later Restored can copy it back to live.
   */
  shadow: T | undefined;
}

export function replayHistoryEndState<T extends MXDBRecord>(
  entries: AuditEntry<T>[],
  baseRecord: T | undefined,
  logger?: Logger,
): ReplayEndState<T> {
  const clean = filterValidEntries<T>(entries as unknown as unknown[], logger);
  const sorted = [...clean].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  let live: T | undefined = baseRecord;
  let shadow: T | undefined = baseRecord;
  let foundBase = baseRecord != null;

  logger?.debug(
    `[replay-diag] replayHistory start entries=${sorted.length} baseRecord=${baseRecord != null} order=${sorted.map(e => `${e.type}:${e.id}`).join(',')}`,
  );

  let entryIndex = 0;
  for (const entry of sorted) {
    entryIndex += 1;
    switch (entry.type) {
      case AuditEntryType.Created: {
        const createdRecord = (entry as AuditCreatedEntry<T>).record;
        if (createdRecord == null) {
          logger?.error(
            `[auditor] replay skip Created entry "${entry.id}" [${entryIndex}/${sorted.length}]: missing record payload`,
          );
        } else {
          logger?.debug(
            `[replay-diag] Created entry "${entry.id}" [${entryIndex}/${sorted.length}] — resetting live+shadow (hadBase=${foundBase})`,
          );
          const next = Object.clone(createdRecord);
          live = next;
          shadow = next;
          foundBase = true;
        }
        break;
      }
      case AuditEntryType.Branched:
        break;
      case AuditEntryType.Restored: {
        const payload = (entry as AuditRestoredEntry<T>).record;
        if (payload != null) {
          const next = Object.clone(payload);
          live = next;
          shadow = next;
        } else if (shadow != null) {
          live = Object.clone(shadow);
        }
        break;
      }
      case AuditEntryType.Deleted:
        live = undefined;
        break;
      case AuditEntryType.Updated: {
        if (shadow == null) {
          const opN = (entry as AuditUpdateEntry).ops?.length ?? 0;
          logger?.error(
            `[auditor] replay skip Updated entry "${entry.id}" [${entryIndex}/${sorted.length}]: `
            + `no materialized anchor (need Created or baseRecord in this replay window) (ops=${opN})`,
          );
          break;
        }
        const beforeTags = JSON.stringify((shadow as any)?.tags);
        const opCount = (entry as AuditUpdateEntry).ops?.length ?? 0;
        shadow = applyUpdateEntryToClone(shadow, entry as AuditUpdateEntry, logger);
        if (live != null) {
          live = applyUpdateEntryToClone(live, entry as AuditUpdateEntry, logger);
        }
        const afterTags = JSON.stringify((shadow as any)?.tags);
        if (beforeTags !== afterTags) {
          logger?.debug(
            `[replay-diag] Updated entry "${entry.id}" [${entryIndex}/${sorted.length}] ops=${opCount} tags: ${beforeTags} → ${afterTags}`,
          );
        }
        break;
      }
    }
  }

  logger?.debug(
    `[replay-diag] replayHistory done finalLive=${live != null} finalShadow=${shadow != null} (processed ${sorted.length} entries)`,
  );

  return { live, shadow };
}

export function replayHistory<T extends MXDBRecord>(
  entries: AuditEntry<T>[],
  baseRecord: T | undefined,
  logger?: Logger,
): T | undefined {
  return replayHistoryEndState(entries, baseRecord, logger).live;
}

