import type { Record } from '@anupheaus/common';
import { mxdbGetAllAction } from '../../../common';
import { useSync } from '../../providers';
import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';
import type { DbCollection } from '../../providers';

import { ACTION_TIMEOUT_MS, withTimeout } from '../../utils/actionTimeout';

interface GetProps {
  locallyOnly?: boolean;
}

export function createGetAll<RecordType extends Record>(dbCollection: DbCollection<RecordType>) {
  const { getIsConnected } = useSocketAPI();
  const { finishSyncing } = useSync();
  const { mxdbGetAllAction: getAllFromServer } = useAction(mxdbGetAllAction);

  async function getAll({ locallyOnly = false }: GetProps = {}): Promise<RecordType[]> {
    await finishSyncing();
    const records = await dbCollection.getAll();
    if (!locallyOnly && records.length === 0 && getIsConnected()) {
      await withTimeout(
        getAllFromServer({ collectionName: dbCollection.name }),
        ACTION_TIMEOUT_MS,
        `mxdbGetAllAction(${dbCollection.name})`,
      );
      return dbCollection.getAll();
    }
    return records;
  }

  return getAll;
}

export type GetAll<RecordType extends Record> = ReturnType<typeof createGetAll<RecordType>>;
