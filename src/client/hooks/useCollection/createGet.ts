import { is, type Record } from '@anupheaus/common';
import { mxdbGetAction } from '../../../common';
import type { DbCollection } from '../../providers';
import { useSync } from '../../providers';
import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';

interface GetProps {
  locallyOnly?: boolean;
}

export function createGet<RecordType extends Record>(dbCollection: DbCollection<RecordType>) {
  const { getIsConnected } = useSocketAPI();
  const { finishSyncing } = useSync();
  const { mxdbGetAction: getRecordFromServer } = useAction(mxdbGetAction);

  async function get(id: string, props?: GetProps): Promise<RecordType | undefined>;
  async function get(ids: string[], props?: GetProps): Promise<RecordType[]>;
  async function get(ids: string | string[], props: GetProps = {}): Promise<RecordType | RecordType[] | undefined> {
    if (!is.array(ids)) return (await get([ids], props))[0];
    await finishSyncing();
    const { locallyOnly = false } = props;
    const records = await dbCollection.get(ids);
    // only fetch if we aren't solely looking locally and we don't have all the records locally and we are online
    if (!locallyOnly && ids.length > records.length && getIsConnected()) {
      const idsRetrieved = await getRecordFromServer({ collectionName: dbCollection.name, ids });
      return dbCollection.get(idsRetrieved);
    }
    return records;
  }

  return get;
}

export type Get<RecordType extends Record> = ReturnType<typeof createGet<RecordType>>;
