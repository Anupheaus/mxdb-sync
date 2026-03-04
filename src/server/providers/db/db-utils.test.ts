import { describe, it, expect } from 'vitest';
import { dbUtils } from './db-utils';
import type { Record } from '@anupheaus/common';

describe('dbUtils', () => {
  describe('serialize', () => {
    it('replaces id with _id for MongoDB', () => {
      const record = { id: 'abc-123', name: 'foo' };
      const serialized = dbUtils.serialize(record as Record);
      expect(serialized).toHaveProperty('_id', 'abc-123');
      expect(serialized).not.toHaveProperty('id');
      expect(serialized).toHaveProperty('name', 'foo');
    });

    it('preserves other fields', () => {
      const record = { id: '1', a: 1, b: 'two', c: true };
      const serialized = dbUtils.serialize(record as Record);
      expect(serialized._id).toBe('1');
      expect(serialized.a).toBe(1);
      expect(serialized.b).toBe('two');
      expect(serialized.c).toBe(true);
    });
  });

  describe('deserialize', () => {
    it('replaces _id with id', () => {
      const doc = { _id: 'xyz', name: 'bar' };
      const deserialized = dbUtils.deserialize(doc);
      expect(deserialized).toHaveProperty('id', 'xyz');
      expect(deserialized).not.toHaveProperty('_id');
      expect(deserialized).toHaveProperty('name', 'bar');
    });

    it('returns undefined for null/undefined', () => {
      expect(dbUtils.deserialize(undefined)).toBeUndefined();
      expect(dbUtils.deserialize(null as any)).toBeUndefined();
    });

    it('round-trips with serialize', () => {
      const record = { id: 'round-trip', value: 42 };
      const serialized = dbUtils.serialize(record as Record);
      const deserialized = dbUtils.deserialize(serialized);
      expect(deserialized).toEqual(record);
    });
  });
});
