import type { SocketAPIServerAction } from '@anupheaus/socket-api/server';
import { clientToServerSyncAction } from './clientToServerSyncAction';
import { serverGetAction } from './getAction';
import { serverGetAllAction } from './getAllAction';
import { serverQueryAction } from './queryAction';
import { serverDistinctAction } from './distinctAction';
import { reconcileAction } from './reconcileAction';
import { serverSignOutAction } from './signOutAction';

export const internalActions: SocketAPIServerAction[] = [
  clientToServerSyncAction,
  serverGetAction,
  serverGetAllAction,
  serverQueryAction,
  serverDistinctAction,
  reconcileAction,
  serverSignOutAction,
];

