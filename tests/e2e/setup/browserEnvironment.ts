/**
 * Browser-like globals for Node e2e tests (fake IndexedDB + JSDOM + `self`).
 * Call once before any client code; safe to call multiple times (no-op after first install).
 */
import 'fake-indexeddb/auto';
import path from 'path';
import { JSDOM } from 'jsdom';

declare global {
  // eslint-disable-next-line no-var -- test global gate
  var __mxdbE2eBrowserInstalled: boolean | undefined;
}

export function installBrowserEnvironment(): void {
  if (globalThis.__mxdbE2eBrowserInstalled) return;

  const diagFile = path.resolve(__dirname, `../../sync-test/logs/diag-e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
  if (!process.env.MXDB_DIAG_FILE) process.env.MXDB_DIAG_FILE = diagFile;

  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    url: 'https://localhost',
  });

  (dom.window as unknown as { indexedDB: IDBFactory }).indexedDB = (globalThis as unknown as { indexedDB: IDBFactory }).indexedDB;

  (globalThis as unknown as { window: unknown }).window = dom.window;
  (globalThis as unknown as { document: Document }).document = dom.window.document;

  const urlGlobal = (dom.window as unknown as { URL?: typeof URL }).URL ?? URL;
  if (typeof (urlGlobal as { createObjectURL?: unknown }).createObjectURL !== 'function') {
    (urlGlobal as { createObjectURL: () => string }).createObjectURL = () => 'blob:mxdb-e2e-test';
  }
  (globalThis as unknown as { URL: unknown }).URL = urlGlobal;
  (globalThis as unknown as { self: unknown }).self = dom.window as unknown;

  globalThis.__mxdbE2eBrowserInstalled = true;
}
