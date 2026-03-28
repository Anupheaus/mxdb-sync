/**
 * Vitest setup for sync-test. Must run before any client code.
 * - fake-indexeddb: provides global.indexedDB for Db/DbCollection.
 * - JSDOM: provides global.window/document so client and react-ui imports (which reference window) succeed.
 * Server is started in beforeAll after temporarily deleting window so Logger does not treat the process as browser.
 */
import 'fake-indexeddb/auto';
// Do not `import '@anupheaus/common'` here — it loads the real `Logger` into Vite’s cache before
// `vi.mock('@anupheaus/common')` in the integration test can apply. Prototype extensions load when the
// mocked module’s `importOriginal()` runs on first test import.
import path from 'path';

// Set up a per-run diagnostic log file shared between vitest process and server child process.
// Both processes write directly via appendFileSync — no IPC buffering.
// Disabled automatically in non-test runs (file path not set).
const diagFile = path.resolve(__dirname, `logs/diag-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
process.env.MXDB_DIAG_FILE = diagFile;
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'https://localhost',
});

(dom.window as unknown as { indexedDB: IDBFactory }).indexedDB = (global as unknown as { indexedDB: IDBFactory }).indexedDB;

(global as unknown as { window: unknown }).window = dom.window;
(global as unknown as { document: Document }).document = dom.window.document;

// Ensure URL.createObjectURL exists (needed by some client code). Preserve URL as a
// constructor by patching only the missing static method rather than replacing it.
const urlGlobal = (dom.window as unknown as { URL?: typeof URL }).URL ?? URL;
if (typeof (urlGlobal as any).createObjectURL !== 'function') {
  (urlGlobal as any).createObjectURL = () => 'blob:mxdb-sync-test';
}
(global as unknown as { URL: unknown }).URL = urlGlobal;

// Many client modules assume `self` exists (browser/worker global). Point it at the window.
(global as unknown as { self: unknown }).self = dom.window as unknown;

// SqliteWorkerClient detects Worker availability at construction time.
// In Node.js/test environments Worker is not a global, so SqliteWorkerClient
// automatically uses its inline SQLite runner (no worker required).
