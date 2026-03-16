/**
 * Vitest setup for sync-test. Must run before any client code.
 * - fake-indexeddb: provides global.indexedDB for Db/DbCollection.
 * - JSDOM: provides global.window/document so client and react-ui imports (which reference window) succeed.
 * Server is started in beforeAll after temporarily deleting window so Logger does not treat the process as browser.
 */
import 'fake-indexeddb/auto';
import '@anupheaus/common';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost',
});

(dom.window as unknown as { indexedDB: IDBFactory }).indexedDB = (global as unknown as { indexedDB: IDBFactory }).indexedDB;

(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: Document }).document = dom.window.document;

// Ensure URL.createObjectURL exists for Worker/blob shims used by DbCollection utils.
const urlGlobal = (dom.window as unknown as { URL?: typeof URL }).URL ?? URL;
const createObjectURLShim = (...args: any[]) => {
  // We don't care about the actual blob URL in tests; it just needs to be a string.
  return typeof (urlGlobal as any).createObjectURL === 'function'
    ? (urlGlobal as any).createObjectURL(...args)
    : 'blob:mxdb-sync-test';
};
(global as unknown as { URL: any }).URL = {
  ...urlGlobal,
  createObjectURL: createObjectURLShim,
};

// Many client modules assume `self` exists (browser/worker global). Point it at the window.
(global as unknown as { self: unknown }).self = dom.window as unknown;

// Minimal Worker shim for tests (client DB layer uses a web worker for IndexedDB writes).
// We execute the requested IDB operations on the main thread (fake-indexeddb) instead.
type WorkerMessageHandler = (event: { data: any }) => void;
class TestWorker {
  #onMessage: WorkerMessageHandler | null = null;

  // Worker API used by app code
  public postMessage(payload: any) {
    void this.#handle(payload);
  }

  public addEventListener(type: string, handler: WorkerMessageHandler) {
    if (type === 'message') this.#onMessage = handler;
  }

  public removeEventListener() { /* no-op */ }
  public terminate() { /* no-op */ }

  async #handle(payload: any) {
    // If app code ever wires a worker-side handler, call it; otherwise perform IDB ops directly.
    if (this.#onMessage) {
      this.#onMessage({ data: payload });
      return;
    }
    const { dbName, collectionName, action, records, ids } = payload ?? {};
    const indexedDB = (dom.window as any).indexedDB as IDBFactory | undefined;
    if (!indexedDB) return;

    const wrap = <T = unknown>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    const db = await wrap(indexedDB.open(dbName));
    const tx = db.transaction(collectionName, 'readwrite');
    const store = tx.objectStore(collectionName);

    const wrapTx = () => new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });

    if (action === 'upsert' && Array.isArray(records)) {
      for (const r of records) store.put(r);
    } else if (action === 'delete' && Array.isArray(ids)) {
      for (const id of ids) store.delete(id);
    } else if (action === 'clear') {
      store.clear();
    }

    await wrapTx();
  }
}

(global as unknown as { Worker: unknown }).Worker = TestWorker as unknown;
