import { AsyncLocalStorage } from 'async_hooks';
import type { UseClient } from './socketModels';

export const ClientAsyncStore = new AsyncLocalStorage<UseClient>();

export function provideClient<T>(client: UseClient, fn: () => T): T {
  return ClientAsyncStore.run(client, fn);
}
