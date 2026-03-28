import * as fs from 'fs';
import * as path from 'path';
import { condenseAppLoggerDetail, type AppLoggerRunLogDetail } from './appLoggerRunLogBridge';
import { condenseServerLogDetail } from './formatServerLogDetail';
import type { RunLogEvent, RunLogDetail } from './types';

const LOGS_DIR = path.join(__dirname, 'logs');

export interface RunLogger {
  log(event: RunLogEvent, detail?: RunLogDetail): void;
  close(): void;
}

/**
 * Create a single log file for this test run. Filename includes run timestamp.
 * Each line: nanosecond timestamp (hrtime.bigint), ISO wall-clock, event name, detail.
 * `server_log` / `app_logger` use a single condensed text column.
 */
export function createRunLogger(): RunLogger {
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  const iso = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `sync-test-${iso}.log`;
  const filepath = path.join(LOGS_DIR, filename);
  const stream = fs.createWriteStream(filepath, { flags: 'a' });

  function log(event: RunLogEvent, detail?: RunLogDetail) {
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
    const line = `${tsNano}\t${tsIso}\t${event}\t${JSON.stringify(detail ?? {})}\n`;
    stream.write(line);
  }

  function close() {
    stream.end();
  }

  return { log, close };
}
