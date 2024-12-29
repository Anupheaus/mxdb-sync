// import type { MXDBSyncedCollection } from '../../common';
// import { useSocket } from '../providers';
// import { createCollectionGet } from './createCollectionGet';
// import { createQuerySubscriber } from './createQuerySubscriber';
// import type { CollectionSubscriber } from './createCollectionSubscription';
// import { createCollectionSubscriptionRegister } from './createCollectionSubscription';
// // import { createCollectionSync } from './createCollectionSync';
// import { createDistinctSubscriber } from './createDistinctSubscriber';

// const subscriptionSubscribers: CollectionSubscriber[] = [
//   createQuerySubscriber(),
//   createDistinctSubscriber(),
// ];

// export function setupHandlers(collections: MXDBSyncedCollection[]) {
//   const { onClientConnected } = useSocket();

//   onClientConnected(({ logger, on, emit }) => {
//     logger.info('Client connected');

//     logger.debug('Setting up handlers...');
//     collections.forEach(collection => {
//       // on(...createCollectionSync(collection, logger));
//       // on(...createCollectionGet(collection, logger));
//       // on(...createCollectionQueryUpdateRegister(collection, logger, emit));
//       // on(...createCollectionQueryUpdateUnregister(collection, logger));
//       // on(...createCollectionDistinctUpdateRegister(collection, logger, emit));
//       // on(...createCollectionDistinctUpdateUnregister(collection, logger));
//       // on(...createCollectionSubscriptionRegister(collection, subscriptionSubscribers, logger, emit));
//     });
//     logger.debug('Handlers set up.');

//     return () => {
//       logger.info('Client disconnected.');
//     };
//   });
// }