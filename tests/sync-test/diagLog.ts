/**
 * Synchronous file-based diagnostic logger for sync integration tests.
 *
 * Both the vitest process (client) and the server child process write directly
 * to the same file with appendFileSync, so no IPC buffering or React hook
 * machinery sits in between.
 *
 * Enabled when the environment variable MXDB_DIAG_FILE is set to a file path.
 * When disabled every call is a no-op, so it is safe to leave in production code.
 */
import { appendFileSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { dirname } from 'path';

const FILE = process.env.MXDB_DIAG_FILE ?? '';
const ENABLED = FILE.length > 0;
const PID = process.pid;

if (ENABLED) {
  try {
    mkdirSync(dirname(FILE), { recursive: true });
    writeFileSync(FILE, '', { flag: 'a' }); // touch / create
  } catch { /* ignore */ }
}

export function diagLog(source: string, message: string, data?: Record<string, unknown>): void {
  if (!ENABLED) return;
  const ts = process.hrtime.bigint().toString();
  const iso = new Date().toISOString();
  const line = `${ts}\t${iso}\t[pid:${PID}]\t${source}\t${message}\t${data ? JSON.stringify(data) : ''}\n`;
  try {
    appendFileSync(FILE, line);
  } catch { /* ignore */ }
}

/**
 * Read back all diag log lines (useful at end of test to parse results).
 */
export function readDiagLog(): Array<{ ts: bigint; iso: string; pid: string; source: string; message: string; data: Record<string, unknown> }> {
  if (!ENABLED || !existsSync(FILE)) return [];
  const raw = require('fs').readFileSync(FILE, 'utf8') as string;
  return raw.split('\n').filter(l => l.trim()).map(l => {
    const parts = l.split('\t');
    return {
      ts: BigInt(parts[0] ?? '0'),
      iso: parts[1] ?? '',
      pid: parts[2] ?? '',
      source: parts[3] ?? '',
      message: parts[4] ?? '',
      data: parts[5] ? JSON.parse(parts[5]) : {},
    };
  });
}
