import type { UseCollection } from './models';

export function createSeed(onSeed: (useCollection: UseCollection) => Promise<void>) {
  return onSeed;
}
