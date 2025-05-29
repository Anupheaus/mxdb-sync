import { useSync } from '../../providers';
import type { Logger, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { DbCollection } from '../../providers';

export interface RemoveProps {
  locallyOnly?: boolean;
}


export function createRemove<RecordType extends Record>(dbCollection: DbCollection<RecordType>, userId: string, logger: Logger) {
  const { finishSyncing } = useSync();

  async function remove(id: string, props?: RemoveProps): Promise<boolean>;
  async function remove(ids: string[], props?: RemoveProps): Promise<boolean>;
  async function remove(record: RecordType, props?: RemoveProps): Promise<boolean>;
  async function remove(records: RecordType[], props?: RemoveProps): Promise<boolean>;
  async function remove(recordsOrIds: RecordType | RecordType[] | string | string[], props?: RemoveProps): Promise<boolean> {
    if (!is.array(recordsOrIds)) return is.string(recordsOrIds) ? remove([recordsOrIds], props) : remove([recordsOrIds.id], props);
    const recordIds: string[] = recordsOrIds.map(record => is.string(record) ? record : record.id);
    if (recordIds.length === 0) return false;
    await finishSyncing();
    logger.debug('Removing records...', { recordIds });
    const result = await dbCollection.delete(recordIds, userId, { auditAction: props?.locallyOnly === true ? 'remove' : 'default', keepIfHasHistory: true });
    logger.debug('Removed records.', { result });
    return result;
  }


  return remove;
}