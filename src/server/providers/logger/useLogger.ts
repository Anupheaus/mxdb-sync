import { LoggerContext } from './loggerContext';
import { getGlobalLogger } from './setupLogger';

export function useLogger() {
  return LoggerContext.getStore() ?? getGlobalLogger();
}
