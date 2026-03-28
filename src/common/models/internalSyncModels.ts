import type { Record } from '@anupheaus/common';
import type { AuditEntry } from '../auditor';

// ─── Shared sync types ──────────────────────────────────────────────────────

export interface MXDBSyncIdResult<RecordType extends Record = Record> {
  id: string;
  auditEntryId?: string;
  record?: RecordType;
  error?: string;
}

// ─── ClientToServerSynchronisation types (C2S) ──────────────────────────────

/** §4.4 — Queued entry shape inside ClientToServerSynchronisation. */
export interface ClientToServerQueueEntry {
  collectionName: string;
  recordId: string;
  recordHash: string;
  lastAuditEntryId: string;
}

/** §5.1 — Per-record update in a C2S batch. */
export interface ClientToServerSyncUpdate {
  recordId: string;
  recordHash: string;
  /** Ordered audit entries for this record (Branched entries excluded per §6.2). */
  entries: AuditEntry[];
}

/** §5.1 — A local record with no pending changes, sent to seed the server-side S2C mirror. */
export interface ClientToServerSyncMirrorEntry {
  recordId: string;
  recordHash: string;
  lastAuditEntryId: string;
}

/** §5.1 — Per-collection bundle in a C2S request. */
export interface ClientToServerSyncRequestItem {
  collectionName: string;
  updates: ClientToServerSyncUpdate[];
  /** Local records with no pending changes — used solely to seed the server S2C mirror. Only populated on connect/reconnect. */
  entries?: ClientToServerSyncMirrorEntry[];
}

/** §5.1 — Full C2S request payload (array of per-collection bundles). */
export type ClientToServerSyncRequest = ClientToServerSyncRequestItem[];

/** §7.1 — Per-collection element in a C2S response. */
export interface ClientToServerSyncResponseItem {
  collectionName: string;
  /** Only ids that were fully applied (merged, replayed, persisted). Omitted ids failed. */
  successfulRecordIds: string[];
}

/** §7.1 — Full C2S response payload. */
export type ClientToServerSyncResponse = ClientToServerSyncResponseItem[];

// ─── ServerToClientSynchronisation types (S2C) ──────────────────────────────

/** §2.2 — Per-record mirror row in ServerToClientSynchronisation. */
export interface ClientMirrorRow {
  recordHash: string;
  /** ULID of the last audit entry the server believes this client has applied for this row. */
  lastAuditEntryId: string;
}

/** §3 — A single updated record pushed from server to client. */
export interface S2CUpdatedRecord<RecordType extends Record = Record> {
  record: RecordType;
  /** Server's latest audit entry ULID for this materialised row after the write. */
  lastAuditEntryId: string;
}

/** §3 — A single deleted record pushed from server to client. */
export interface S2CDeletedRecord {
  recordId: string;
  /** ULID of the Deleted audit entry on the server. */
  lastAuditEntryId: string;
}

/** §3 — Per-collection element in an S2C payload. */
export interface MXDBServerToClientSyncPayloadItem<RecordType extends Record = Record> {
  collectionName: string;
  updates: S2CUpdatedRecord<RecordType>[];
  deletions: S2CDeletedRecord[];
}

/** §3 — Full S2C payload (one element per collection with work). */
export type MXDBServerToClientSyncPayload = MXDBServerToClientSyncPayloadItem[];

/** §5 — Per-collection element in a client S2C ack. */
export interface ServerToClientSyncAckItem {
  collectionName: string;
  /** Ids whose updates were applied locally with no issue. */
  successfulRecordIds: string[];
  /** Ids fully removed client-side after server deletions. */
  deletedRecordIds: string[];
}

/** §5 — Full S2C ack payload. */
export type ServerToClientSyncAck = ServerToClientSyncAckItem[];

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
