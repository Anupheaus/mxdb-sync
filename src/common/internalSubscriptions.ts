import type { DistinctRequest, DistinctResponse, QueryRequest, QueryResponse } from './models';
import { defineSubscription } from '@anupheaus/socket-api/common';

export const mxdbQuerySubscription = defineSubscription<QueryRequest, QueryResponse>()('mxdbQuerySubscription');
export const mxdbDistinctSubscription = defineSubscription<DistinctRequest, DistinctResponse>()('mxdbDistinctSubscription');
