/**
 * Must load before other e2e code and before `vitestGlobals.ts` so Vitest hoists `vi.mock`
 * before `@anupheaus/common` is resolved for client imports.
 */
import { vi } from 'vitest';

vi.mock('@anupheaus/common', async importOriginal => {
  const { getE2eRunLogger } = await import('./e2eRunLoggerSink');
  const actual = (await importOriginal()) as Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- avoid `import()` type in cast
  const RealLogger = actual.Logger as typeof import('@anupheaus/common').Logger;

  class E2eVitestLogger extends RealLogger {
    public override createSubLogger(name: string, settings?: unknown): InstanceType<typeof RealLogger> {
      const subLogger = new E2eVitestLogger(name, settings as ConstructorParameters<typeof RealLogger>[1]);
      (subLogger as unknown as { parent: InstanceType<typeof RealLogger> | undefined; }).parent = this;
      return subLogger;
    }

    protected override report(
      level: number,
      message: string,
      meta?: Record<string, unknown>,
      _ignoreLevel = false,
    ): void {
      const lr = getE2eRunLogger();
      if (lr != null) {
        const loggerPath = this.allNames.join(' > ');
        lr.log('app_logger', {
          level: RealLogger.getLevelAsString(level),
          message,
          ...(loggerPath.length > 0 ? { logger: loggerPath } : {}),
          ...(meta != null && typeof meta === 'object' && Object.keys(meta).length > 0 ? { meta } : {}),
        });
      }
      super.report(level, message, meta, true);
    }
  }

  return {
    ...actual,
    Logger: E2eVitestLogger,
  };
});

vi.mock('../../../src/client/utils/actionTimeout', async importOriginal => {
  const actual = await importOriginal<typeof import('../../../src/client/utils/actionTimeout')>();
  return {
    ...actual,
    ACTION_TIMEOUT_MS: 45_000,
  };
});
