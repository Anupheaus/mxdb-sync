import { defineAction } from '@anupheaus/socket-api/common';
import type {
  ClientToServerSyncRequest,
  ClientToServerSyncResponse,
  DistinctRequest,
  DistinctResponse,
  GetAllRequest,
  GetRequest,
  GetResponse,
  MXDBServerToClientSyncPayload,
  QueryRequest,
  QueryResponse,
  ReconcileRequest,
  ReconcileResponse,
  ServerToClientSyncAck,
} from './models';

// ─── Sync actions (C2S + S2C) ───────────────────────────────────────────────
export const mxdbClientToServerSyncAction = defineAction<ClientToServerSyncRequest, ClientToServerSyncResponse>()('mxdbClientToServerSyncAction');
export const mxdbServerToClientSyncAction = defineAction<MXDBServerToClientSyncPayload, ServerToClientSyncAck>()('mxdbServerToClientSyncAction');

// ─── Reconcile (reconnect stale-record cleanup) ──────────────────────────────
export const mxdbReconcileAction = defineAction<ReconcileRequest, ReconcileResponse>()('mxdbReconcileAction');

// ─── Query / get / distinct ─────────────────────────────────────────────────
export const mxdbGetAction = defineAction<GetRequest, GetResponse>()('mxdbGetAction');
export const mxdbGetAllAction = defineAction<GetAllRequest, GetResponse>()('mxdbGetAllAction');
export const mxdbQueryAction = defineAction<QueryRequest, QueryResponse>()('mxdbQueryAction');
export const mxdbDistinctAction = defineAction<DistinctRequest, DistinctResponse>()('mxdbDistinctAction');

