import { describe, it, expect, beforeEach } from 'vitest';
import { configRegistry } from './registries';
import { defineCollection } from './defineCollection';
import type { MXDBCollectionConfig, MXDBCollection } from './models';
import type { Record } from '@anupheaus/common';

describe('configRegistry', () => {
  interface TestRecord extends Record {
    id: string;
  }

  let collection: MXDBCollection<TestRecord>;

  beforeEach(() => {
    collection = defineCollection<TestRecord>({
      name: 'registry-test',
      version: 1,
      indexes: [],
    });
  });

  it('get returns config for registered collection', () => {
    const config = configRegistry.get(collection);
    expect(config).toBeDefined();
    expect(config!.name).toBe('registry-test');
  });

  it('get returns undefined for unregistered collection', () => {
    const unregistered = { name: 'other', type: null } as MXDBCollection<TestRecord>;
    expect(configRegistry.get(unregistered)).toBeUndefined();
  });

  it('getOrError returns config for registered collection', () => {
    const config = configRegistry.getOrError(collection);
    expect(config.name).toBe('registry-test');
  });

  it('getOrError throws for unregistered collection', () => {
    const unregistered = { name: 'other', type: null } as MXDBCollection<TestRecord>;
    expect(() => configRegistry.getOrError(unregistered)).toThrow(/Configuration for collection "other" could not be found/);
  });
});
