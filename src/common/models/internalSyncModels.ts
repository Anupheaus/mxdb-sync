// ─── Reconcile types (reconnect stale-record cleanup) ───────────────────────

/** Per-collection element in a reconcile request from client to server. */
export interface ReconcileRequestItem {
  collectionName: string;
  /** Local record IDs the client holds that have no pending C2S changes. */
  localIds: string[];
}

/** Full reconcile request payload. */
export type ReconcileRequest = ReconcileRequestItem[];

/** Per-collection element in a reconcile response. */
export interface ReconcileResponseItem {
  collectionName: string;
  /** IDs that no longer exist on the server (S2C deletions already dispatched). */
  deletedIds: string[];
}

/** Full reconcile response payload. */
export type ReconcileResponse = ReconcileResponseItem[];
