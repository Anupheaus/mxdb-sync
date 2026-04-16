import { describe, it, expect } from 'vitest';
import { recordDiff, diffAny } from './diff';
import { OperationType } from './auditor-models';
import type { Record as MXDBRecord } from '@anupheaus/common';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type TestRecord = MXDBRecord & Record<string, unknown>;

function rec(fields: Record<string, unknown>): TestRecord {
  return { id: 'r1', ...fields } as TestRecord;
}

// ─── No changes ───────────────────────────────────────────────────────────────

describe('recordDiff — no changes', () => {
  it('returns empty array for identical primitive records', () => {
    const r = rec({ name: 'alice', age: 30 });
    expect(recordDiff(r, r)).toEqual([]);
  });

  it('returns empty array for structurally equal records', () => {
    const a = rec({ name: 'alice', age: 30 });
    const b = rec({ name: 'alice', age: 30 });
    expect(recordDiff(a, b)).toEqual([]);
  });

  it('treats NaN === NaN (no op)', () => {
    const a = rec({ score: NaN });
    const b = rec({ score: NaN });
    expect(recordDiff(a, b)).toEqual([]);
  });
});

// ─── Scalar field changes ─────────────────────────────────────────────────────

describe('recordDiff — scalar field changes', () => {
  it('emits Replace op for changed string field', () => {
    const a = rec({ name: 'alice' });
    const b = rec({ name: 'bob' });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'name', value: 'bob' });
  });

  it('emits Replace op for changed number field', () => {
    const a = rec({ count: 1 });
    const b = rec({ count: 2 });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'count', value: 2 });
  });

  it('emits Replace op for changed boolean field', () => {
    const a = rec({ active: true });
    const b = rec({ active: false });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'active', value: false });
  });

  it('emits Replace op for null → value', () => {
    const a = rec({ note: null });
    const b = rec({ note: 'hello' });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'note', value: 'hello' });
  });

  it('emits Replace op for value → null', () => {
    const a = rec({ note: 'hello' });
    const b = rec({ note: null });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'note', value: null });
  });

  it('emits Replace op for type change string → number', () => {
    const a = rec({ x: 'five' });
    const b = rec({ x: 5 });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'x', value: 5 });
  });
});

// ─── Field additions and removals ────────────────────────────────────────────

describe('recordDiff — field additions and removals', () => {
  it('emits Add op for a new field', () => {
    const a = rec({ name: 'alice' });
    const b = rec({ name: 'alice', email: 'alice@example.com' });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Add, path: 'email', value: 'alice@example.com' });
  });

  it('emits Remove op for a deleted field', () => {
    const a = rec({ name: 'alice', email: 'alice@example.com' });
    const b = rec({ name: 'alice' });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Remove, path: 'email' });
  });

  it('handles multiple simultaneous adds, removes, and changes', () => {
    const a = rec({ keep: 1, change: 'old', remove: 'gone' });
    const b = rec({ keep: 1, change: 'new', added: true });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Remove, path: 'remove' });
    expect(ops).toContainEqual({ type: OperationType.Replace, path: 'change', value: 'new' });
    expect(ops).toContainEqual({ type: OperationType.Add, path: 'added', value: true });
    expect(ops.find(o => o.path === 'keep')).toBeUndefined();
  });
});

// ─── Nested objects ───────────────────────────────────────────────────────────

describe('recordDiff — nested objects', () => {
  it('diffs nested field changes using dot notation', () => {
    const a = rec({ address: { city: 'London', zip: 'EC1' } });
    const b = rec({ address: { city: 'Paris', zip: 'EC1' } });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'address.city', value: 'Paris' });
  });

  it('emits Add for new nested key', () => {
    const a = rec({ address: { city: 'London' } });
    const b = rec({ address: { city: 'London', country: 'UK' } });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Add, path: 'address.country', value: 'UK' });
  });

  it('emits Remove for deleted nested key', () => {
    const a = rec({ address: { city: 'London', country: 'UK' } });
    const b = rec({ address: { city: 'London' } });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Remove, path: 'address.country' });
  });

  it('diffs deeply nested changes', () => {
    const a = rec({ a: { b: { c: 1 } } });
    const b = rec({ a: { b: { c: 2 } } });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'a.b.c', value: 2 });
  });

  it('emits Replace when object replaced with scalar', () => {
    const a = rec({ meta: { x: 1 } });
    const b = rec({ meta: 'gone' });
    const ops = recordDiff(a, b);
    expect(ops.find(o => o.path === 'meta')).toMatchObject({ type: OperationType.Replace, value: 'gone' });
  });
});

// ─── Id-bearing arrays ────────────────────────────────────────────────────────

