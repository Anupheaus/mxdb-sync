import { provideDb } from './providers';
import { Logger } from '@anupheaus/common';
import { startAuthenticatedServer } from './startAuthenticatedServer';
import { getDevices, enableDevice, disableDevice } from './auth/deviceManagement';
import { registerDevAuthRoute } from './auth/registerDevAuthRoute';
import type { ServerConfig, ServerInstance } from './internalModels';

export async function startServer(config: ServerConfig): Promise<ServerInstance> {
  let { logger, name, collections, mongoDbName, mongoDbUrl, changeStreamDebounceMs, onRegisterRoutes } = config;
  if (!logger) logger = Logger.getCurrent();
  if (!logger) logger = new Logger('MXDB-Sync');

  logger.info('[startServer] begin', { name, mongoDbName, collectionCount: collections.length });

  return logger.provide(() => provideDb(mongoDbName, mongoDbUrl, collections, async db => {
    logger!.info('[startServer] provideDb — waiting for Mongo');
    await db.getMongoDb();
    logger!.info('[startServer] Mongo connected');

    const { app, useAuthentication } = await startAuthenticatedServer({
      ...config,
      db,
      logger,
      onRegisterRoutes: async router => {
        await onRegisterRoutes?.(router);
        if (process.env.NODE_ENV !== 'production') {
          registerDevAuthRoute(router, name, db);
        }
      },
    });

    if (app == null) throw new Error('Failed to start server');

    return {
      app,
      createInvite: async (userId: string, baseUrl: string) =>
        useAuthentication().createInvite(userId, baseUrl),
      getDevices: async (userId: string) => getDevices(db, userId),
      enableDevice: async (requestId: string) => enableDevice(db, requestId),
      disableDevice: async (requestId: string) => disableDevice(db, requestId),
      close: async () => db.close(),
    };
  }, changeStreamDebounceMs));
}
