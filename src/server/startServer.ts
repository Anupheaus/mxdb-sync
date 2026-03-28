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

  // Store auth callbacks for use inside socket actions
  setAuthConfig({ onGetUserDetails, inviteLinkTTLMs });

  return logger.provide(() => provideDb(mongoDbName, mongoDbUrl, collections, async db => {

    const { app } = await startAuthenticatedServer({
      ...config,
      db,
      logger,
      onRegisterRoutes: async router => {
        await onRegisterRoutes?.(router);
        registerAuthInviteRoute(router, name, db, config.inviteLinkTTLMs ?? DEFAULT_INVITE_TTL_MS, config.onGetUserDetails);
      },
    });
    if (app == null) throw new Error('Failed to start server');

    return {
      app,
      createInviteLink: async (userId: string, domain: string) => createInviteLink(db, userId, domain, name),
      getDevices: async (userId: string) => getDevices(db, userId),
      enableDevice: async (requestId: string) => enableDevice(db, requestId),
      disableDevice: async (requestId: string) => disableDevice(db, requestId),
    };
  }, changeStreamDebounceMs));
}
