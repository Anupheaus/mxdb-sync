import type { MXDBCollectionIndex } from '../../common/models';

export const LIVE_TABLE_SUFFIX = '_live';
export const AUDIT_TABLE_SUFFIX = '_audit';
export const SYNC_TABLE_SUFFIX = '_sync';

/**
 * Generates CREATE TABLE and CREATE INDEX DDL statements for a collection.
 * All statements use IF NOT EXISTS so they are idempotent.
 * §4.3 — table schemas from the design spec.
 */
export function buildTableDDL(collectionName: string, indexes: MXDBCollectionIndex[], _isAudited: boolean): string[] {
  void _isAudited;
  const statements: string[] = [];

  // Live table: JSON blob per row for schema-agility
  statements.push(
    `CREATE TABLE IF NOT EXISTS ${collectionName}${LIVE_TABLE_SUFFIX} (id TEXT PRIMARY KEY, data TEXT NOT NULL)`
  );

  // Audit table for all collections (same sync protocol; `disableAudit` only affects server UX / validation emphasis).
  statements.push(
    `CREATE TABLE IF NOT EXISTS ${collectionName}${AUDIT_TABLE_SUFFIX} ` +
    '(id TEXT PRIMARY KEY, recordId TEXT NOT NULL, type INTEGER NOT NULL, ' +
    'timestamp INTEGER NOT NULL, record TEXT, ops TEXT)'
  );
  statements.push(
    `CREATE INDEX IF NOT EXISTS idx_${collectionName}_audit_by_record ` +
    `ON ${collectionName}${AUDIT_TABLE_SUFFIX}(recordId, id)`
  );

  // Expression indexes over json_extract for declared collection indexes
  for (const index of indexes) {
    const fields = index.fields
      .map(field => `json_extract(data, '$.${field}')`)
      .join(', ');
    const uniqueClause = index.isUnique === true ? 'UNIQUE ' : '';
    const sparseClause = index.isSparse === true
      ? ` WHERE ${index.fields.map(f => `json_extract(data, '$.${f}') IS NOT NULL`).join(' AND ')}`
      : '';
    statements.push(
      `CREATE ${uniqueClause}INDEX IF NOT EXISTS idx_${collectionName}_by_${index.name} ` +
      `ON ${collectionName}${LIVE_TABLE_SUFFIX}(${fields})${sparseClause}`
    );
  }

  return statements;
}
