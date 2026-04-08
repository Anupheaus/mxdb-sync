/**
 * Structured run log lines (file + in-process forwarding). Suites choose event names;
 * these are the shared vocabulary used by the client harness and server child.
 */
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
  | 'client_upsert_request'
  | 'client_upsert_response'
  | 'client_get_request'
  | 'client_get_response'
  | 'client_getAll_subscribe'
  | 'client_remove'
  | 'client_remove_kept_due_to_history'
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
  /**
   * High-level validation/oracle report (expected vs server, optional extra suite fields in detail).
   * Suites attach their own payload shape in `RunLogDetail`.
   */
  | 'validation_summary'
  /** Snapshot after sync settle / idle: queues, connection hints, etc. */
  | 'sync_idle_snapshot'
  /** Per-record drill-down when a validation report fails. */
  | 'validation_record_detail'
  | 'error';

export interface RunLogDetail {
  [key: string]: unknown;
}

export interface RunLogger {
  log(event: RunLogEvent, detail?: RunLogDetail): void;
  close(): void;
}
