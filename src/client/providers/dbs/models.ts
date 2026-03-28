import type { Record } from '@anupheaus/common';

export type MXDBCollectionEvent<RecordType extends Record> = {
  type: 'upsert';
  records: RecordType[];
  auditAction: 'default' | 'branched';
} | {
  type: 'remove';
  ids: string[];
  auditAction: 'remove' | 'markAsDeleted';
} | {
  type: 'clear';
  ids: string[];
} | {
  /** Emitted when another tab writes to this collection and the in-memory cache has been refreshed. */
  type: 'reload';
  records: RecordType[];
};
