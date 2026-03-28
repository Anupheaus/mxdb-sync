/**
 * Condensed single-line formatting for `app_logger` rows (data comes from {@link ./loggerViMock.ts}).
 */
export interface AppLoggerRunLogDetail {
  level?: string;
  logger?: string;
  message?: string;
  meta?: unknown;
}

function oneLine(s: string): string {
  return s.replace(/\s+/gu, ' ').replace(/\t/gu, ' ').trim();
}

function safeStringifyMeta(meta: unknown): string | undefined {
  if (meta == null || typeof meta !== 'object') return undefined;
  const keys = Object.keys(meta as object);
  if (keys.length === 0) return undefined;
  try {
    return JSON.stringify(meta);
  } catch {
    return '[unserializable meta]';
  }
}

/** `[level] logger?  message  | meta` — type, message, extras only. */
export function condenseAppLoggerDetail(detail: AppLoggerRunLogDetail): string {
  const level = String(detail.level ?? '');
  const logger = detail.logger != null && detail.logger.length > 0 ? `${detail.logger}  ` : '';
  const msg = oneLine(String(detail.message ?? ''));
  let s = `[${level}] ${logger}${msg}`;
  const metaStr = safeStringifyMeta(detail.meta);
  if (metaStr != null) s += `  | ${metaStr}`;
  return oneLine(s);
}
