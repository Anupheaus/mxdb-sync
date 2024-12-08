// import { Logger } from '@anupheaus/common';
// import { MongoDocOf, Store } from '../common';
// import { handleStoreQueries } from './handleStoreQueries';
// import { useSocket } from './providers';

// export { MongoDocOf };

// export interface StoreConfig {
//   seed?(): Promise<void>;
// }

// export function createServerStore<StoreType extends Store>(store: StoreType, parentLogger: Logger) {
//   const { onClientConnected } = useSocket();

//   onClientConnected(client => {
//     const logger = parentLogger.createSubLogger(client.id);
//     logger.info('Client connected');
//     handleStoreQueries({ client, store, logger });
//   });
// }
