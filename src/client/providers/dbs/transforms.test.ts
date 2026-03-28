import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { serialise, deserialise } from './transforms';
import type { Record } from '@anupheaus/common';

interface RowCreatedAt extends Record {
  id: string;
  createdAt: DateTime;
}

interface RowAtDate extends Record {
  id: string;
  at: Date;
}

interface RowScalars extends Record {
  id: string;
  n: number;
  s: string;
}

interface RowIso extends Record {
  id: string;
  createdAt: string;
}

interface RowName extends Record {
  id: string;
  name: string;
}

interface RowAtLuxon extends Record {
  id: string;
  at: DateTime;
}

describe('transforms', () => {
  describe('serialise', () => {
    it('converts DateTime to ISO string', () => {
      const dt = DateTime.utc(2024, 6, 15, 12, 0, 0);
      const record: RowCreatedAt = { id: '1', createdAt: dt };
      expect(serialise(record)).toEqual({ id: '1', createdAt: dt.toISO() });
    });

    it('converts Date to ISO string', () => {
      const d = new Date('2024-01-01T00:00:00.000Z');
      const record: RowAtDate = { id: '1', at: d };
      expect(serialise(record)).toEqual({ id: '1', at: d.toISOString() });
    });

    it('clones and leaves other values unchanged', () => {
      const record: RowScalars = { id: '1', n: 1, s: 'hi' };
      expect(serialise(record)).toEqual(record);
    });
  });

  describe('deserialise', () => {
    it('converts ISO date strings to DateTime', () => {
      const iso = '2024-06-15T12:00:00.000Z';
      const record: RowIso = { id: '1', createdAt: iso };
      const out = deserialise(record);
      expect(DateTime.isDateTime(out.createdAt)).toBe(true);
      if (DateTime.isDateTime(out.createdAt)) {
        expect(out.createdAt.toUTC().toISO()).toBe(iso);
      }
    });

    it('leaves non-date strings unchanged', () => {
      const record: RowName = { id: '1', name: 'hello' };
      expect(deserialise(record)).toEqual(record);
    });

    it('round-trips DateTime with serialise', () => {
      const dt = DateTime.utc(2024, 1, 1);
      const record: RowAtLuxon = { id: '1', at: dt };
      const ser = serialise(record);
      const des = deserialise(ser);
      expect(DateTime.isDateTime(des.at)).toBe(true);
      if (DateTime.isDateTime(des.at)) {
        expect(des.at.toMillis()).toBe(dt.toMillis());
      }
    });
  });
});
