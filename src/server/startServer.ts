import type { Logger } from '@anupheaus/common';
import type { AnyHttpServer } from './internalModels';
import { setupDb, setupSocket, setupLogger, setupKoa } from './providers';
import type { MXDBSyncedCollection } from '../common';
import { seedCollections } from './seedCollections';
// import { setupHandlers } from './handlers';
import type { MXDBServerAction } from './actions';
import { internalActions, setupActions } from './actions';
import { provideCollections } from './collections/provideCollections';

export interface ServerConfig {
  collections: MXDBSyncedCollection[];
  actions?: MXDBServerAction[];
  mongoDbUrl: string;
  mongoDbName: string;
  logger?: Logger;
  server: AnyHttpServer;
  clearDatabase?: boolean;
}

export async function startServer({ collections, server, actions, mongoDbName, mongoDbUrl, logger: providedLogger, clearDatabase = false }: ServerConfig) {
  setupLogger(providedLogger);
  const app = setupKoa(server);
  setupSocket();
  await setupDb(mongoDbName, mongoDbUrl, clearDatabase);
  return provideCollections(collections, async () => {
    await seedCollections(collections);
    // setupHandlers(collections);
    setupActions([...internalActions, ...(actions ?? [])]);
    return {
      app,
    };
  });
}
