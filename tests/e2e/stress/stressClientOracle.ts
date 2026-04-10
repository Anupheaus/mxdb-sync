import type { E2EClientHandle, E2eTestRecord } from '../setup';
import { auditor } from '../../../src/common';

/**
 * LWW merge of each client’s live rows from `DbCollection`.
 *
 * Conflict resolution uses the last audit entry ULID (lexicographic, monotonic)
 * — NOT `testDate`. This is the same ordering the sync engine uses, so a client
 * that has received the latest fan-out always wins over a client that is behind.
 *
 * Previously this was first-seen-wins, which produced false mismatches in the
 * truth-vs-client comparison whenever the first-iterated client had a stale row.
 */
export async function expectedStateFromClients(clientList: readonly E2EClientHandle[]): Promise<Map<string, E2eTestRecord>> {
  const byId = new Map<string, { record: E2eTestRecord; lastEntryId: string }>();
  for (const c of clientList) {
    const rows = await c.getLocalRecords();
    for (const r of rows) {
      const audit = await c.getLocalAudit(r.id);
      const lastEntryId = audit != null ? (auditor.getLastEntryId(audit) ?? '') : '';
      const existing = byId.get(r.id);
      if (existing == null || lastEntryId > existing.lastEntryId) {
        byId.set(r.id, { record: JSON.parse(JSON.stringify(r)) as E2eTestRecord, lastEntryId });
      }
    }
  }
  const out = new Map<string, E2eTestRecord>();
  for (const [id, { record }] of byId) out.set(id, record);
  return out;
}

export async function clientsWithLocalRows(clientList: readonly E2EClientHandle[]): Promise<E2EClientHandle[]> {
  const out: E2EClientHandle[] = [];
  for (const c of clientList) {
    if ((await c.getLocalRecords()).length > 0) out.push(c);
  }
  return out;
}

export async function pickRandomWriterAndRecordIdForDelete(
  clientList: readonly E2EClientHandle[],
):
  Promise<
    | { writer: E2EClientHandle; writerClientId: string; recordId: string }
    | undefined
  > {
  const withRows = await clientsWithLocalRows(clientList);
  if (withRows.length === 0) return undefined;
  const writer = withRows[Math.floor(Math.random() * withRows.length)]!;
  const lr = await writer.getLocalRecords();
  const pick = lr[Math.floor(Math.random() * lr.length)]!;
  const writerIdx = clientList.indexOf(writer);
  return { writer, writerClientId: `client-${writerIdx}`, recordId: pick.id };
}
