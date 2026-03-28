/**
 * SQLite WASM SharedWorker — §4.9 Multi-Tab Coordination
 *
 * One instance shared across all tabs of the same origin. Each tab connects
 * via a MessagePort and is assigned a unique portId on the first 'connect'
 * request. After any write (exec / exec-batch) a 'change-notification' is
 * broadcast to every other port so their DbCollections can reload.
 *
 * §4.3 Encryption: when `encryptionKey` is supplied in the `open` request the
 * database is kept in memory and persisted as an AES-GCM blob (`*.enc`) in
 * OPFS after every write. All tabs share the same in-memory instance, so the
 * key only needs to be correct on the first open; subsequent tabs that trigger
 * a re-open will pass the same key (derived from the same WebAuthn credential).
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import { ulid } from 'ulidx';
import type {
  WorkerRequest,
  WorkerResponse,
  ConnectRequest,
  DisconnectRequest,
} from './worker-messages';

// ─── Types ────────────────────────────────────────────────────────────────────

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type OO1Db = InstanceType<Sqlite3['oo1']['DB']>;

interface PortEntry {
  portId: string;
  port: MessagePort;
}

// ─── State ────────────────────────────────────────────────────────────────────

let db: OO1Db | null = null;
let sqlite3: Sqlite3 | null = null;
const ports = new Map<string, PortEntry>();

// §4.3 — per-database encryption state
let cryptoKey: CryptoKey | null = null;
let encryptedFileName = '';

// §4.9 — exclusive Web Lock. Acquired once by the SharedWorker singleton on
// first open; skipped on subsequent opens because lockRelease is already set.
// Prevents a second dedicated-worker tab from stealing the same OPFS file.
let lockRelease: (() => void) | null = null;

// ─── Web Lock helpers ─────────────────────────────────────────────────────────

function acquireDbLock(dbName: string): Promise<boolean> {
  if (lockRelease != null || typeof navigator === 'undefined' || navigator.locks == null) {
    return Promise.resolve(true);
  }
  return new Promise(resolve => {
    navigator.locks.request(`mxdb-db-${dbName}`, { ifAvailable: true }, lock => {
      if (lock == null) { resolve(false); return Promise.resolve(); }
      let release!: () => void;
      const held = new Promise<void>(r => { release = r; });
      lockRelease = release;
      resolve(true);
      return held;
    });
  });
}

function releaseDbLock() {
  lockRelease?.();
  lockRelease = null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isOpfsAvailable(): boolean {
  try {
    return typeof (globalThis as any).navigator?.storage?.getDirectory === 'function';
  } catch {
    return false;
  }
}

function replyOn(port: MessagePort, correlationId: string, result: unknown) {
  const response: WorkerResponse = { correlationId, result };
  port.postMessage(response);
}

function replyErrorOn(port: MessagePort, correlationId: string, err: unknown) {
  const response: WorkerResponse = {
    correlationId,
    error: err instanceof Error ? err.message : String(err),
  };
  port.postMessage(response);
}

/** Broadcast a change notification to every connected port except the sender. */
function broadcastChange(senderPortId: string, collectionName: string) {
  for (const entry of ports.values()) {
    if (entry.portId === senderPortId) continue;
    entry.port.postMessage({ type: 'change-notification', collectionName });
  }
}

// ─── REGEXP custom function ───────────────────────────────────────────────────

function registerRegexp(s3: Sqlite3, database: OO1Db) {
  (s3 as any).createFunction(database, 'regexp', (_ctx: unknown, pattern: string, value: string) => {
    try {
      return new RegExp(pattern).test(value) ? 1 : 0;
    } catch {
      return 0;
    }
  }, { arity: 2 });
}

// ─── §4.3 Encryption helpers ──────────────────────────────────────────────────

