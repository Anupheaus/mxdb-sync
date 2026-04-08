import { describe, it, expect } from 'vitest';
import { sortsToSql } from './sortsToSql';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function col(field: string) {
  return `json_extract(data, '$.${field}')`;
}

// ─── No sorts ─────────────────────────────────────────────────────────────────

describe('sortsToSql — empty / null', () => {
  it('returns empty string for undefined', () => {
    expect(sortsToSql(undefined)).toBe('');
  });

  it('returns empty string for empty array', () => {
    expect(sortsToSql([] as any)).toBe('');
  });
});

// ─── Single field ─────────────────────────────────────────────────────────────

describe('sortsToSql — single field', () => {
  it('produces ASC clause for ascending sort', () => {
    const result = sortsToSql([['name', 'asc']] as any);
    expect(result).toBe(`${col('name')} ASC`);
  });

  it('produces DESC clause for descending sort', () => {
    const result = sortsToSql([['createdAt', 'desc']] as any);
    expect(result).toBe(`${col('createdAt')} DESC`);
  });

  it('defaults to ASC for any non-desc direction value', () => {
    // Any value that is not 'desc' should produce ASC
    const result = sortsToSql([['score', 'asc']] as any);
    expect(result).toContain('ASC');
    expect(result).not.toContain('DESC');
  });
});

// ─── Multiple fields ──────────────────────────────────────────────────────────

describe('sortsToSql — multiple fields', () => {
  it('produces comma-separated clauses for two fields', () => {
    const result = sortsToSql([['lastName', 'asc'], ['firstName', 'asc']] as any);
    expect(result).toContain(`${col('lastName')} ASC`);
    expect(result).toContain(`${col('firstName')} ASC`);
    expect(result).toContain(', ');
  });

  it('respects mixed directions in multi-sort', () => {
    const result = sortsToSql([['priority', 'desc'], ['createdAt', 'asc']] as any);
    expect(result).toContain(`${col('priority')} DESC`);
    expect(result).toContain(`${col('createdAt')} ASC`);
  });

  it('preserves order of fields in output', () => {
    const result = sortsToSql([['a', 'asc'], ['b', 'asc'], ['c', 'desc']] as any);
    const aIdx = result.indexOf(col('a'));
    const bIdx = result.indexOf(col('b'));
    const cIdx = result.indexOf(col('c'));
    expect(aIdx).toBeLessThan(bIdx);
    expect(bIdx).toBeLessThan(cIdx);
  });
});

// ─── Nested field paths ───────────────────────────────────────────────────────

describe('sortsToSql — nested field paths', () => {
  it('passes nested path directly to json_extract', () => {
    const result = sortsToSql([['address.city', 'asc']] as any);
    expect(result).toContain('json_extract(data, \'$.address.city\')');
  });
});

// ─── Output format ────────────────────────────────────────────────────────────

describe('sortsToSql — output format', () => {
  it('does not include ORDER BY keyword (caller adds it)', () => {
    const result = sortsToSql([['name', 'asc']] as any);
    expect(result.toUpperCase()).not.toContain('ORDER BY');
  });

  it('does not produce trailing or leading whitespace', () => {
    const result = sortsToSql([['name', 'desc']] as any);
    expect(result).toBe(result.trim());
  });

  it('uses json_extract for all fields', () => {
    const result = sortsToSql([['status', 'asc']] as any);
    expect(result).toContain('json_extract(data, \'$.');
  });
});
