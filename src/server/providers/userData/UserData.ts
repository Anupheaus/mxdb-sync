import { AsyncLocalStorage } from 'async_hooks';

export const UserData = new AsyncLocalStorage<Map<string, any>>();
