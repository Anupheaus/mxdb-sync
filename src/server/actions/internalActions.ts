import type { MXDBServerAction } from './createServerAction';
import { serverQueryAction } from './queryAction';
import { serverRemoveAction } from './removeAction';
import { serverSyncAction } from './syncAction';
import { serverUpsertAction } from './upsertAction';

export const internalActions: MXDBServerAction[] = [
  serverQueryAction,
  serverSyncAction,
  serverUpsertAction,
  serverRemoveAction,
];
