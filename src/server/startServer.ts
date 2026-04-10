import { provideDb } from './providers';
import { Logger } from '@anupheaus/common';
import { setAuthConfig } from './auth/authConfig';
import { createInviteLink, getDevices, enableDevice, disableDevice } from './auth/deviceManagement';
import { startAuthenticatedServer } from './startAuthenticatedServer';
import type { ServerConfig, ServerInstance } from './internalModels';
import { registerAuthInviteRoute } from './auth/registerAuthInviteRoute';

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function startServer(config: ServerConfig): Promise<ServerInstance> {
  let { logger, name, collections, mongoDbName, mongoDbUrl, changeStreamDebounceMs, onGetUserDetails, onRegisterRoutes, inviteLinkTTLMs } = config;
  if (!logger) logger = Logger.getCurrent();
  if (!logger) logger = new Logger('MXDB-Sync');

  logger.info('[startServer] begin', { name, mongoDbName, collectionCount: collections.length });

  // Store auth callbacks for use inside socket actions
  setAuthConfig({ onGetUserDetails, inviteLinkTTLMs });
  logger.info('[startServer] authConfig set');

  return logger.provide(() => provideDb(mongoDbName, mongoDbUrl, collections, async db => {
    logger!.info('[startServer] provideDb delegate entered — waiting for Mongo connect');
    // CRITICAL: do not start the HTTP listener until the MongoClient has finished its
    // initial connect. Otherwise the HTTP server can begin accepting C2S sync requests
    // while ServerDbCollection.{getAudit,get} fail with "Client must be connected before
    // running operations", which the receive path used to silently swallow and surface as
    // "record does not exist" — routing live records' [Branched, Updated] payloads through
    // the SR ORPHAN-drop path and losing client edits. Awaiting here makes "ready" mean
    // "fully ready to serve sync requests".
    await db.getMongoDb();
    logger!.info('[startServer] Mongo connected — starting authenticated server');

    const { app } = await startAuthenticatedServer({
      ...config,
      db,
      logger,
      onRegisterRoutes: async router => {
        logger!.info('[startServer] onRegisterRoutes.begin');
        await onRegisterRoutes?.(router);
        registerAuthInviteRoute(router, name, db, config.inviteLinkTTLMs ?? DEFAULT_INVITE_TTL_MS, config.onGetUserDetails);
        logger!.info('[startServer] onRegisterRoutes.done');
      },
    });
    logger!.info('[startServer] startAuthenticatedServer returned', { hasApp: app != null });
    if (app == null) throw new Error('Failed to start server');

    return {
      app,
      createInviteLink: async (userId: string, domain: string) => createInviteLink(db, userId, domain, name),
      getDevices: async (userId: string) => getDevices(db, userId),
      enableDevice: async (requestId: string) => enableDevice(db, requestId),
      disableDevice: async (requestId: string) => disableDevice(db, requestId),
      close: async () => db.close(),
    };
  }, changeStreamDebounceMs));
}