describe('recordDiff — id-bearing arrays', () => {
  it('emits no ops when id-bearing array is unchanged', () => {
    const items = [{ id: 'i1', name: 'a' }, { id: 'i2', name: 'b' }];
    const a = rec({ items });
    const b = rec({ items: [{ id: 'i1', name: 'a' }, { id: 'i2', name: 'b' }] });
    expect(recordDiff(a, b)).toEqual([]);
  });

  it('emits Add op for new element in id-bearing array', () => {
    const a = rec({ items: [{ id: 'i1', name: 'a' }] });
    const b = rec({ items: [{ id: 'i1', name: 'a' }, { id: 'i2', name: 'b' }] });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Add, path: 'items.[id:i2]', value: { id: 'i2', name: 'b' } });
  });

  it('emits Remove op for removed element in id-bearing array', () => {
    const a = rec({ items: [{ id: 'i1', name: 'a' }, { id: 'i2', name: 'b' }] });
    const b = rec({ items: [{ id: 'i1', name: 'a' }] });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Remove, path: 'items.[id:i2]' });
  });

  it('emits Replace inside matched id-bearing element', () => {
    const a = rec({ items: [{ id: 'i1', name: 'old' }] });
    const b = rec({ items: [{ id: 'i1', name: 'new' }] });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Replace, path: 'items.[id:i1].name', value: 'new' });
  });

  it('uses _id for boxed id path when id is absent', () => {
    const a = rec({ tags: [{ _id: 't1', label: 'one' }] });
    const b = rec({ tags: [{ _id: 't1', label: 'two' }] });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Replace, path: 'tags.[_id:t1].label', value: 'two' });
  });

  it('handles mixed add, remove, and change in one array', () => {
    const a = rec({ items: [{ id: 'i1', v: 1 }, { id: 'i2', v: 2 }] });
    const b = rec({ items: [{ id: 'i1', v: 99 }, { id: 'i3', v: 3 }] });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Remove, path: 'items.[id:i2]' });
    expect(ops).toContainEqual({ type: OperationType.Add, path: 'items.[id:i3]', value: { id: 'i3', v: 3 } });
    expect(ops).toContainEqual({ type: OperationType.Replace, path: 'items.[id:i1].v', value: 99 });
  });
});

// ─── Anonymous arrays (no id fields) ─────────────────────────────────────────

describe('recordDiff — anonymous arrays', () => {
  it('emits no ops for identical anonymous arrays', () => {
    const a = rec({ tags: ['x', 'y'] });
    const b = rec({ tags: ['x', 'y'] });
    expect(recordDiff(a, b)).toEqual([]);
  });

  it('emits Replace for changed element by index', () => {
    const a = rec({ tags: ['a', 'b'] });
    const b = rec({ tags: ['a', 'z'] });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'tags.1', value: 'z' });
    expect(ops[0].hash).toBeDefined(); // hash of old element for anchoring
  });

  it('emits Add for appended element', () => {
    const a = rec({ tags: ['a'] });
    const b = rec({ tags: ['a', 'b'] });
    const ops = recordDiff(a, b);
    expect(ops).toContainEqual({ type: OperationType.Add, path: 'tags.1', value: 'b' });
  });

  it('emits Remove (with hash) for removed trailing element', () => {
    const a = rec({ tags: ['a', 'b'] });
    const b = rec({ tags: ['a'] });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Remove, path: 'tags.1' });
    expect(ops[0].hash).toBeDefined();
  });

  it('handles empty array → populated array', () => {
    const a = rec({ tags: [] });
    const b = rec({ tags: ['a', 'b'] });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(2);
    expect(ops.every(o => o.type === OperationType.Add)).toBe(true);
  });

  it('handles populated array → empty array', () => {
    const a = rec({ tags: ['a', 'b'] });
    const b = rec({ tags: [] });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(2);
    expect(ops.every(o => o.type === OperationType.Remove)).toBe(true);
  });
});

// ─── Rich types (Date, RegExp treated as scalars) ─────────────────────────────

describe('recordDiff — rich types treated as scalars', () => {
  it('emits Replace for different Date values (op value is ISO string)', () => {
    const d1 = new Date('2024-01-01');
    const d2 = new Date('2024-06-01');
    const a = rec({ createdAt: d1 });
    const b = rec({ createdAt: d2 });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0].type).toBe(OperationType.Replace);
    expect(ops[0].path).toBe('createdAt');
    // Date objects are serialised to ISO strings for JSON-safe storage
    expect(typeof ops[0].value).toBe('string');
    expect(new Date(ops[0].value as string).getTime()).toBe(d2.getTime());
  });

  it('emits no ops for identical Date values', () => {
    const d = new Date('2024-01-01');
    const a = rec({ createdAt: d });
    const b = rec({ createdAt: d });
    expect(recordDiff(a, b)).toEqual([]);
  });

  it('emits Replace for different RegExp values', () => {
    const a = rec({ pattern: /foo/ });
    const b = rec({ pattern: /bar/ });
    const ops = recordDiff(a, b);
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ type: OperationType.Replace, path: 'pattern' });
  });
});

// ─── Type boundary: object ↔ scalar / array ───────────────────────────────────

describe('recordDiff — type boundaries', () => {
  it('emits Replace when scalar becomes object', () => {
    const a = rec({ x: 'string' });
    const b = rec({ x: { nested: true } });
    const ops = recordDiff(a, b);
    expect(ops.find(o => o.path === 'x')).toMatchObject({ type: OperationType.Replace, value: { nested: true } });
  });

  it('emits Replace when object becomes array', () => {
    const a = rec({ x: { a: 1 } });
    const b = rec({ x: [1, 2] });
    const ops = recordDiff(a, b);
    // Object → array is a replace at the top-level path x
    expect(ops.some(o => o.path === 'x')).toBe(true);
  });
});

// ─── diffAny internal export ──────────────────────────────────────────────────

describe('diffAny — boundary behaviours', () => {
  it('emits no op when both values are null', () => {
    const ops: any[] = [];
    diffAny(null, null, 'field', ops, []);
    expect(ops).toEqual([]);
  });

  it('emits Replace when undefined → value (both treated as scalars)', () => {
    const ops: any[] = [];
    diffAny(undefined, 'hello', 'field', ops, []);
    expect(ops).toContainEqual({ type: OperationType.Replace, path: 'field', value: 'hello' });
  });

  it('does not traverse into circular references (stack guard)', () => {
    const circular: any = { id: 'r1', self: null };
    circular.self = circular;
    // Should not throw or infinite-loop
    expect(() => recordDiff(circular, { ...circular, self: circular })).not.toThrow();
  });
});
