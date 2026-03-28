import type { Record } from '@anupheaus/common';
import { decodeTime } from 'ulidx';
import { entriesOf, type AuditEntryType, type ServerAuditOf } from '../../../src/common/auditor';
import type { E2EClientHandle } from './context';
import { useServer } from './context';

/**
 * Poll until `predicate()` resolves true or `timeoutMs` elapses.
 */
export async function waitUntilAsync(
  predicate: () => Promise<boolean>,
  label: string,
  timeoutMs = 60_000,
  intervalMs = 50,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() >= deadline) {
      throw new Error(`Timeout waiting for: ${label}`);
    }
    await new Promise<void>(r => setTimeout(r, intervalMs));
  }
}

/**
 * Poll Mongo (via {@link useServer}) until no live `syncTest` row exists for `recordId`.
 * Requires active e2e context.
 */
export async function waitForLiveRecordAbsent(
  recordId: string,
  timeoutMs = 30_000,
): Promise<void> {
  await waitUntilAsync(
    async () => {
      const server = useServer();
      const rows = await server.readLiveRecords();
      return !rows.some(r => r.id === recordId);
    },
    `server has no live row ${recordId}`,
    timeoutMs,
  );
}

export interface WaitForAllClientsIdleOptions {
  timeoutMs?: number;
  /** Consecutive idle polls required before resolving (default `8`). */
  stableTicksRequired?: number;
  pollMs?: number;
}

/**
 * Poll until every client reports not synchronising and empty C2S queue for several consecutive ticks.
 */
export async function waitForAllClientsIdle(
  clients: readonly E2EClientHandle[],
  options?: WaitForAllClientsIdleOptions,
): Promise<void> {
  if (clients.length === 0) return;
  const timeoutMs = options?.timeoutMs ?? 90_000;
  const stableTicksRequired = options?.stableTicksRequired ?? 8;
  const pollMs = options?.pollMs ?? 100;
  const deadline = Date.now() + timeoutMs;
  let stableTicks = 0;
  while (Date.now() < deadline) {
    const idle = clients.every(
      c =>
        !c.getIsSynchronising()
        && c.getPendingC2SSyncQueueSize() === 0,
    );
    if (idle) {
      stableTicks += 1;
      if (stableTicks >= stableTicksRequired) return;
    } else {
      stableTicks = 0;
    }
    await new Promise<void>(r => setTimeout(r, pollMs));
  }
  throw new Error('waitForAllClientsIdle: timeout');
}

/**
 * Server audit entry types in chronological order (by entry ULID `decodeTime`).
 */
export function auditEntryTypesChronological<R extends Record = Record>(
  audit: ServerAuditOf<R>,
): AuditEntryType[] {
  const list = [...entriesOf(audit)];
  list.sort((x, y) => decodeTime(x.id) - decodeTime(y.id));
  return list.map(e => e.type);
}
