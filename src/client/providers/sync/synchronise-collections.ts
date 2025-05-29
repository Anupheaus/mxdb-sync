import type { AuditRecord } from '@anupheaus/common';
import { auditor } from '@anupheaus/common';
import type { MXDBSyncId, MXDBSyncRequest, MXDBSyncResponse } from '../../../common/internalModels';
import type { Db } from '../dbs';
import type { MXDBCollection } from '../../../common';

type SyncCollections = (requests: MXDBSyncRequest[]) => Promise<MXDBSyncResponse[]>;

export async function synchroniseCollections(db: Db, collections: MXDBCollection[], syncCollections: SyncCollections) {
  const requests = await collections.mapPromise(async (collection): Promise<MXDBSyncRequest> => {
    const dbCollection = db.use(collection.name);
    const audits = await dbCollection.getAllAudits();
    const withHistory = audits.filter(audit => auditor.hasHistory(audit));
    const withoutHistory = audits.except(withHistory);

    const ids = withoutHistory.mapWithoutNull(({ id, history }) => ((auditRecord: AuditRecord | undefined): MXDBSyncId | undefined => auditRecord == null ? undefined : ({
      id,
      timestamp: auditRecord.timestamp,
    }))(history.findBy('type', 'branched')));

    return {
      collectionName: collection.name,
      ids,
      updates: withHistory,
    };
  });
  const syncedIds = await syncCollections(requests);
  await syncedIds.forEachPromise(async ({ collectionName, ids }) => {
    const dbCollection = db.use(collectionName);
    await dbCollection.resetAuditsOn(ids);
  });
}
