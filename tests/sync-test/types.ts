import type { Record } from '@anupheaus/common';
import { defineCollection } from '../../src/common';

/**
 * Record shape for full CRUD sync test: nested object, optional fields, array.
 * Used to test updates to nested props, unsetting, array add/remove, and deletions.
 */
export interface SyncTestMetadata {
  count: number;
  tag?: string | null;
}

export interface SyncTestRecord extends Record {
  id: string;
  clientId: string;
  updatedAt: number;
  /** Optional; can be set, updated, or unset (undefined). */
  name?: string | null;
  /** Nested object; can be set, partially updated, or cleared. */
  metadata?: SyncTestMetadata | null;
  /** Array; elements can be added or removed. */
  tags?: string[] | null;
  /** Legacy simple value; keep for backward compatibility. */
  value?: string | null;
}

export const syncTestCollection = defineCollection<SyncTestRecord>({
  name: 'syncTest',
  indexes: [],
});

/** Logged upsert for debugging / extensions (full payload as sent from the test harness). */
export interface RecordOfTruthEntry {
  clientId: string;
  record: SyncTestRecord;
}

/** Event names for the run logger. */
export type RunLogEvent =
  | 'test_start'
  | 'test_end'
  | 'test_setup'
  | 'server_start'
  | 'server_stop'
  | 'server_restart'
  | 'client_connect'
  | 'client_disconnect'
  | 'client_upsert'
  | 'client_upsert_offline'
  | 'client_upsert_queued_offline'
  | 'client_upsert_flush'
  | 'client_upsert_flush_done'
  | 'client_upsert_request'
  | 'client_upsert_response'
  | 'client_get_request'
  | 'client_get_response'
  | 'client_getAll_subscribe'
  | 'client_remove'
  | 'client_remove_offline'
  | 'client_remove_kept_due_to_history'
  | 'client_remove_queued_offline'
  | 'client_remove_flush'
  | 'client_remove_flush_done'
  | 'client_remove_request'
  | 'client_remove_response'
  | 'socket_emit'
  | 'socket_ack'
  | 'socket_connect'
  | 'socket_disconnect'
  | 'socket_error'
  | 'sync_request'
  | 'sync_response'
  | 'sync_ack'
  | 'server_log'
  /** Any {@link Logger} entry in the vitest process (client LoggerProvider, etc.). */
  | 'app_logger'
  | 'integrity_report'
  /** After mongo settle / final grace: C2S queue sizes and LWW client-oracle record count. */
  | 'post_settle_diag'
  /** One event per troubled id: LWW oracle row, truth live + audit, server live + _sync audit, per-client local row/audit. */
  | 'integrity_mismatch_record'
  | 'error';

export interface RunLogDetail {
  [key: string]: unknown;
}
