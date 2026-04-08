import type { Record as MXDBRecord } from '@anupheaus/common';
import type { AuditEntry } from '../auditor';

// §4.1
export interface MXDBRecordStatesByCollectionRequest { collectionName: string; recordIds: string[]; }
export type MXDBRecordStatesRequest = MXDBRecordStatesByCollectionRequest[];

// §4.2 — use 'record' presence to distinguish active vs deleted
export interface MXDBActiveRecordState<T extends MXDBRecord = MXDBRecord> { record: T; audit: AuditEntry[]; }
export interface MXDBDeletedRecordState { recordId: string; audit: AuditEntry[]; }
export interface MXDBRecordStatesByCollection<T extends MXDBRecord = MXDBRecord> { collectionName: string; records: (MXDBActiveRecordState<T> | MXDBDeletedRecordState)[]; }
export type MXDBRecordStates<T extends MXDBRecord = MXDBRecord> = MXDBRecordStatesByCollection<T>[];

// §4.3 — cursors (lightweight, no full audit)
export interface MXDBActiveRecordCursor<T extends MXDBRecord = MXDBRecord> { record: T; lastAuditEntryId: string; }
export interface MXDBDeletedRecordCursor { recordId: string; lastAuditEntryId: string; }
export interface MXDBRecordCursorsByCollection<T extends MXDBRecord = MXDBRecord> { collectionName: string; records: (MXDBActiveRecordCursor<T> | MXDBDeletedRecordCursor)[]; }
export type MXDBRecordCursors<T extends MXDBRecord = MXDBRecord> = MXDBRecordCursorsByCollection<T>[];

// §4.4
export interface MXDBSyncEngineResponseItem { collectionName: string; successfulRecordIds: string[]; }
export type MXDBSyncEngineResponse = MXDBSyncEngineResponseItem[];

// §4.5
export interface MXDBUpdateItemRequest<T extends MXDBRecord = MXDBRecord> {
  collectionName: string;
  deletedRecordIds?: string[];
  records?: { record: T; lastAuditEntryId: string; }[];
}
export type MXDBUpdateRequest<T extends MXDBRecord = MXDBRecord> = MXDBUpdateItemRequest<T>[];

// CD types
export interface ClientDispatcherEnqueueItem { collectionName: string; recordId: string; }
export interface ClientDispatcherRequestRecord { id: string; hash?: string; entries: AuditEntry[]; }
export interface ClientDispatcherRequestItem { collectionName: string; records: ClientDispatcherRequestRecord[]; }
export type ClientDispatcherRequest = ClientDispatcherRequestItem[];

// SD filter (§8.5)
export interface ServerDispatcherFilterRecord { id: string; hash?: string; lastAuditEntryId: string; }
export interface ServerDispatcherFilter { collectionName: string; records: ServerDispatcherFilterRecord[]; deletedRecordIds?: string[]; }

// Error
export class SyncPausedError extends Error {
  constructor() { super('ClientReceiver is paused'); this.name = 'SyncPausedError'; }
}
