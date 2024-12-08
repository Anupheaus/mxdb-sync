import { Context } from '../../contexts';
import { createRequestLogger } from './createRequestLogger';
import { LoggerContextProps } from './loggerContext';

export function useLogger() {
  const { logger } = Context.get<LoggerContextProps>('logger');
  let requestLogging: ReturnType<typeof createRequestLogger> | undefined;

  return {
    logger,
    get requestLogging() { return requestLogging = requestLogging ?? createRequestLogger(logger); },
  };
}
