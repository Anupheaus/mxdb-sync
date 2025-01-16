import type { MXDBServerAction } from './createServerAction';
import { serverQueryAction } from './queryAction';
import { serverSyncAction } from './syncAction';
import { serverUpsertAction } from './upsertAction';

export const internalActions: MXDBServerAction[] = [
  serverQueryAction,
  serverSyncAction,
  serverUpsertAction,
];
