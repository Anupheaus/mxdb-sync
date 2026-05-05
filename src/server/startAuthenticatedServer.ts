import type { ServerDb } from './providers';
import { setServerToClientSync } from './providers';
import { registerClientS2C, unregisterClientS2C } from './providers/db/clientS2CStore';
import { seedCollections } from './seeding';
import { internalActions } from './actions';
import { startServer as startSocketServer, useAction, useAuthentication as useSocketAuthentication } from '@anupheaus/socket-api/server';
import { defineAuthentication } from '@anupheaus/socket-api/server';
import { internalSubscriptions } from './subscriptions';
import { addClientWatches, removeClientWatches } from './clientDbWatches';
import { ServerToClientSynchronisation } from './ServerToClientSynchronisation';
import { AuthCollection } from './auth/AuthCollection';
import { mxdbServerToClientSyncAction } from '../common/internalActions';
import type { Socket } from 'socket.io';
import type { ServerConfig } from './internalModels';
import { Logger } from '@anupheaus/common';
import type { MXDBAccount, MXDBUser } from '../common/models';

const SESSION_COOKIE_NAME = 'socketapi_session';

const clientS2CInstances = new WeakMap<Socket, ServerToClientSynchronisation>();
const connectedUsers = new WeakMap<Socket, MXDBUser>();
const connectedAccounts = new WeakMap<Socket, MXDBAccount>();
const disconnectReasons = new WeakMap<Socket, string>();

const adminUser = { id: Math.emptyId() } as MXDBUser;

interface Props extends ServerConfig {
  db: ServerDb;
}

function parseSessionToken(client: Socket): string | undefined {
  const cookieHeader = client.handshake.headers.cookie as string | undefined;
  const fromCookie = cookieHeader?.split(';').map(s => s.trim())
    .find(s => s.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.slice(SESSION_COOKIE_NAME.length + 1);
  const fromAuth = (client.handshake.auth as Record<string, unknown>)?.sessionToken as string | undefined;
  return fromCookie ?? fromAuth;
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
  onGetAccountDetails,
  onGetInviteDetails,
  rpId,
  changeStreamDebounceMs,
  ...config
}: Props) {
  const { configureAuthentication, useAuthentication } = defineAuthentication<MXDBUser, MXDBAccount>();
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
      onGetInviteDetails: async (userId, accountId) => {
        if (onGetInviteDetails == null) throw new Error('onGetInviteDetails is required for authenticated servers');
        return onGetInviteDetails(userId, accountId);
      },
      onGetUser: async (userId): Promise<MXDBUser | undefined> => {
        if (onGetUserDetails == null) return { id: userId } as MXDBUser;
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

      const auth = useSocketAuthentication<MXDBUser, MXDBAccount>();

      if (auth.user != null) {
        // Hydrate the account from the auth record when the consumer supplies onGetAccountDetails.
        // validateSessionCookie (in socket-api middleware) only sets the user; we resolve the
        // account here by looking up the session's auth record to retrieve its accountId.
        if (auth.account == null && onGetAccountDetails != null) {
          const sessionToken = parseSessionToken(client);
          if (sessionToken != null) {
            const record = await authColl.findBySessionToken(sessionToken);
            if (record?.accountId != null) {
              const resolvedAccount = await onGetAccountDetails(record.accountId).catch(() => undefined);
              if (resolvedAccount != null) await auth.setAccount(resolvedAccount);
            }
          }
        }

        // Re-emit socketAPIUserChanged here (post-connection) to guarantee delivery.
        // The io.use() middleware emits this event while the socket is still in the
        // handshake phase; some socket.io configurations may not flush buffered events
        // reliably. Calling setUser() again here is idempotent on the server and
        // ensures the client always receives its authenticated user state.
        await auth.setUser(auth.user);
        connectedUsers.set(client, auth.user);
        const currentAccount = auth.account;
        if (currentAccount != null) connectedAccounts.set(client, currentAccount);
        await onConnected?.({ user: auth.user, account: currentAccount });
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
      registerClientS2C(client, s2c);
      setServerToClientSync(s2c);
      addClientWatches(client, collections, s2c);
      await onClientConnected?.(client);
    },

    onClientDisconnected: async client => {
      removeClientWatches(client);
      unregisterClientS2C(client);

      const s2c = clientS2CInstances.get(client);
      if (s2c != null) {
        s2c.close();
        clientS2CInstances.delete(client);
      }

      const user = connectedUsers.get(client);
      const account = connectedAccounts.get(client);
      connectedUsers.delete(client);
      connectedAccounts.delete(client);

      if (user != null) {
        const rawReason = disconnectReasons.get(client) ?? '';
        const reason = rawReason === 'server namespace disconnect' ? 'signedOut' : 'connectionLost';
        disconnectReasons.delete(client);
        await onDisconnected?.({ user, account, reason });
      }

      await onClientDisconnected?.(client);
    },
  });

  logger?.info('[startAuthenticatedServer] done');
  return { app, authColl };
}
