import type { Record } from '@anupheaus/common';
import type { MXDBCollection } from '../../common';
import type { ServerToClientSynchronisation } from '../ServerToClientSynchronisation';

/**
 * After a subscription snapshot, seed the S2C filter for the query result
 * records and push any stale deletions to the client.
 *
 * The caller MUST pass the {@link ServerToClientSynchronisation} instance captured
 * at subscription setup time, because `onChange` callbacks fire from the MongoDB
 * change stream outside any ALS context — a late `useServerToClientSynchronisation()`
 * would fall back to the server-startup no-op instance.
 */
export async function pushSubscriptionResultRecords<RecordType extends Record>(
  s2c: ServerToClientSynchronisation,
  collection: MXDBCollection<RecordType>,
  records: RecordType[],
  removedIds: string[] = [],
): Promise<void> {
  if (records.length === 0 && removedIds.length === 0) return;
  if (records.length > 0) {
    await s2c.seedActive(collection.name, records);
  }
  if (removedIds.length > 0) {
    await s2c.pushDeletes(collection.name, removedIds);
  }
}
