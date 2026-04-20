import type { ServerDb } from './providers';
import { setServerToClientSync } from './providers';
import { seedCollections } from './seeding';
import { internalActions } from './actions';
import { startServer as startSocketServer, useAction } from '@anupheaus/socket-api/server';
import { defineAuthentication } from '@anupheaus/socket-api/server';
import { internalSubscriptions } from './subscriptions';
import { addClientWatches, removeClientWatches } from './clientDbWatches';
import { ServerToClientSynchronisation } from './ServerToClientSynchronisation';
import { AuthCollection } from './auth/AuthCollection';
import { mxdbServerToClientSyncAction } from '../common/internalActions';
import type { Socket } from 'socket.io';
import type { ServerConfig } from './internalModels';
import { Logger } from '@anupheaus/common';
import type { MXDBUserDetails } from '../common/models';

const clientS2CInstances = new WeakMap<Socket, ServerToClientSynchronisation>();
const connectedUsers = new WeakMap<Socket, MXDBUserDetails>();
const disconnectReasons = new WeakMap<Socket, string>();

const adminUser = { id: Math.emptyId() } as MXDBUserDetails;

interface Props extends ServerConfig {
  db: ServerDb;
}

export async function startAuthenticatedServer({
  db,
  shouldSeedCollections,
  collections,
  logger,
  actions,
  subscriptions,
  onClientConnected,
  onClientDisconnected,
  onConnected,
  onDisconnected,
  onGetUserDetails,
  changeStreamDebounceMs,
  ...config
}: Props) {
  const { configureAuthentication, useAuthentication } = defineAuthentication<MXDBUserDetails>();
  const authColl = new AuthCollection(db);

  logger?.info('[startAuthenticatedServer] calling startSocketServer');
  const { app } = await startSocketServer({
    ...config,
    logger,
    actions: [...internalActions, ...(actions ?? [])],
    subscriptions: [...internalSubscriptions, ...(subscriptions ?? [])],

    auth: configureAuthentication({
      mode: 'webauthn',
      store: authColl,
      onGetUserDetails: async (userId) => {
        const details = onGetUserDetails != null
          ? await onGetUserDetails(userId)
          : { id: userId, name: userId } as MXDBUserDetails;
        return { name: details.name, displayName: details.displayName };
      },
      onGetUser: async (userId): Promise<MXDBUserDetails | undefined> => {
        if (onGetUserDetails == null) return { id: userId, name: userId } as MXDBUserDetails;
        try { return await onGetUserDetails(userId); }
        catch { return undefined; }
      },
    }),

    async onStartup() {
      logger?.info('[startAuthenticatedServer] onStartup.begin');
      const { impersonateUser } = useAuthentication();

      await impersonateUser(adminUser, async () => {
        const startupLogger = (logger ?? Logger.getCurrent() ?? new Logger('mxdb-sync')).createSubLogger('s2c:startup');
        setServerToClientSync(ServerToClientSynchronisation.createNoOp(collections, startupLogger));
        const startTime = Date.now();
        if (shouldSeedCollections === true) {
          await seedCollections(collections);
        }
        startupLogger.info(`Seeding took ${Date.now() - startTime}ms`);
        if (config.onStartup != null) await config.onStartup();
      });
      logger?.info('[startAuthenticatedServer] onStartup.done');
    },

    onClientConnected: async (client: Socket) => {
      client.once('disconnect', (reason: string) => disconnectReasons.set(client, reason));

      const { user } = useAuthentication();

      if (user != null) {
        connectedUsers.set(client, user);
        await onConnected?.({ user });
      }

      const s2cLogger = (logger ?? Logger.getCurrent() ?? new Logger('mxdb-sync')).createSubLogger(`s2c:${client.id}`);
      const emitS2C = useAction(mxdbServerToClientSyncAction);
      const s2c = new ServerToClientSynchronisation({
        emitS2C: async payload => emitS2C(payload),
        getDb: () => db,
        collections,
        logger: s2cLogger,
      });
      clientS2CInstances.set(client, s2c);
      setServerToClientSync(s2c);
      addClientWatches(client, collections, s2c);
      await onClientConnected?.(client);
    },

    onClientDisconnected: async client => {
      removeClientWatches(client);

      const s2c = clientS2CInstances.get(client);
      if (s2c != null) {
        s2c.close();
        clientS2CInstances.delete(client);
      }

      const user = connectedUsers.get(client);
      connectedUsers.delete(client);

      if (user != null) {
        const rawReason = disconnectReasons.get(client) ?? '';
        const reason = rawReason === 'server namespace disconnect' ? 'signedOut' : 'connectionLost';
        disconnectReasons.delete(client);
        await onDisconnected?.({ user, reason });
      }

      await onClientDisconnected?.(client);
    },
  });

  logger?.info('[startAuthenticatedServer] done');
  return { app, authColl, useAuthentication };
}
