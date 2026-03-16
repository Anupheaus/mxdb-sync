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
    // We treat any audit that either:
    // - has history (auditor.hasHistory) OR
    // - has never been branched (i.e. initial "created" audit)
    // as an "update" to send to the server.
    //
    // Pure "branched-only" audits (no further history) are treated as ids markers instead.
    const withHistory = audits.filter(audit => {
      if (auditor.hasHistory(audit)) return true;
      const hasBranched = audit.history.some(op => op.type === 'branched');
      return !hasBranched;
    });
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
