import { provideDb } from './providers';
import type { MXDBCollection } from '../common';
import { seedCollections } from './seedCollections';
import { internalActions } from './actions';
import { startServer as startSocketServer, useSocketAPI } from '@anupheaus/socket-api/server';
import type { SocketAPIUser, ServerConfig as StartSocketServerConfig } from '@anupheaus/socket-api/server';
import { internalSubscriptions } from './subscriptions';
import { Logger } from '@anupheaus/common';
import { addClientWatches, removeClientWatches } from './clientDbWatches';

export interface ServerConfig extends StartSocketServerConfig {
  collections: MXDBCollection[];
  mongoDbUrl: string;
  mongoDbName: string;
  clearDatabase?: boolean;
}

const adminUser: SocketAPIUser = {
  id: Math.emptyId(),
};

export async function startServer({ logger, collections, mongoDbName, mongoDbUrl, ...config }: ServerConfig) {
  if (!logger) logger = Logger.getCurrent();
  if (!logger) logger = new Logger('MXDB-Sync');
  return logger.provide(() => provideDb(mongoDbName, mongoDbUrl, collections, db => startSocketServer({
    ...config,
    logger,
    actions: [...internalActions, ...(config.actions ?? [])],
    subscriptions: [...internalSubscriptions, ...(config.subscriptions ?? [])],
    contextWrapper: (delegate: () => void) => db.wrap(delegate)(),
    async onStartup() {
      const { impersonateUser } = useSocketAPI();

      await impersonateUser(adminUser, async () => {
        await seedCollections(collections);
        await config.onStartup?.();
      });
    },
    onClientConnected: db.wrap(async client => {
      addClientWatches(client, collections);
      await config.onClientConnected?.(client);
    }),
    onClientDisconnected: db.wrap(async client => {
      removeClientWatches(client);
      await config.onClientDisconnected?.(client);
    }),
  })));
}
