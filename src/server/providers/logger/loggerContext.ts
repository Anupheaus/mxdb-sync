import type { Logger } from '@anupheaus/common';
import { AsyncLocalStorage } from 'async_hooks';

export const LoggerContext = new AsyncLocalStorage<Logger>();
