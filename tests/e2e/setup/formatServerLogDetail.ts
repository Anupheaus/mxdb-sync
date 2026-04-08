import type { RunLogDetail } from './types';

/** Strip common ANSI SGR sequences so raw stdout lines are readable in the log file. */
function stripAnsi(s: string): string {
  return s
    .replace(/\u001b\[[\d;]*m/gu, '')
    .replace(/\u001b\]8;;[^\u0007]*\u0007/gu, '');
}

/**
 * Turn a single server child stdout/stderr line into a compact `RunLogDetail` for `server_log` events.
 * Structured lines (`type: "server-log"`): level, tsNano, message, optional logger/args (no stream).
 * Lifecycle: kind + event + detail; raw: kind + text. Noise-only lines return null (skip).
 */
export function formatServerLogDetail(_stream: 'stdout' | 'stderr', line: string): RunLogDetail | null {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return null;

  try {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;

    if (obj.type === 'server-log' && typeof obj.message === 'string') {
      const detail: RunLogDetail = {
        level: typeof obj.level === 'string' ? obj.level : String(obj.level ?? ''),
        tsNano: typeof obj.tsNano === 'string' || typeof obj.tsNano === 'number' ? String(obj.tsNano) : '',
        message: obj.message,
      };
      if (typeof obj.logger === 'string' && obj.logger.length > 0) {
        detail.logger = obj.logger;
      }
      if (Array.isArray(obj.args) && obj.args.length > 0) {
        detail.args = obj.args;
      }
      return detail;
    }

    if (obj.type === 'lifecycle') {
      const detail: RunLogDetail = {
        kind: 'lifecycle',
        event: typeof obj.event === 'string' ? obj.event : String(obj.event ?? ''),
      };
      if (obj.detail != null && typeof obj.detail === 'object') {
        detail.detail = obj.detail as Record<string, unknown>;
      }
      if (typeof obj.ts === 'string') detail.ts = obj.ts;
      return detail;
    }
  } catch {
    // not JSON
  }

  const text = stripAnsi(trimmed).trim();
  if (text.length === 0) return null;

  return { kind: 'raw', text };
}

const oneLine = (s: string): string => s.replace(/\s+/gu, ' ').replace(/\t/gu, ' ').trim();

/**
 * One physical line for log files: easy to scan, no stream field.
 */
export function condenseServerLogDetail(d: RunLogDetail): string {
  if (d.kind === 'lifecycle') {
    const ev = String(d.event ?? '');
    const det = d.detail != null ? JSON.stringify(d.detail) : '';
    const ts = typeof d.ts === 'string' ? ` @${d.ts}` : '';
    return oneLine(det ? `lifecycle ${ev} ${det}${ts}` : `lifecycle ${ev}${ts}`);
  }
  if (d.kind === 'raw') {
    return oneLine(`raw ${String(d.text ?? '')}`);
  }
  const level = String(d.level ?? '');
  const tsN = String(d.tsNano ?? '');
  const msg = oneLine(String(d.message ?? ''));
  let s = `[${level}] ${tsN}  ${msg}`;
  if (typeof d.logger === 'string' && d.logger.length > 0) {
    s += `  | ${d.logger}`;
  }
  if (Array.isArray(d.args) && d.args.length > 0) {
    s += `  | ${JSON.stringify(d.args)}`;
  }
  return oneLine(s);
}
