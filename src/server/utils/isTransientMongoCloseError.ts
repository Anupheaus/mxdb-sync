/**
 * Detects transient MongoDB errors raised when in-flight operations are
 * interrupted by a `MongoClient.close()` — expected during server restart /
 * teardown and not a correctness failure.
 *
 * Matched error shapes:
 * - `MongoClientClosedError` — operation interrupted because client was closed
 * - `MongoPoolClosedError` / `PoolClosedError` — checkout from a closed pool
 * - `MongoExpiredSessionError` — "Cannot use a session that has ended" (session aborted during shutdown)
 * - `MongoNotConnectedError` — "Client must be connected before running operations" (post-restart race)
 *
 * Callers should downgrade these to `warn` so they don't trip
 * `getAppLoggerErrorCount()` assertions at the end of tests that intentionally
 * restart the server mid-workload.
 */
export function isTransientMongoCloseError(err: unknown): boolean {
  if (err == null || typeof err !== 'object') return false;
  const anyErr = err as { name?: string; message?: string };
  const name = anyErr.name ?? '';
  if (
    name === 'MongoClientClosedError'
    || name === 'MongoPoolClosedError'
    || name === 'PoolClosedError'
    || name === 'MongoExpiredSessionError'
    || name === 'MongoNotConnectedError'
  ) return true;
  const msg = anyErr.message ?? '';
  return /client was closed|closed connection pool|session that has ended|Client must be connected/i.test(msg);
}
