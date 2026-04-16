import { describe, it, expect } from 'vitest';
import type { MXDBCollectionIndex } from '../../common/models';
import type { Record } from '@anupheaus/common';
import { buildTableDDL, LIVE_TABLE_SUFFIX, AUDIT_TABLE_SUFFIX, SYNC_TABLE_SUFFIX } from './buildTableDDL';

/** Shape used for index field paths in these tests */
interface Todo extends Record {
  id: string;
  status?: string;
  userId?: string;
  slug?: string;
  dueDate?: string;
  name?: string;
}

interface User extends Record {
  id: string;
  address?: { city?: string };
}

describe('buildTableDDL', () => {
  it('produces live table', () => {
    const stmts = buildTableDDL('todos', [], true);
    expect(stmts.some(s => s.includes(`todos${LIVE_TABLE_SUFFIX}`) && s.includes('id TEXT PRIMARY KEY') && s.includes('data TEXT NOT NULL'))).toBe(true);
  });

  it('produces audit table and index for audited collection', () => {
    const stmts = buildTableDDL('todos', [], true);
    expect(stmts.some(s => s.includes(`todos${AUDIT_TABLE_SUFFIX}`) && s.includes('recordId TEXT NOT NULL'))).toBe(true);
    expect(stmts.some(s => s.includes('idx_todos_audit_by_record') && s.includes(`"todos${AUDIT_TABLE_SUFFIX}"(recordId, id)`))).toBe(true);
  });

  it('does not produce legacy _sync dirty table (unified audit table for all collections)', () => {
    const stmtsAudited = buildTableDDL('todos', [], true);
    const stmtsFree = buildTableDDL('settings', [], false);
    expect(stmtsAudited.some(s => s.includes(SYNC_TABLE_SUFFIX))).toBe(false);
    expect(stmtsFree.some(s => s.includes(SYNC_TABLE_SUFFIX))).toBe(false);
  });

  it('produces audit table for audit-free flag too (same schema)', () => {
    const stmts = buildTableDDL('settings', [], false);
    expect(stmts.some(s => s.includes(`settings${AUDIT_TABLE_SUFFIX}`) && s.includes('recordId TEXT NOT NULL'))).toBe(true);
  });

  it('produces single-field expression index', () => {
    const indexes: MXDBCollectionIndex<Todo>[] = [{ name: 'by_status', fields: ['status'] }];
    const stmts = buildTableDDL('todos', indexes, true);
    expect(stmts.some(s =>
      s.includes('idx_todos_by_by_status') &&
      s.includes('json_extract(data, \'$.status\')')
    )).toBe(true);
  });

  it('produces compound expression index', () => {
    const indexes: MXDBCollectionIndex<Todo>[] = [{ name: 'by_user_status', fields: ['userId', 'status'] }];
    const stmts = buildTableDDL('todos', indexes, true);
    expect(stmts.some(s =>
      s.includes('json_extract(data, \'$.userId\')') &&
      s.includes('json_extract(data, \'$.status\')')
    )).toBe(true);
  });

  it('produces UNIQUE index when isUnique is true', () => {
    const indexes: MXDBCollectionIndex<Todo>[] = [{ name: 'slug_unique', fields: ['slug'], isUnique: true }];
    const stmts = buildTableDDL('todos', indexes, true);
    expect(stmts.some(s => s.includes('CREATE UNIQUE INDEX'))).toBe(true);
  });

  it('produces sparse WHERE clause when isSparse is true', () => {
    const indexes: MXDBCollectionIndex<Todo>[] = [{ name: 'by_due', fields: ['dueDate'], isSparse: true }];
    const stmts = buildTableDDL('todos', indexes, true);
    expect(stmts.some(s =>
      s.includes('WHERE') &&
      s.includes('json_extract(data, \'$.dueDate\') IS NOT NULL')
    )).toBe(true);
  });

  it('all statements use IF NOT EXISTS (idempotent)', () => {
    const indexes: MXDBCollectionIndex<Todo>[] = [{ name: 'by_name', fields: ['name'] }];
    const stmts = buildTableDDL('todos', indexes, true);
    stmts.forEach(s => expect(s).toContain('IF NOT EXISTS'));
  });

  it('produces nested field expression index with dot notation', () => {
    const indexes: MXDBCollectionIndex<User>[] = [{ name: 'by_city', fields: ['address.city'] }];
    const stmts = buildTableDDL('users', indexes, false);
    expect(stmts.some(s => s.includes('json_extract(data, \'$.address.city\')'))).toBe(true);
  });
});
