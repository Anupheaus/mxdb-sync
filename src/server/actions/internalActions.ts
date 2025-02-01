// import type { MXDBServerAction } from './createServerAction';
import type { SocketAPIServerAction } from '@anupheaus/socket-api/server';
import { serverQueryAction } from './queryAction';
import { serverRemoveAction } from './removeAction';
import { serverSyncAction } from './syncAction';
import { serverUpsertAction } from './upsertAction';

export const internalActions: SocketAPIServerAction[] = [
  serverQueryAction,
  serverSyncAction,
  serverUpsertAction,
  serverRemoveAction,
];
