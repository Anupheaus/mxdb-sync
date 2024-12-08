import type { Logger } from '@anupheaus/common';
import type { AnyHttpServer } from './internalModels';
import { setupDb, setupSocket, setupLogger, setupKoa } from './providers';
import type { MXDBSyncedCollection } from '../common';
import { seedCollections } from './seedCollections';
import { setupHandlers } from './handlers';

export interface ServerConfig {
  collections: MXDBSyncedCollection[];
  mongoDbUrl: string;
  mongoDbName: string;
  logger?: Logger;
  server: AnyHttpServer;
  clearDatabase?: boolean;
}

export async function startServer({ collections, server, mongoDbName, mongoDbUrl, logger: providedLogger, clearDatabase = false }: ServerConfig) {
  setupLogger(providedLogger);
  const app = setupKoa(server);
  setupSocket();
  await setupDb(mongoDbName, mongoDbUrl, clearDatabase);
  await seedCollections(collections);
  setupHandlers(collections);
  return {
    app,
  };
}
