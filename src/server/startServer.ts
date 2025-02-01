import { setupDb } from './providers';
import type { MXDBSyncedCollection } from '../common';
import { seedCollections } from './seedCollections';
import { internalActions } from './actions';
import { setupCollectionWatches } from './setupCollectionWatches';
import { useCollections } from './collections';
import { startServer as startSocketServer } from '@anupheaus/socket-api/server';
import type { ServerConfig as StartSocketServerConfig } from '@anupheaus/socket-api/server';

export interface ServerConfig extends StartSocketServerConfig {
  collections: MXDBSyncedCollection[];
  mongoDbUrl: string;
  mongoDbName: string;
  clearDatabase?: boolean;
}

export async function startServer({ collections, mongoDbName, mongoDbUrl, clearDatabase = false, ...config }: ServerConfig) {
  useCollections(collections);
  const { onClientDisconnected } = await setupDb(mongoDbName, mongoDbUrl, clearDatabase);
  await seedCollections();
  return startSocketServer({
    ...config,
    actions: [...internalActions, ...(config.actions ?? [])],
    onClientConnected: async client => {
      setupCollectionWatches();
      await config.onClientConnected?.(client);
    },
    onClientDisconnected: async client => {
      onClientDisconnected();
      await config.onClientDisconnected?.(client);
    },
  });
}