async function readAndDecryptOpfs(key: CryptoKey, fileName: string): Promise<Uint8Array | undefined> {
  try {
    const root = await (navigator.storage as any).getDirectory();
    const fh = await root.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    const buf = await file.arrayBuffer();
    if (buf.byteLength <= 12) return undefined;
    const iv = new Uint8Array(buf, 0, 12);
    const ciphertext = new Uint8Array(buf, 12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    return undefined;
  }
}

async function flushEncrypted(s3: Sqlite3, database: OO1Db): Promise<void> {
  if (!cryptoKey || !isOpfsAvailable()) return;
  const dbBytes: Uint8Array = (s3.capi as any).sqlite3_js_db_export(database.pointer, 'main');
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const dbBuf: ArrayBuffer = dbBytes.buffer.slice(dbBytes.byteOffset, dbBytes.byteOffset + dbBytes.byteLength) as ArrayBuffer;
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, dbBuf);
  const out = new Uint8Array(12 + ciphertext.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ciphertext), 12);
  const root = await (navigator.storage as any).getDirectory();
  const fh = await root.getFileHandle(encryptedFileName, { create: true });
  const sah = await (fh as any).createSyncAccessHandle();
  try {
    sah.truncate(0);
    sah.write(out, { at: 0 });
    sah.flush();
  } finally {
    sah.close();
  }
}

async function openEncrypted(s3: Sqlite3, dbName: string, keyBytes: Uint8Array): Promise<OO1Db> {
  const keyBuf: ArrayBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  cryptoKey = await crypto.subtle.importKey('raw', keyBuf, 'AES-GCM', false, ['encrypt', 'decrypt']);
  encryptedFileName = `${dbName}.enc`;

  const existingBytes = isOpfsAvailable()
    ? await readAndDecryptOpfs(cryptoKey, encryptedFileName)
    : undefined;

  const newDb = new s3.oo1.DB(':memory:', 'ct');

  if (existingBytes != null) {
    const pData = (s3.wasm as any).allocFromTypedArray(existingBytes);
    const rc = (s3.capi as any).sqlite3_deserialize(
      newDb.pointer, 'main', pData,
      existingBytes.byteLength, existingBytes.byteLength,
      1 | 2, // SQLITE_DESERIALIZE_FREEONCLOSE | SQLITE_DESERIALIZE_RESIZEABLE
    );
    if (rc !== 0) {
      (s3.wasm as any).dealloc(pData);
      throw new Error(`sqlite3_deserialize failed with code ${rc}`);
    }
  }

  return newDb;
}

// ─── Operation handlers ───────────────────────────────────────────────────────

async function handleOpen(
  port: MessagePort,
  dbName: string,
  statements: string[],
  encryptionKey: Uint8Array | undefined,
  correlationId: string,
) {
  try {
    const acquired = await acquireDbLock(dbName);
    if (!acquired) {
      replyErrorOn(port, correlationId, new Error(`Database "${dbName}" is already open in another context.`));
      return;
    }

    if (!sqlite3) {
      sqlite3 = await (sqlite3InitModule as any)({
        print: () => { /* suppress */ },
        printErr: () => { /* suppress */ },
      });
    }

    if (db) {
      if (cryptoKey && sqlite3) await flushEncrypted(sqlite3, db);
      db.close();
      db = null;
      cryptoKey = null;
      encryptedFileName = '';
    }

    if (encryptionKey != null && encryptionKey.byteLength > 0) {
      db = await openEncrypted(sqlite3!, dbName, encryptionKey);
    } else if (isOpfsAvailable() && sqlite3!.oo1.OpfsDb != null) {
      db = new sqlite3!.oo1.OpfsDb(`${dbName}.sqlite3`, 'ct');
    } else {
      db = new sqlite3!.oo1.DB(':memory:', 'ct');
    }

    registerRegexp(sqlite3!, db);

    (db as any).transaction((tx: any) => {
      for (const sql of statements) {
        tx.exec(sql);
      }
    });

    if (cryptoKey && sqlite3) await flushEncrypted(sqlite3, db);

    replyOn(port, correlationId, null);
  } catch (err) {
    replyErrorOn(port, correlationId, err);
  }
}

