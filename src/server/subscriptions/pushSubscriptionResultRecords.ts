import type { Record } from '@anupheaus/common';
import { configRegistry, type MXDBCollection } from '../../common';
import { useServerToClientSync } from '../providers';

/** After a subscription snapshot, reconcile the client via the S2C sync action (stale mirror rows only). */
export async function pushSubscriptionResultRecords<RecordType extends Record>(
  collection: MXDBCollection<RecordType>,
  records: RecordType[],
  removedIds: string[] = [],
): Promise<void> {
  const ids = records.ids();
  if (ids.length === 0 && removedIds.length === 0) return;

  const config = configRegistry.getOrError(collection);
  const { pushRecordsToClient } = useServerToClientSync();
  await pushRecordsToClient(collection.name, ids, removedIds, config.disableAudit === true);
}
