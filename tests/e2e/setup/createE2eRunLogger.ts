import * as fs from 'fs';
import * as path from 'path';
import { condenseAppLoggerDetail, type AppLoggerRunLogDetail } from '../../sync-test/appLoggerRunLogBridge';
import { condenseServerLogDetail } from '../../sync-test/formatServerLogDetail';
import type { RunLogEvent, RunLogDetail } from '../../sync-test/types';
import type { RunLogger } from '../../sync-test/runLogger';

const LOGS_DIR = path.join(__dirname, '..', 'logs');

/**
 * One file per Vitest run: `tests/e2e/logs/e2e-{iso}.log` (same line format as sync-test run logs).
 */
function pruneOldLogs(keep: number): void {
  if (!fs.existsSync(LOGS_DIR)) return;
  const files = fs.readdirSync(LOGS_DIR)
    .filter(f => f.startsWith('e2e-') && f.endsWith('.log'))
    .sort();
  const toRemove = files.slice(0, -keep);
  for (const file of toRemove) {
    fs.unlinkSync(path.join(LOGS_DIR, file));
  }
}

export function createE2eRunLogger(): RunLogger {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  pruneOldLogs(10);
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `e2e-${iso}.log`;
  const filepath = path.join(LOGS_DIR, filename);
  const stream = fs.createWriteStream(filepath, { flags: 'a' });

  function log(event: RunLogEvent, detail?: RunLogDetail): void {
    const tsNano = process.hrtime.bigint();
    const tsIso = new Date().toISOString();
    if (event === 'server_log' && detail != null) {
      const condensed = condenseServerLogDetail(detail);
      stream.write(`${tsNano}\t${tsIso}\t${event}\t${condensed}\n`);
      return;
    }
    if (event === 'app_logger' && detail != null) {
      const condensed = condenseAppLoggerDetail(detail as AppLoggerRunLogDetail);
      stream.write(`${tsNano}\t${tsIso}\t${event}\t${condensed}\n`);
      return;
    }
    stream.write(`${tsNano}\t${tsIso}\t${event}\t${JSON.stringify(detail ?? {})}\n`);
  }

  function close(): void {
    stream.end();
  }

  return { log, close };
}
