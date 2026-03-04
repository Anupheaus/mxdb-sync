import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { serialise, deserialise } from './transforms';
import type { Record } from '@anupheaus/common';

describe('transforms', () => {
  describe('serialise', () => {
    it('converts DateTime to ISO string', () => {
      const dt = DateTime.utc(2024, 6, 15, 12, 0, 0);
      const record = { id: '1', createdAt: dt };
      const out = serialise(record as Record);
      expect(out.createdAt).toBe(dt.toISO());
      expect(typeof out.createdAt).toBe('string');
    });

    it('converts Date to ISO string', () => {
      const d = new Date('2024-01-01T00:00:00.000Z');
      const record = { id: '1', at: d };
      const out = serialise(record as Record);
      expect(out.at).toBe(d.toISOString());
    });

    it('clones and leaves other values unchanged', () => {
      const record = { id: '1', n: 1, s: 'hi' };
      const out = serialise(record as Record);
      expect(out.id).toBe('1');
      expect(out.n).toBe(1);
      expect(out.s).toBe('hi');
    });
  });

  describe('deserialise', () => {
    it('converts ISO date strings to DateTime', () => {
      const iso = '2024-06-15T12:00:00.000Z';
      const record = { id: '1', createdAt: iso };
      const out = deserialise(record as Record);
      expect(DateTime.isDateTime(out.createdAt)).toBe(true);
      expect((out.createdAt as DateTime).toUTC().toISO()).toBe(iso);
    });

    it('leaves non-date strings unchanged', () => {
      const record = { id: '1', name: 'hello' };
      const out = deserialise(record as Record);
      expect(out.name).toBe('hello');
    });

    it('round-trips DateTime with serialise', () => {
      const dt = DateTime.utc(2024, 1, 1);
      const record = { id: '1', at: dt };
      const ser = serialise(record as Record);
      const des = deserialise(ser as Record);
      expect(DateTime.isDateTime(des.at)).toBe(true);
      expect((des.at as DateTime).toMillis()).toBe(dt.toMillis());
    });
  });
});