async function handleExec(
  port: MessagePort,
  senderPortId: string,
  sql: string,
  params: unknown[] | undefined,
  correlationId: string,
  collectionHint: string | undefined,
) {
  try {
    if (!db || !sqlite3) throw new Error('Database not open');
    db.exec({ sql, bind: (params ?? []) as any });
    if (cryptoKey) await flushEncrypted(sqlite3, db);
    replyOn(port, correlationId, null);
    if (collectionHint) broadcastChange(senderPortId, collectionHint);
  } catch (err) {
    replyErrorOn(port, correlationId, err);
  }
}

async function handleExecBatch(
  port: MessagePort,
  senderPortId: string,
  statements: Array<{ sql: string; params?: unknown[] }>,
  correlationId: string,
  collectionHint: string | undefined,
) {
  try {
    if (!db || !sqlite3) throw new Error('Database not open');
    (db as any).transaction((tx: any) => {
      for (const { sql, params } of statements) {
        tx.exec({ sql, bind: (params ?? []) as any });
      }
    });
    if (cryptoKey) await flushEncrypted(sqlite3, db);
    replyOn(port, correlationId, null);
    if (collectionHint) broadcastChange(senderPortId, collectionHint);
  } catch (err) {
    replyErrorOn(port, correlationId, err);
  }
}

function handleQuery(
  port: MessagePort,
  sql: string,
  params: unknown[] | undefined,
  correlationId: string,
) {
  try {
    if (!db) throw new Error('Database not open');
    const rows: Record<string, unknown>[] = [];
    db.exec({
      sql,
      bind: (params ?? []) as any,
      rowMode: 'object',
      callback: (row: Record<string, unknown>) => { rows.push(row); },
    });
    replyOn(port, correlationId, rows);
  } catch (err) {
    replyErrorOn(port, correlationId, err);
  }
}

async function handleClose(port: MessagePort, correlationId: string) {
  try {
    if (db && sqlite3 && cryptoKey) await flushEncrypted(sqlite3, db);
    db?.close();
    db = null;
    cryptoKey = null;
    encryptedFileName = '';
    releaseDbLock();
    replyOn(port, correlationId, null);
  } catch (err) {
    replyErrorOn(port, correlationId, err);
  }
}

function handleConnect(port: MessagePort, req: ConnectRequest) {
  const portId = ulid();
  ports.set(portId, { portId, port });
  replyOn(port, req.correlationId, portId);
}

function handleDisconnect(req: DisconnectRequest) {
  ports.delete(req.portId);
}

// ─── Per-port message dispatch ────────────────────────────────────────────────

function dispatchMessage(port: MessagePort, senderPortId: string, data: WorkerRequest) {
  switch (data.type) {
    case 'connect':
      handleConnect(port, data);
      break;
    case 'disconnect':
      handleDisconnect(data);
      break;
    case 'open':
      void handleOpen(port, data.dbName, data.statements, data.encryptionKey, data.correlationId);
      break;
    case 'exec':
      void handleExec(port, senderPortId, data.sql, data.params, data.correlationId, data.collectionHint);
      break;
    case 'exec-batch':
      void handleExecBatch(port, senderPortId, data.statements, data.correlationId, data.collectionHint);
      break;
    case 'query':
      handleQuery(port, data.sql, data.params, data.correlationId);
      break;
    case 'close':
      void handleClose(port, data.correlationId);
      break;
    default:
      replyErrorOn(port, (data as any).correlationId ?? '', `Unknown message type: ${(data as any).type}`);
  }
}

// ─── SharedWorker entry point ─────────────────────────────────────────────────

(self as unknown as SharedWorkerGlobalScope).onconnect = (event: MessageEvent) => {
  const port: MessagePort = event.ports[0];
  port.start();

  let senderPortId = '';

  port.addEventListener('message', ({ data }: MessageEvent<WorkerRequest>) => {
    if (data.type === 'connect') {
      const portId = ulid();
      senderPortId = portId;
      ports.set(portId, { portId, port });
      replyOn(port, data.correlationId, portId);
      return;
    }
    if (data.type === 'disconnect') {
      handleDisconnect(data);
      return;
    }
    dispatchMessage(port, senderPortId, data);
  });
};
