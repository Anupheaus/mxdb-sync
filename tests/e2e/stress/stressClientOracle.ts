import type { E2EClientHandle, E2eTestRecord } from '../setup';

/** LWW merge of each client’s live rows from `DbCollection` (see `getLocalRecords`). */
export async function expectedStateFromClients(clientList: readonly E2EClientHandle[]): Promise<Map<string, E2eTestRecord>> {
  const byId = new Map<string, E2eTestRecord>();
  for (const c of clientList) {
    const rows = await c.getLocalRecords();
    for (const r of rows) {
      if (!byId.has(r.id)) {
        byId.set(r.id, JSON.parse(JSON.stringify(r)) as E2eTestRecord);
      }
    }
  }
  return byId;
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
