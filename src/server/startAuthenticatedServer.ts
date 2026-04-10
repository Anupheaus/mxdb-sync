import type { ServerDb } from './providers';
import { setServerToClientSync } from './providers';
import { seedCollections } from './seeding';
import { internalActions } from './actions';
import { startServer as startSocketServer, useSocketAPI, useEvent, useAction } from '@anupheaus/socket-api/server';
import type { SocketAPIUser } from '@anupheaus/socket-api/server';
import { internalSubscriptions } from './subscriptions';
import { addClientWatches, removeClientWatches } from './clientDbWatches';
import { ServerToClientSynchronisation } from './ServerToClientSynchronisation';
import { AuthCollection } from './auth/AuthCollection';
import { TokenRotation } from './auth/TokenRotation';
import { mxdbTokenRotated } from '../common/internalEvents';
import { mxdbServerToClientSyncAction } from '../common/internalActions';
import type { Socket } from 'socket.io';
import type { ServerConfig } from './internalModels';
import { Logger } from '@anupheaus/common';


const tokenRotationGates = new WeakMap<Socket, ReturnType<typeof Promise.createDeferred<void>>>();
const clientS2CInstances = new WeakMap<Socket, ServerToClientSynchronisation>();

const adminUser: SocketAPIUser = {
  id: Math.emptyId(),
};

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
  changeStreamDebounceMs,
  ...config
}: Props) {
  logger?.info('[startAuthenticatedServer] calling startSocketServer', { actionCount: internalActions.length + (actions?.length ?? 0), subCount: internalSubscriptions.length + (subscriptions?.length ?? 0) });
  const { app } = await startSocketServer({
    ...config,
    logger,
    actions: [...internalActions, ...(actions ?? [])],
    subscriptions: [...internalSubscriptions, ...(subscriptions ?? [])],

    onClientConnecting: client => {
      tokenRotationGates.set(client, Promise.createDeferred<void>());
    },

    // ─── §5.1 Gate check (before every action/subscription handler) ──────────
    onBeforeHandle: async client => {
      const gate = tokenRotationGates.get(client);
      if (gate != null) await gate;
    },

    async onStartup() {
      logger?.info('[startAuthenticatedServer] onStartup.begin');
      const { impersonateUser } = useSocketAPI();

      await impersonateUser(adminUser, async () => {
        const startupLogger = (logger ?? Logger.getCurrent() ?? new Logger('mxdb-sync')).createSubLogger('s2c:startup');
        setServerToClientSync(ServerToClientSynchronisation.createNoOp(collections, startupLogger));
        const startTime = Date.now();
        if (shouldSeedCollections === true) {
          logger?.info('[startAuthenticatedServer] seedCollections.begin');
          await seedCollections(collections);
          logger?.info('[startAuthenticatedServer] seedCollections.done', { ms: Date.now() - startTime });
        }
        console.log(`Seeding took ${Date.now() - startTime}ms`); // eslint-disable-line no-console
        if (config.onStartup != null) {
          logger?.info('[startAuthenticatedServer] config.onStartup.begin');
          await config.onStartup();
          logger?.info('[startAuthenticatedServer] config.onStartup.done');
        }
      });
      logger?.info('[startAuthenticatedServer] onStartup.done');
    },

    // ─── Token validation + rotation ────────────────────────────────────
    onClientConnected: async (client: Socket) => {
      const handshakeAuth = client.handshake.auth as Record<string, string> | undefined;
      const token = handshakeAuth?.token;
      const keyHash = handshakeAuth?.keyHash;

      try {
        if (token != null) {
          const authColl = new AuthCollection(db);

          // findByToken checks both pendingToken and currentToken
          const record = await authColl.findByToken(token);

          if (record == null || !record.isEnabled) {
            logger!.warn(`Invalid or disabled auth token — rejecting client ${client.id}`);
            // If token not found at all and keyHash is known, disable the device as a security measure
            if (record == null && keyHash != null) {
              const deviceRecord = await authColl.findByKeyHash(keyHash);
              if (deviceRecord != null) await authColl.update(deviceRecord.requestId, { isEnabled: false });
            }
            client.disconnect(true);
            tokenRotationGates.get(client)?.reject();
            return;
          }

          // Authenticate the socket-api user context so `getUser()` works in actions
          const { setUser } = useSocketAPI();
          await setUser({ id: record.userId });

          // Phase 1: generate new token and persist interim state
          const { newToken, completeRotation } = await TokenRotation.rotateBeforeAck(authColl, record, token);

          // Send new token to client — emitWithAck waits for the client's ack callback
          const emitTokenRotated = useEvent(mxdbTokenRotated);
          await emitTokenRotated({ newToken });

          // Phase 2: finalise rotation after ack
          await completeRotation();
          await authColl.update(record.requestId, { lastConnectedAt: Date.now() });
        }
        tokenRotationGates.get(client)?.resolve();

        // §2.1 — Create per-connection ServerToClientSynchronisation instance
        const s2cLogger = (logger ?? Logger.getCurrent() ?? new Logger('mxdb-sync')).createSubLogger(`s2c:${client.id}`);
        const emitS2C = useAction(mxdbServerToClientSyncAction);
        const s2c = new ServerToClientSynchronisation({
          emitS2C: async payload => emitS2C(payload),
          getDb: () => db,
          collections,
          logger: s2cLogger,
        });
        clientS2CInstances.set(client, s2c);

        // Make S2C available in async context for action handlers
        setServerToClientSync(s2c);

        addClientWatches(client, collections, s2c);
        await onClientConnected?.(client);
      } catch (error) {
        tokenRotationGates.get(client)?.reject();
      }
    },

    onClientDisconnected: async client => {
      // Reject any handlers that may be waiting on the gate if the client
      // disconnects before the token rotation ack is received.
      tokenRotationGates.get(client)?.reject();
      removeClientWatches(client);

      // §2.1 — Tear down the per-connection S2C instance
      const s2c = clientS2CInstances.get(client);
      if (s2c != null) {
        s2c.close();
        clientS2CInstances.delete(client);
      }

      await onClientDisconnected?.(client);
    },
  });

  logger?.info('[startAuthenticatedServer] startSocketServer returned', { hasApp: app != null });
  return { app };
}
