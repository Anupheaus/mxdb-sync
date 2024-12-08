import { Logger } from '@anupheaus/common';
import type { LoggerContextProps } from './loggerContext';
import { Context } from '../../contexts';

export function setupLogger(logger?: Logger): void {
  if (logger == null) logger = new Logger('MXDB_Sync');
  Context.set<LoggerContextProps>('logger', { logger });
}
