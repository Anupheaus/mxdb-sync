import type { ServerAuditOf } from '../../../src/common';
import { dbs } from '../../../src/client/providers/dbs/Dbs';
import { DEFAULT_PORT } from '../../sync-test/config';
import { formatServerLogDetail } from '../../sync-test/formatServerLogDetail';
import { readServerAuditDocuments } from '../../sync-test/readServerAudits';
import { readServerRecords } from '../../sync-test/readServerRecords';
import {
  startLifecycle,
  setServerLogCallback,
  stopLifecycle,
  type LifecycleState,
} from '../../sync-test/serverLifecycle';
import type { RunLogger } from '../../sync-test/runLogger';
import { createSyncClient, type SyncClient } from '../../sync-test/syncClient';
import { syncTestCollection, type SyncTestRecord } from '../../sync-test/types';
import { createE2eRunLogger } from './createE2eRunLogger';
import { installBrowserEnvironment } from './browserEnvironment';
import { clearSyncTestCollections } from './mongoData';
import { e2eForwardingRunLogger } from './e2eRunLogger';
import { setE2eRunLogger } from './e2eRunLoggerSink';

export interface SetupE2EOptions {
  /** Passed to `startLifecycle` (`0` = OS-chosen port). */
  port?: number;
  /** If true, do not clear `syncTest` / `syncTest_sync` after the server is ready. */
  skipInitialMongoClear?: boolean;
}

/** Named client handle: same as {@link SyncClient} with optional host on `connect()`. */
export type E2EClientHandle = SyncClient & {
  /**
   * Mount the React tree and wait for the driver. If `host` is omitted, uses
   * `useServer().socketHost` (`localhost:${port}`).
   */
  connect(host?: string): Promise<void>;
};

export interface E2EServerAccess {
  readonly mongoUri: string;
  readonly port: number;
  /**
   * Socket host without protocol (socket-api builds `wss://` from this).
   * Same convention as `tests/sync-test/clientSync.integration.test.ts`.
   */
  readonly socketHost: string;
  stopServer(): Promise<void>;
  restartServer(): ReturnType<LifecycleState['restartServer']>;
  /** All rows in the server `syncTest` collection. */
  readLiveRecords(): Promise<SyncTestRecord[]>;
  /** Parsed audit documents from `{liveCollectionName}_sync` (default `syncTest`). */
  readAudits(liveCollectionName?: string): Promise<Map<string, ServerAuditOf<SyncTestRecord>>>;
  /** Same as initial reset: truncate sync-test live + audit collections. */
  clearStoredCollectionData(): Promise<void>;
  /**
   * Poll Mongo until `syncTest` contains a row with the given id (or timeout).
   * Use after local upserts so C2S sync can finish.
   */
  waitForLiveRecord(
    recordId: string,
    options?: { timeoutMs?: number; intervalMs?: number },
  ): Promise<void>;
}

interface ClientEntry {
  dbName: string;
  raw: SyncClient;
}

interface E2EContextInternal {
  lifecycle: LifecycleState;
  clients: Map<string, ClientEntry>;
  runLogger: RunLogger;
}

let ctx: E2EContextInternal | null = null;

function clientDbName(label: string): string {
  return `e2e-client-${label}`;
}

function requireCtx(): E2EContextInternal {
  if (ctx == null) {
    throw new Error('E2E: call setupE2E() from beforeAll (or await setupE2E()) before useClient / useServer.');
  }
  return ctx;
}

function wrapClient(raw: SyncClient): E2EClientHandle {
  const origConnect = raw.connect.bind(raw);
  const hostConnect = (host?: string) => {
    const h = host ?? useServer().socketHost;
    return origConnect(h);
  };
  const handle = raw as E2EClientHandle;
  handle.connect = hostConnect;
  return handle;
}

/**
 * One-time environment (IndexedDB + JSDOM), MongoDB Memory Server, and HTTPS sync server child.
 * Temporarily clears `global.window` / `document` while spawning the server (same as sync-test).
 */
