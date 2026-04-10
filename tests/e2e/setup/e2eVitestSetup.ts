/**
 * Must load before other e2e code and before `vitestGlobals.ts` so Vitest hoists `vi.mock`
 * before `@anupheaus/common` is resolved for client imports.
 */
import { vi } from 'vitest';

vi.mock('@anupheaus/common', async importOriginal => {
  const { getE2eRunLogger } = await import('./runLogger');
  const actual = (await importOriginal()) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- avoid `import()` type in cast
  const RealLogger = actual.Logger as typeof import('@anupheaus/common').Logger;

  // Force all Logger instances in this process to log at silly level (0) regardless of env vars.
  Object.defineProperty(RealLogger.prototype, 'getMinLevel', {
    value: () => 0,
    writable: true,
    configurable: true,
  });

  RealLogger.registerListener({
    maxEntries: 1,
    onTrigger(entries) {
      const lr = getE2eRunLogger();
      if (lr == null) return;
      for (const entry of entries) {
        const loggerPath = entry.names.join(' > ');
        lr.log('app_logger', {
          level: RealLogger.getLevelAsString(entry.level),
          message: entry.message,
          ...(loggerPath.length > 0 ? { logger: loggerPath } : {}),
          ...(entry.meta != null && typeof entry.meta === 'object' && Object.keys(entry.meta).length > 0 ? { meta: entry.meta } : {}),
        });
      }
    },
  });

  return actual;
});

vi.mock('../../../src/client/utils/actionTimeout', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/client/utils/actionTimeout')>();
  return {
    ...actual,
    ACTION_TIMEOUT_MS: 20_000,
  };
});
