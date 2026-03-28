import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import {
  AuditEntryType,
  filterValidEntries,
  type AnyAuditOf,
  type AuditBranchedEntry,
  type AuditCreatedEntry,
  type AuditDeletedEntry,
  type AuditEntry,
  type AuditRestoredEntry,
  type AuditUpdateEntry,
  type ServerAuditEntry,
  type ServerAuditOf,
} from '../../common';
import { replayHistory } from '../../common/auditor/replay';

/**
 * Prefer an existing persisted `userId`; otherwise stamp `actingUserId` (e.g. authenticated user for new client entries).
 * Does not overwrite a non-empty stored `userId`.
 */
function entryUserId(e: { userId?: unknown }, actingUserId: string): string {
  const u = e.userId;
  return typeof u === 'string' && u.length > 0 ? u : actingUserId;
}

export interface ToServerAuditOfOptions<RecordType extends MXDBRecord> {
  /** When the live row was read at delete time, attach to the chronologically last {@link AuditEntryType.Deleted} entry. */
  deleteSnapshots?: { [recordId: string]: RecordType | undefined };
  logger?: Logger;
}

/**
 * Normalise an audit document for Mongo `_sync` storage:
 * every entry has `userId`; each delete carries a `record` snapshot.
 * Existing server `userId` / delete `record` values are kept (not recomputed or cleared).
 */
export function toServerAuditOf<RecordType extends MXDBRecord>(
  audit: AnyAuditOf<RecordType>,
  actingUserId: string,
  options: ToServerAuditOfOptions<RecordType> = {},
): ServerAuditOf<RecordType> {
  const { deleteSnapshots, logger } = options;
  const cleaned = filterValidEntries<RecordType>(audit.entries as unknown[], logger);
  const sorted = [...cleaned].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const deletedIds = sorted.filter(e => e.type === AuditEntryType.Deleted).map(e => e.id);
  const maxDeletedId = deletedIds.length === 0 ? undefined : deletedIds.reduce((a, b) => (a > b ? a : b));

  const entries: ServerAuditEntry<RecordType>[] = cleaned.map((e): ServerAuditEntry<RecordType> => {
    const userId = entryUserId(e as { userId?: unknown }, actingUserId);
    switch (e.type) {
      case AuditEntryType.Created:
        return { ...(e as AuditCreatedEntry<RecordType>), userId };
      case AuditEntryType.Updated:
        return { ...(e as AuditUpdateEntry), userId };
      case AuditEntryType.Restored:
        return { ...(e as AuditRestoredEntry<RecordType>), userId };
      case AuditEntryType.Branched:
        return { ...(e as AuditBranchedEntry), userId };
      case AuditEntryType.Deleted: {
        const ext = e as AuditDeletedEntry & { record?: RecordType };
        if (ext.record != null && typeof ext.record === 'object') {
          const del = e as AuditDeletedEntry;
          return { ...del, userId, record: Object.clone(ext.record) };
        }
        let snap = replayHistory<RecordType>(
          sorted.filter(x => x.id < e.id),
          undefined,
          logger,
        );
        if (e.id === maxDeletedId) {
          const live = deleteSnapshots?.[audit.id];
          if (live != null) snap = Object.clone(live);
        }
        if (snap == null) {
          logger?.warn(`[server audit] delete "${e.id}" for record "${audit.id}" has no snapshot — using id-only stub`);
          snap = { id: audit.id } as RecordType;
        } else {
          snap = Object.clone(snap);
        }
        const del = e as AuditDeletedEntry;
        return { ...del, userId, record: snap };
      }
      default:
        return { ...(e as AuditEntry<RecordType>), userId } as ServerAuditEntry<RecordType>;
    }
  });

  return { id: audit.id, entries };
}
