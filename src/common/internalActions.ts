import { defineAction } from './defineAction';
import type { MXDBSyncRequest, MXDBSyncResponse } from './internalModels';
import type { QueryRequest, QueryResponse } from './models';

export const mxdbQueryAction = defineAction<QueryRequest, QueryResponse>()('mxdbQueryAction');
export const mxdbSyncAction = defineAction<MXDBSyncRequest, MXDBSyncResponse>()('mxdbSyncAction');