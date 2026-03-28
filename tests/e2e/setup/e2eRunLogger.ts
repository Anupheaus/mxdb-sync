import type { RunLogDetail, RunLogEvent } from '../../sync-test/types';
import { getE2eRunLogger } from './e2eRunLoggerSink';

/** Minimal logger for custom harnesses that do not use the file run log. */
export const e2eNoopRunLogger = {
  log(_event: RunLogEvent, _detail?: RunLogDetail): void {
    /* noop */
  },
};

/** Forwards to the active e2e run log set in {@link setupE2E} (same events as sync-test `createSyncClient`). */
export const e2eForwardingRunLogger = {
  log(event: RunLogEvent, detail?: RunLogDetail): void {
    getE2eRunLogger()?.log(event, detail);
  },
};
