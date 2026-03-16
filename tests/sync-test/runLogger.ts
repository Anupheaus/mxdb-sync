import * as fs from 'fs';
import * as path from 'path';
import type { RunLogEvent, RunLogDetail } from './types';

const LOGS_DIR = path.join(__dirname, 'logs');

export interface RunLogger {
  log(event: RunLogEvent, detail?: RunLogDetail): void;
  close(): void;
}

/**
 * Create a single log file for this test run. Filename includes run timestamp.
 * Each line: nanosecond timestamp (hrtime.bigint), ISO wall-clock, event name, JSON detail.
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
    const line = `${tsNano}\t${tsIso}\t${event}\t${JSON.stringify(detail ?? {})}\n`;
    stream.write(line);
  }

  function close() {
    stream.end();
  }

  return { log, close };
}
