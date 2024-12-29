import { defineSubscription } from './defineSubscription';
import type { QueryRequest, QueryResponse } from './models';

export const mxdbQuerySubscription = defineSubscription<QueryRequest, QueryResponse>()('mxdbQuerySubscription');
