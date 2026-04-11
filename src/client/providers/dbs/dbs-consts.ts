// Table suffixes — aligned with §4.3 schema
export { LIVE_TABLE_SUFFIX, AUDIT_TABLE_SUFFIX, SYNC_TABLE_SUFFIX, q } from '../../db-worker/buildTableDDL';

/** @deprecated Use AUDIT_TABLE_SUFFIX. */
export const AUDIT_COLLECTION_SUFFIX = '_audit';

/** @deprecated Use SYNC_TABLE_SUFFIX. */
export const DIRTY_COLLECTION_SUFFIX = '_sync';
