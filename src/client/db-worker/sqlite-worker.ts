/**
 * SQLite WASM Web Worker — §4.3
 *
 * Owns the sqlite-wasm instance and OPFS file handle. All DB operations
 * run here; the main thread communicates via postMessage with correlation IDs.
 *
 * Environment detection:
 *  - Worker + OPFS available + encryptionKey provided → in-memory DB, persisted
 *    as an AES-GCM encrypted blob in OPFS (`${dbName}.enc`). The DB is
 *    serialised and re-encrypted after every write so indexes are fully intact.
 *  - Worker + OPFS available, no encryptionKey → OpfsDb (persistent, plain)
 *  - Otherwise (no OPFS, or Node.js/test) → in-memory DB (no persistence)
 */

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import type { WorkerRequestWithCorrelationId, WorkerResponse } from './worker-messages';

// ─── Types ────────────────────────────────────────────────────────────────────

type Sqlite3 = Awaited<ReturnType<typeof sqlite3InitModule>>;
type OO1Db = InstanceType<Sqlite3['oo1']['DB']>;

// ─── State ────────────────────────────────────────────────────────────────────

let db: OO1Db | null = null;
let sqlite3: Sqlite3 | null = null;

// §4.3 — per-database encryption state
let cryptoKey: CryptoKey | null = null;
let encryptedFileName = '';

// §4.9 — exclusive Web Lock held for the lifetime of this open database.
// Prevents a second dedicated-worker tab from opening the same OPFS file.
// In SharedWorker mode the lock is acquired once (singleton process) and
// skipped on subsequent open calls because lockRelease is already set.
let lockRelease: (() => void) | null = null;

// ─── Web Lock helpers ─────────────────────────────────────────────────────────

/**
 * Acquires an exclusive Web Lock named `mxdb-db-${dbName}`.
 * Returns `true` if acquired (or if Locks API is unavailable / already held).
 * Returns `false` if another context already holds the lock.
 */
