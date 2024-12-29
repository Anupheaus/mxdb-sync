import type { MXDBServerAction } from './createServerAction';
import { serverQueryAction } from './queryAction';
import { serverSyncAction } from './syncAction';

export const internalActions: MXDBServerAction[] = [
  serverQueryAction,
  serverSyncAction,
];
