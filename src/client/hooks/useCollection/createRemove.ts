import type { Logger, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { DbCollection } from '../../providers';

export interface RemoveProps {
  locallyOnly?: boolean;
}


export function createRemove<RecordType extends Record>(dbCollection: DbCollection<RecordType>, logger: Logger) {

  async function remove(id: string, props?: RemoveProps): Promise<void>;
  async function remove(ids: string[], props?: RemoveProps): Promise<void>;
  async function remove(record: RecordType, props?: RemoveProps): Promise<void>;
  async function remove(records: RecordType[], props?: RemoveProps): Promise<void>;
  async function remove(recordsOrIds: RecordType | RecordType[] | string | string[], props?: RemoveProps): Promise<void> {
    if (!is.array(recordsOrIds)) return is.string(recordsOrIds) ? remove([recordsOrIds], props) : remove([recordsOrIds.id], props);
    const recordIds: string[] = recordsOrIds.map(record => is.string(record) ? record : record.id);
    if (recordIds.length === 0) return;
    logger.debug('Removing records...', { recordIds });
    await dbCollection.delete(recordIds, { auditAction: props?.locallyOnly === true ? 'remove' : 'default' });
    logger.debug('Removed records.');
  }


  return remove;
}