import { createAsyncContext, required } from '@anupheaus/socket-api/server';
import type { ServerDb } from './ServerDb';
import type { ServerToClientSynchronisation } from '../../ServerToClientSynchronisation';

const ctx = createAsyncContext({
  db: required<ServerDb>(),
  serverToClientSync: required<ServerToClientSynchronisation>(),
});

export const setDb = ctx.setDb;
export const useDb = ctx.useDb;
export const setServerToClientSync = ctx.setServerToClientSync;

const useServerToClientSyncContext = ctx.useServerToClientSync;

/** Full per-connection synchronisation instance (seed mirror, change stream, close, etc.). */
export function useServerToClientSynchronisation(): ServerToClientSynchronisation {
  return useServerToClientSyncContext();
}

/** Destructure `pushRecordsToClient` for fan-out; implementation is bound on the class instance. */
export function useServerToClientSync(): Pick<ServerToClientSynchronisation, 'pushRecordsToClient'> {
  return { pushRecordsToClient: useServerToClientSyncContext().pushRecordsToClient };
}
