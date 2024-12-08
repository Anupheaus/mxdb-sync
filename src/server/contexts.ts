import { InternalError } from '@anupheaus/common';

const contextMap = new Map<string, unknown>();

export const Context = {
  get<T>(name: string): T {
    if (!contextMap.has(name)) throw new InternalError(`${name} context not found.`);
    return contextMap.get(name)! as T;
  },
  set<T>(name: string, value: T): void {
    contextMap.set(name, value);
  },
};
