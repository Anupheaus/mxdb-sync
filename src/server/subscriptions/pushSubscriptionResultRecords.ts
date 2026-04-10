import type { Record } from '@anupheaus/common';
import type { MXDBCollection } from '../../common';
import type { ServerToClientSynchronisation } from '../ServerToClientSynchronisation';

/**
 * Deliver a subscription snapshot (query / getAll / get result) to the connected
 * client via the S2C dispatcher. Records are pushed authoritatively
 * (`addToFilter=true`), so the SD adds them to its filter on successful CR ack —
 * subsequent change-stream events for the same ids can then reach the client.
 *
 * Deletions (records that used to be in the query but no longer are, or ids that
 * the CR has but the server doesn't) are pushed as change-stream-style deletes so
 * that the CR removes them.
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
    await s2c.pushActive(collection.name, records);
  }
  if (removedIds.length > 0) {
    await s2c.pushDeletes(collection.name, removedIds);
  }
}
