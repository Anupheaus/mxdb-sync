import type { Record } from '@anupheaus/common';
import { configRegistry, type MXDBCollection } from '../../common';
import { useServerToClientSync } from '../providers';

type PushFn = (collectionName: string, updatedRecordIds: string[], removedRecordIds: string[], disableAudit: boolean) => Promise<void>;

/**
 * After a subscription snapshot, reconcile the client via the S2C sync action (stale mirror rows only).
 *
 * @param pushFn — pre-captured `pushRecordsToClient` from subscription setup time. Required when called
 *   from an `onChange` callback triggered by MongoDB change stream events, because those callbacks run
 *   outside any ALS context and `useServerToClientSync()` would fall back to the server-startup no-op instance.
 */
export async function pushSubscriptionResultRecords<RecordType extends Record>(
  collection: MXDBCollection<RecordType>,
  records: RecordType[],
  removedIds: string[] = [],
  pushFn?: PushFn,
): Promise<void> {
  const ids = records.ids();
  if (ids.length === 0 && removedIds.length === 0) return;

  const config = configRegistry.getOrError(collection);
  const push = pushFn ?? useServerToClientSync().pushRecordsToClient;
  await push(collection.name, ids, removedIds, config.disableAudit === true);
}
