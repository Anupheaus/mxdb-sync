import type { Record } from '@anupheaus/common';
import { defineCollection } from '../../../src/common';

/**
 * Default e2e Mongo collection (`e2eTest` / `e2eTest_sync`) and document shape for library end-to-end tests.
 */
export interface E2eTestMetadata {
  count: number;
  tag?: string | null;
}

export interface E2eTestRecord extends Record {
  id: string;
  clientId: string;
  /**
   * Arbitrary test data field. NOT used by the sync system to determine record ordering
   * or conflict resolution — only the ULID of the audit entry determines which write wins.
   */
  testDate?: number;
  /** Optional; can be set, updated, or unset (undefined). */
  name?: string | null;
  /** Nested object; can be set, partially updated, or cleared. */
  metadata?: E2eTestMetadata | null;
  /** Array; elements can be added or removed. */
  tags?: string[] | null;
  /** Simple value field for straightforward scenarios. */
  value?: string | null;
}

export const e2eTestCollection = defineCollection<E2eTestRecord>({
  name: 'e2eTest',
  indexes: [],
});
