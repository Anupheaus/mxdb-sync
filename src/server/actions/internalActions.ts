import type { SocketAPIServerAction } from '@anupheaus/socket-api/server';
import { serverRemoveAction } from './removeAction';
import { serverSyncAction } from './syncAction';
import { serverUpsertAction } from './upsertAction';
import { serverGetAction } from './getAction';
import { serverQueryAction } from './queryAction';
import { serverDistinctAction } from './distinctAction';
export const internalActions: SocketAPIServerAction[] = [
  serverSyncAction,
  serverUpsertAction,
  serverRemoveAction,
  serverGetAction,
  serverQueryAction,
  serverDistinctAction,
];

