import { Logger } from '@anupheaus/common';

let globalLogger = new Logger('MXDB_Sync');

export function setupLogger(logger?: Logger): void {
  if (logger != null) globalLogger = logger;
}

export const getGlobalLogger = () => globalLogger;
