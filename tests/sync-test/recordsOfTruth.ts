import type { SyncTestRecord, RecordOfTruthEntry } from './types';

const entries: RecordOfTruthEntry[] = [];
const deletionEntries: Array<{ recordId: string; timestampMs: number }> = [];

export function addUpdate(clientId: string, record: SyncTestRecord): void {
  entries.push({ clientId, record });
}

export function addDeletion(recordId: string, timestampMs: number): void {
  deletionEntries.push({ recordId, timestampMs });
}

/** Last-write-wins per record id using the same semantics as server merge: order by timestamp (record.updatedAt for updates, timestampMs for deletes). */
export function getExpectedState(): Map<string, SyncTestRecord> {
  const byId = new Map<string, { maxTs: number; record: SyncTestRecord }>();
  for (const e of entries) {
    const id = e.record.id;
    const ts = e.record.updatedAt;
    const existing = byId.get(id);
    if (existing == null || ts > existing.maxTs) {
      byId.set(id, { maxTs: ts, record: e.record });
    }
  }
  for (const d of deletionEntries) {
    const existing = byId.get(d.recordId);
    if (existing != null && d.timestampMs >= existing.maxTs) {
      byId.delete(d.recordId);
    } else if (existing == null) {
      // Id was only ever deleted (no update in our log); treat as deleted
      byId.delete(d.recordId);
    }
  }
  const result = new Map<string, SyncTestRecord>();
  byId.forEach((entry, id) => result.set(id, entry.record));
  return result;
}

export function clear(): void {
  entries.length = 0;
  deletionEntries.length = 0;
}

export function getEntryCount(): number {
  return entries.length;
}