function acquireDbLock(dbName: string): Promise<boolean> {
  // Already held (e.g. SharedWorker re-open) or API unavailable → no-op.
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

function reply(correlationId: string, result: unknown) {
  const response: WorkerResponse = { correlationId, result };
  self.postMessage(response);
}

function replyError(correlationId: string, err: unknown) {
  const response: WorkerResponse = {
    correlationId,
    error: err instanceof Error ? err.message : String(err),
  };
  self.postMessage(response);
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

/**
 * Reads, decrypts and deserialises an existing encrypted database from OPFS.
 * Returns the decrypted bytes, or `undefined` if the file doesn't exist yet.
 */
async function readAndDecryptOpfs(key: CryptoKey, fileName: string): Promise<Uint8Array | undefined> {
  try {
    const root = await (navigator.storage as any).getDirectory();
    const fh = await root.getFileHandle(fileName, { create: false });
    const file = await fh.getFile();
    const buf = await file.arrayBuffer();
    if (buf.byteLength <= 12) return undefined; // too small to be valid
    const iv = new Uint8Array(buf, 0, 12);
    const ciphertext = new Uint8Array(buf, 12);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
    return new Uint8Array(plain);
  } catch {
    return undefined; // file not found or decryption failed → fresh DB
  }
}

/**
 * Serialises the in-memory DB, encrypts it with AES-GCM and writes it to OPFS.
 * Format: [12-byte IV][AES-GCM ciphertext].
 */
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

/**
 * Opens an in-memory SQLite DB, loading and decrypting existing data from OPFS
 * when available. Stores the key for subsequent flush operations.
 */
async function openEncrypted(
  s3: Sqlite3,
  dbName: string,
  keyBytes: Uint8Array,
): Promise<OO1Db> {
  const keyBuf: ArrayBuffer = keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer;
  cryptoKey = await crypto.subtle.importKey('raw', keyBuf, 'AES-GCM', false, ['encrypt', 'decrypt']);
  encryptedFileName = `${dbName}.enc`;

  const existingBytes = isOpfsAvailable()
    ? await readAndDecryptOpfs(cryptoKey, encryptedFileName)
    : undefined;

  const newDb = new s3.oo1.DB(':memory:', 'ct');

  if (existingBytes != null) {
    // Load the decrypted bytes into the in-memory DB via sqlite3_deserialize.
    // SQLITE_DESERIALIZE_FREEONCLOSE (1) — SQLite frees the buffer on close.
    // SQLITE_DESERIALIZE_RESIZEABLE (2) — buffer can grow for writes.
    const pData = (s3.wasm as any).allocFromTypedArray(existingBytes);
    const rc = (s3.capi as any).sqlite3_deserialize(
      newDb.pointer, 'main', pData,
      existingBytes.byteLength, existingBytes.byteLength,
      1 | 2, // FREEONCLOSE | RESIZEABLE
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
  dbName: string,
  statements: string[],
  encryptionKey: Uint8Array | undefined,
  correlationId: string,
) {
  try {
    const acquired = await acquireDbLock(dbName);
    if (!acquired) {
      replyError(correlationId, new Error(`Database "${dbName}" is already open in another tab. Only one tab can access this database when SharedWorker is unavailable.`));
      return;
    }

    if (!sqlite3) {
      sqlite3 = await (sqlite3InitModule as any)({
        print: () => { /* suppress */ },
        printErr: () => { /* suppress */ },
      });
    }

    if (db) {
      if (cryptoKey) await flushEncrypted(sqlite3!, db);
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

    // Flush after DDL setup so the schema is persisted immediately
    if (cryptoKey && sqlite3) await flushEncrypted(sqlite3!, db);

    reply(correlationId, null);
  } catch (err) {
    replyError(correlationId, err);
  }
}

async function handleExec(sql: string, params: unknown[] | undefined, correlationId: string) {
  try {
    if (!db || !sqlite3) throw new Error('Database not open');
    db.exec({ sql, bind: (params ?? []) as any });
    if (cryptoKey) await flushEncrypted(sqlite3, db);
    reply(correlationId, null);
  } catch (err) {
    replyError(correlationId, err);
  }
}

async function handleExecBatch(
  statements: Array<{ sql: string; params?: unknown[] }>,
  correlationId: string,
) {
  try {
    if (!db || !sqlite3) throw new Error('Database not open');
    (db as any).transaction((tx: any) => {
      for (const { sql, params } of statements) {
        tx.exec({ sql, bind: (params ?? []) as any });
      }
    });
    if (cryptoKey) await flushEncrypted(sqlite3, db);
    reply(correlationId, null);
  } catch (err) {
    replyError(correlationId, err);
  }
}

function handleQuery(sql: string, params: unknown[] | undefined, correlationId: string) {
  try {
    if (!db) throw new Error('Database not open');
    const rows: Record<string, unknown>[] = [];
    db.exec({
      sql,
      bind: (params ?? []) as any,
      rowMode: 'object',
      callback: (row: Record<string, unknown>) => { rows.push(row); },
    });
    reply(correlationId, rows);
  } catch (err) {
    replyError(correlationId, err);
  }
}

async function handleClose(correlationId: string) {
  try {
    if (db && sqlite3 && cryptoKey) await flushEncrypted(sqlite3, db);
    db?.close();
    db = null;
    cryptoKey = null;
    encryptedFileName = '';
    releaseDbLock();
    reply(correlationId, null);
  } catch (err) {
    replyError(correlationId, err);
  }
}

// ─── Message dispatch ─────────────────────────────────────────────────────────

self.addEventListener('message', ({ data }: MessageEvent<WorkerRequestWithCorrelationId>) => {
  const { type, correlationId } = data;
  switch (type) {
    case 'open':
      void handleOpen(data.dbName, data.statements, data.encryptionKey, correlationId);
      break;
    case 'exec':
      void handleExec(data.sql, data.params, correlationId);
      break;
    case 'exec-batch':
      void handleExecBatch(data.statements, correlationId);
      break;
    case 'query':
      handleQuery(data.sql, data.params, correlationId);
      break;
    case 'close':
      void handleClose(correlationId);
      break;
    default:
      replyError((data as any).correlationId ?? '', `Unknown message type: ${(data as any).type}`);
  }
});
