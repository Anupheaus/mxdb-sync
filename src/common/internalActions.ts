import { defineAction } from './defineAction';
import type { MXDBSyncRequest } from './internalModels';
import type { QueryRequest, QueryResponse, RemoveRequest, RemoveResponse, UpsertRequest, UpsertResponse } from './models';

export const mxdbQueryAction = defineAction<QueryRequest, QueryResponse>()('mxdbQueryAction');
export const mxdbSyncCollectionAction = defineAction<MXDBSyncRequest, void>()('mxdbSyncCollectionAction');
export const mxdbUpsertAction = defineAction<UpsertRequest, UpsertResponse>()('mxdbUpsertAction');
export const mxdbRemoveAction = defineAction<RemoveRequest, RemoveResponse>()('mxdbRemoveAction');
