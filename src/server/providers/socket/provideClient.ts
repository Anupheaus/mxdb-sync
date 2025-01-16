import { AsyncLocalStorage } from 'async_hooks';
import type { UseClient } from './socketModels';
import type { AnyFunction } from '@anupheaus/common';

export const ClientAsyncStore = new AsyncLocalStorage<UseClient>();

export function provideClient<T extends AnyFunction>(client: UseClient, handler: T) {
  return ((...args) => ClientAsyncStore.run(client, () => handler(...args))) as T;
}
