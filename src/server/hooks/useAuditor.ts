import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import { auditor } from '../../common';
import type { AnyAuditOf, AuditOf } from '../../common';
import { isAudit, merge as mergeAudits } from '../../common/auditor/api';

/**
 * Server-side auditor API bound to a collection mode (`fullAudit` === `disableAudit !== true`).
 * Use this in actions / `ServerDbCollection` when applying merge and validation rules that depend
 * on whether the collection stores a full audit trail or sync-only `AuditOf` shapes.
 */
export function useAuditor(fullAudit: boolean) {
  return {
    ...auditor,
    fullAudit,
    isAudit: <T extends MXDBRecord>(value: unknown, logger?: Logger): value is AnyAuditOf<T> =>
      isAudit<T>(value, fullAudit, logger),
    merge: <T extends MXDBRecord>(
      serverAudit: AnyAuditOf<T>,
      clientAudit: AuditOf<T>,
      logger?: Logger,
    ) => mergeAudits(serverAudit, clientAudit, logger, fullAudit),
  };
}
