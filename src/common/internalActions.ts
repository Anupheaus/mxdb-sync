import { defineAction } from '@anupheaus/socket-api/common';
import type { MXDBSyncRequest, MXDBSyncResponse } from './internalModels';
import type { DistinctRequest, DistinctResponse, GetAllRequest, GetRequest, GetResponse, QueryRequest, QueryResponse, RemoveRequest, RemoveResponse, UpsertRequest, UpsertResponse } from './models';

export const mxdbSyncCollectionsAction = defineAction<MXDBSyncRequest[], MXDBSyncResponse[]>()('mxdbSyncCollectionsAction');
export const mxdbUpsertAction = defineAction<UpsertRequest, UpsertResponse>()('mxdbUpsertAction');
export const mxdbRemoveAction = defineAction<RemoveRequest, RemoveResponse>()('mxdbRemoveAction');
export const mxdbGetAction = defineAction<GetRequest, GetResponse>()('mxdbGetAction');
export const mxdbGetAllAction = defineAction<GetAllRequest, GetResponse>()('mxdbGetAllAction');
export const mxdbQueryAction = defineAction<QueryRequest, QueryResponse>()('mxdbQueryAction');
export const mxdbDistinctAction = defineAction<DistinctRequest, DistinctResponse>()('mxdbDistinctAction');
