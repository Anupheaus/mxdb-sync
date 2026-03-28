import { describe, it, expect, beforeEach } from 'vitest';
import { defineCollection } from './defineCollection';
import { configRegistry } from './registries';
import type { MXDBCollectionConfig } from './models';
import type { Record } from '@anupheaus/common';

describe('defineCollection', () => {
  interface TestRecord extends Record {
    id: string;
    name: string;
  }

  const baseConfig: MXDBCollectionConfig<TestRecord> = {
    name: 'test-collection',
    indexes: [{ name: 'by_name', fields: ['name'] }],
  };

  beforeEach(() => {
    // Config is stored in WeakMap keyed by collection object; each test gets a fresh collection
    // so we don't need to clear the registry.
  });

  it('returns a collection object with name and type', () => {
    const collection = defineCollection<TestRecord>(baseConfig);
    expect(collection).toBeDefined();
    expect(collection.name).toBe('test-collection');
    expect(collection.type).toBeNull();
  });

  it('registers config so configRegistry.get returns it', () => {
    const collection = defineCollection<TestRecord>(baseConfig);
    const config = configRegistry.get(collection);
    expect(config).toBeDefined();
    expect(config!.name).toBe(baseConfig.name);
    expect(config!.indexes).toEqual(baseConfig.indexes);
  });

  it('allows syncMode and disableAudit in config', () => {
    const collection = defineCollection<TestRecord>({
      ...baseConfig,
      name: 'no-client',
      syncMode: 'ServerOnly',
      disableAudit: true,
    });
    const config = configRegistry.get(collection);
    expect(config!.syncMode).toBe('ServerOnly');
    expect(config!.disableAudit).toBe(true);
  });
});
