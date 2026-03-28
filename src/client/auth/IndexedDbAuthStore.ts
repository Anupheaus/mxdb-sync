/**
 * §4.3 / §4.4 — IndexedDB auth store.
 *
 * Stores one record per registered device:
 *   { id, credentialId, dbName, token, isDefault }
 *
 * `dbName`     — random filename used for this user's SQLite DB in OPFS.
 * `credentialId` — raw WebAuthn credential ID bytes (for PRF key derivation).
 * `token`      — current ULID auth token (mirrors SQLite mxdb_authentication).
 * `isDefault`  — true for the user that should be loaded on next app start.
 *
 * All methods are no-ops when IndexedDB is unavailable (Node / test environments).
 */

const IDB_STORE = 'mxdb_authentication';

export interface MXDBAuthEntry {
  id: string;
  credentialId: Uint8Array;
  /** Random filename for this user's SQLite DB (no extension). */
  dbName: string;
  /** Current ULID auth token — kept in sync with SQLite mxdb_authentication. */
  token: string;
  /**
   * SHA-256 hex digest of the WebAuthn-derived encryption key for this device.
   * Sent in the socket handshake so the server can disable the device if an
   * invalid token is presented (e.g. after a replay attack).
   */
  keyHash: string;
  isDefault: boolean;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openIdb(appName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(appName, 1);
    req.onupgradeneeded = () =>
      req.result.createObjectStore(IDB_STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ─── IndexedDbAuthStore ───────────────────────────────────────────────────────

export class IndexedDbAuthStore {
  /** Returns the entry with `isDefault: true`, or `undefined`. */
  static async getDefault(appName: string): Promise<MXDBAuthEntry | undefined> {
    if (!isIndexedDbAvailable()) return undefined;
    const db = await openIdb(appName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => { db.close(); resolve((req.result as MXDBAuthEntry[]).find(e => e.isDefault)); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  /** Returns all entries (for user-switching UI). */
  static async getAll(appName: string): Promise<MXDBAuthEntry[]> {
    if (!isIndexedDbAvailable()) return [];
    const db = await openIdb(appName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).getAll();
      req.onsuccess = () => { db.close(); resolve(req.result as MXDBAuthEntry[]); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  /**
   * Saves a new entry as the default, clearing `isDefault` on all others.
   * Generates a random `id` if not supplied.
   */
  static async save(appName: string, entry: MXDBAuthEntry): Promise<void> {
    if (!isIndexedDbAvailable()) return;
    const db = await openIdb(appName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        for (const existing of getAllReq.result as MXDBAuthEntry[]) {
          if (existing.isDefault) store.put({ ...existing, isDefault: false });
        }
        store.put({ ...entry, isDefault: true });
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  /** Updates the token on the default entry. */
  static async updateDefaultToken(appName: string, token: string): Promise<void> {
    if (!isIndexedDbAvailable()) return;
    const db = await openIdb(appName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        const defaultEntry = (getAllReq.result as MXDBAuthEntry[]).find(e => e.isDefault);
        if (defaultEntry != null) store.put({ ...defaultEntry, token });
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  /** Clears `isDefault` on all entries (sign-out). */
  static async clearAllDefaults(appName: string): Promise<void> {
    if (!isIndexedDbAvailable()) return;
    const db = await openIdb(appName);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const getAllReq = store.getAll();
      getAllReq.onsuccess = () => {
        for (const entry of getAllReq.result as MXDBAuthEntry[]) {
          if (entry.isDefault) store.put({ ...entry, isDefault: false });
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }
}
