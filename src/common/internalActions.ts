import { defineAction } from '@anupheaus/socket-api/common';
import type {
  DistinctRequest,
  DistinctResponse,
  GetAllRequest,
  GetRequest,
  GetResponse,
  QueryRequest,
  QueryResponse,
  ReconcileRequest,
  ReconcileResponse,
} from './models';
import type {
  ClientDispatcherRequest,
  MXDBRecordCursors,
  MXDBSyncEngineResponse,
} from './sync-engine';

// ─── Sync actions (C2S + S2C) ───────────────────────────────────────────────
// These wire the four sync-engine components across the Socket.IO transport:
//   CD  → mxdbClientToServerSyncAction → SR
//   SD  → mxdbServerToClientSyncAction → CR
export const mxdbClientToServerSyncAction = defineAction<ClientDispatcherRequest, MXDBSyncEngineResponse>()('mxdbClientToServerSyncAction');
export const mxdbServerToClientSyncAction = defineAction<MXDBRecordCursors, MXDBSyncEngineResponse>()('mxdbServerToClientSyncAction');

// ─── Reconcile (reconnect stale-record cleanup) ──────────────────────────────
export const mxdbReconcileAction = defineAction<ReconcileRequest, ReconcileResponse>()('mxdbReconcileAction');

// ─── Query / get / distinct ─────────────────────────────────────────────────
export const mxdbGetAction = defineAction<GetRequest, GetResponse>()('mxdbGetAction');
export const mxdbGetAllAction = defineAction<GetAllRequest, GetResponse>()('mxdbGetAllAction');
export const mxdbQueryAction = defineAction<QueryRequest, QueryResponse>()('mxdbQueryAction');
export const mxdbDistinctAction = defineAction<DistinctRequest, DistinctResponse>()('mxdbDistinctAction');