export async function setupE2E(options?: SetupE2EOptions): Promise<void> {
  if (ctx != null) {
    throw new Error('E2E: setupE2E() was already called. Call teardownE2E() in afterAll before starting another suite in the same worker.');
  }

  installBrowserEnvironment();

  const port = options?.port ?? DEFAULT_PORT;
  const win = (globalThis as unknown as { window?: unknown }).window;
  const doc = (globalThis as unknown as { document?: Document }).document;
  delete (globalThis as unknown as { window?: unknown }).window;
  delete (globalThis as unknown as { document?: Document }).document;

  const runLogger = createE2eRunLogger();
  setE2eRunLogger(runLogger);
  setServerLogCallback((stream, line) => {
    const detail = formatServerLogDetail(stream, line);
    if (detail != null) runLogger.log('server_log', detail);
  });
  runLogger.log('test_setup', { phase: 'e2e_setupE2E', port: options?.port ?? DEFAULT_PORT });

  let lifecycle: LifecycleState;
  try {
    lifecycle = await startLifecycle(port, [syncTestCollection]);
    if (!options?.skipInitialMongoClear) {
      await clearSyncTestCollections(lifecycle.mongoUri);
    }
  } finally {
    (globalThis as unknown as { window: unknown }).window = win;
    (globalThis as unknown as { document: Document }).document = doc;
  }

  runLogger.log('server_start', { port: lifecycle.port });
  ctx = { lifecycle, clients: new Map(), runLogger };
}

/**
 * Disconnect local clients, close their DB handles, and clear server-side sync-test data.
 * Intended for `beforeEach` so each test starts from an empty server and fresh client DB names
 * are recreated on next `useClient`.
 */
export async function resetE2E(): Promise<void> {
  const c = requireCtx();
  c.runLogger.log('test_setup', { phase: 'e2e_reset' });
  for (const { dbName, raw } of c.clients.values()) {
    raw.unmount();
    await dbs.close(dbName);
  }
  c.clients.clear();
  await clearSyncTestCollections(c.lifecycle.mongoUri);
}

/**
 * Stop clients, terminate the server child, and stop MongoDB Memory Server.
 * Safe to call when setup was skipped (no-op).
 */
export async function teardownE2E(): Promise<void> {
  if (ctx == null) return;
  const { runLogger } = ctx;
  for (const { dbName, raw } of ctx.clients.values()) {
    raw.unmount();
    await dbs.close(dbName);
  }
  ctx.clients.clear();
  await stopLifecycle(true);
  runLogger.log('server_stop', {});
  runLogger.log('test_end', {});
  setServerLogCallback(null);
  setE2eRunLogger(undefined);
  runLogger.close();
  ctx = null;
}

/**
 * Access the running sync-test server: Mongo URI, port, and helpers to read or clear data.
 */
export function useServer(): E2EServerAccess {
  const { lifecycle } = requireCtx();
  const socketHost = `localhost:${lifecycle.port}`;
  const mongoUri = lifecycle.mongoUri;
  return {
    mongoUri,
    port: lifecycle.port,
    socketHost,
    stopServer: () => lifecycle.stopServer(),
    restartServer: () => lifecycle.restartServer(),
    readLiveRecords: () => readServerRecords(mongoUri),
    readAudits: (liveCollectionName = syncTestCollection.name) =>
      readServerAuditDocuments(mongoUri, liveCollectionName),
    clearStoredCollectionData: () => clearSyncTestCollections(mongoUri),
    waitForLiveRecord: async (recordId, options) => {
      const timeoutMs = options?.timeoutMs ?? 30_000;
      const intervalMs = options?.intervalMs ?? 50;
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const rows = await readServerRecords(mongoUri);
        if (rows.some(r => r.id === recordId)) return;
        if (Date.now() >= deadline) {
          throw new Error(
            `E2E: waitForLiveRecord("${recordId}") timed out after ${timeoutMs}ms`,
          );
        }
        await new Promise<void>(r => setTimeout(r, intervalMs));
      }
    },
  };
}

/**
 * Return a named client, creating it on first use. Each label gets a stable logical name until
 * {@link resetE2E} or {@link teardownE2E}, which unmount and drop the client so the next
 * `useClient` builds a new one.
 */
export function useClient(label: string): E2EClientHandle {
  if (label.length === 0) throw new Error('useClient: label must be non-empty');
  const c = requireCtx();
  let entry = c.clients.get(label);
  if (entry == null) {
    const dbName = clientDbName(label);
    const raw = createSyncClient(`e2e-${label}`, e2eForwardingRunLogger, { dbName });
    entry = { dbName, raw };
    c.clients.set(label, entry);
  }
  return wrapClient(entry.raw);
}
