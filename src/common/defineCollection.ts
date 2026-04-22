import type { Record } from '@anupheaus/common';
import type { MXDBCollection, MXDBCollectionConfig } from './models';
import { configRegistry } from './registries';

/**
 * Defines a shared collection that both client and server can use.
 *
 * Must be called before `startServer()` / `<MXDBSync>` mount — the returned token is
 * registered in a module-level registry read by both sides at startup.
 *
 * @param config - Collection config: `name` (must match on client and server), `indexes`,
 *   `syncMode` (`'Synchronised'` | `'ServerOnly'` | `'ClientOnly'`), `disableAudit`.
 * @returns An `MXDBCollection` token — pass it to `useCollection`, `extendCollection`, etc.
 */
export function defineCollection<RecordType extends Record>(config: MXDBCollectionConfig<RecordType>): MXDBCollection<RecordType> {
  const collection: MXDBCollection<RecordType> = {
    name: config.name,
    type: null as unknown as RecordType,
  };
  configRegistry.add(collection, config);
  return collection;
}
