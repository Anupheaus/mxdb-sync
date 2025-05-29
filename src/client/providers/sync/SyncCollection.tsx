// import { createComponent, useLogger } from '@anupheaus/react-ui';
// import { mxdbSyncCollectionAction } from '../../../common';
// import { DateTime } from 'luxon';
// import { useContext, useRef } from 'react';
// import { useCurrentCollection } from '../collection';
// import { SyncUtilsContext } from './SyncContexts';
// import { useAction, useSocketAPI } from '@anupheaus/socket-api/client';
// import { useCollection } from '@anupheaus/mxdb';

// export const SyncCollection = createComponent('SyncCollection', () => {
//   const { onConnected } = useSocketAPI();
//   const { mxdbSyncCollectionAction: syncCollection } = useAction(mxdbSyncCollectionAction);
//   const collection = useCurrentCollection();
//   const { setSyncing } = useContext(SyncUtilsContext);
//   const logger = useLogger(collection.name);
//   const { config, getAll, getAllAudits, resetAuditsOn } = useCollection(collection);
//   const syncRequestIdRef = useRef('');

//   onConnected(async () => {
//     if (config.isAudited !== true) return;
//     const syncRequestId = syncRequestIdRef.current = Math.uniqueId();

//     setSyncing(collection, true);
//     logger.info('Synchronising records...');
//     const timeStarted = DateTime.now();
//     let syncCancelled = false;
//     const interval = setInterval(async () => {
//       if (syncRequestId !== syncRequestIdRef.current) {
//         logger.debug('Current sync request has been cancelled because a newer request has occurred.');
//         syncCancelled = true;
//         clearInterval(interval);
//         setSyncing(collection, false);
//         return;
//       }
//       const timeTaken = DateTime.now().diff(timeStarted);
//       if (timeTaken.as('seconds') >= 60) {
//         logger.error('Sync took too long, cancelling...');
//         syncCancelled = true;
//         clearInterval(interval);
//         setSyncing(collection, false);
//         return;
//       }
//       logger.debug('Still synchronising records...', { timeTaken: timeTaken.toFormat('mm:ss') });
//     }, 5000);
//     try {
//       const auditRecords = await getAllAudits('withHistory');
//       const auditRecordIds = auditRecords.ids();
//       const recordIds = (await getAll()).mapWithoutNull(record => auditRecordIds.includes(record.id) ? undefined : record.id);
//       const syncedRecordIds = await syncCollection({ collectionName: collection.name, ids: recordIds, updates: auditRecords });
//       await resetAuditsOn(syncedRecordIds);
//     } finally {
//       if (!syncCancelled) {
//         clearInterval(interval);
//         logger.info('Finished synchronising records.');
//         setSyncing(collection, false);
//       }
//     }
//   });

//   return null;
// });
