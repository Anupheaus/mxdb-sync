import type { AnyFunction, Logger } from '@anupheaus/common';
import { LoggerContext } from './loggerContext';

export function provideLogger<T extends AnyFunction>(logger: Logger, handler: T) {
  return ((...args) => LoggerContext.run(logger, () => handler(...args))) as T;
}
