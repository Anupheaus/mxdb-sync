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

/** Per-connection S2C synchronisation wrapper exposed to action handlers via async context. */
export function useServerToClientSynchronisation(): ServerToClientSynchronisation {
  return useServerToClientSyncContext();
}
