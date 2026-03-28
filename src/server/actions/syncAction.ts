import type { MXDBSyncIdResult } from '../../common/models';
import type { Logger, Record } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import type { AnyAuditOf, AuditOf } from '../../common';
import type { useAuditor } from '../hooks/useAuditor';

interface ProcessUpdatesProps {
  audit: ReturnType<typeof useAuditor>;
  audits: AuditOf<Record>[];
  existingAudits: AnyAuditOf<Record>[];
  existingRecords: Record[];
  logger: Logger;
  collectionName: string;
  updateAudits: Map<string, AnyAuditOf<Record>>;
  removeIds: Set<string>;
  updateRecords: Map<string, Record>;
  results: Map<string, Omit<MXDBSyncIdResult, 'id'>>;
  removedIdsForClient: Set<string>;
}

export function processUpdates({
  audit,
  audits, existingAudits, existingRecords, logger, collectionName,
  updateAudits, removeIds, updateRecords, results, removedIdsForClient,
}: ProcessUpdatesProps) {
  for (const clientAudit of audits as AuditOf<Record>[]) {
    const existingAudit = existingAudits.findById(clientAudit.id);

    let mergedAudit: AnyAuditOf<Record>;

    if (existingAudit == null) {
      if (!audit.isAudit(clientAudit, logger)) {
        logger.error(`Invalid audit for record in "${collectionName}"`, { id: (clientAudit as any)?.id });
        return;
      }
      const cleaned = audit.filterValidEntries(audit.entriesOf(clientAudit) as any[], logger);
      mergedAudit = { id: clientAudit.id, entries: cleaned };
    } else {
      const cleaned = audit.filterValidEntries(audit.entriesOf(clientAudit) as any[], logger);
      const cleanClient = { id: clientAudit.id, entries: cleaned };
      logger.debug(`[sync-diag] merge input "${clientAudit.id.slice(0, 8)}" existingEntries=${audit.entriesOf(existingAudit as any).length} clientEntries=${cleaned.length}`, {
        existingTypes: audit.entriesOf(existingAudit as any).map((e: any) => `${e.type}:${e.id}`),
        clientTypes: cleaned.map((e: any) => `${e.type}:${e.id}`),
        clientAuditValid: audit.isAudit(cleanClient, logger),
      });
      try {
        mergedAudit = audit.merge(existingAudit, cleanClient, logger);
      } catch (err) {
        logger.error(`§6.9#7 Merge failed for "${clientAudit.id}" in "${collectionName}"`, { err });
        return;
      }
    }

    updateAudits.set(mergedAudit.id, mergedAudit);

    const existingRecord = existingRecords.findById(mergedAudit.id);
    const mergedEntries = audit.entriesOf(mergedAudit as any);
    logger.debug(`[sync-diag] replay "${mergedAudit.id.slice(0, 8)}" entries=${mergedEntries.length} hasExisting=${existingRecord != null}`, {
      entryTypes: mergedEntries.map((e: any) => `${e.type}:${e.id}`),
    });
    let materialized: Record | undefined;
    try {
      materialized = audit.createRecordFrom(mergedAudit, existingRecord ?? undefined, logger);
    } catch (err) {
      logger.error(`§6.9#5 Replay failed for "${mergedAudit.id}" in "${collectionName}"`, { err });
      return;
    }
    logger.debug(`[sync-diag] replay result "${mergedAudit.id.slice(0, 8)}" tags=${JSON.stringify((materialized as any)?.tags)}`);

    const auditEntryId = audit.getLastEntryId(mergedAudit);

    const clientWantsLive = !audit.isDeleted(clientAudit);
    const serverSaysDeleted = materialized == null;
    if (serverSaysDeleted && clientWantsLive) {
      removedIdsForClient.add(mergedAudit.id);
    }

    if (materialized == null) {
      // Always route tombstones through sync's delete path so `_sync` is written even when there
      // was no live row yet (deleteOne is a no-op; audit replaceOne still upserts).
      removeIds.add(mergedAudit.id);
      results.set(mergedAudit.id, { auditEntryId });
    } else {
      updateRecords.set(mergedAudit.id, materialized);
      const clientMaterialized = audit.createRecordFrom(
        { id: clientAudit.id, entries: audit.entriesOf(clientAudit) },
        existingRecord ?? undefined,
        logger,
      );
      const inSync =
        clientMaterialized != null && is.deepEqual(clientMaterialized, materialized);
      results.set(
        mergedAudit.id,
        inSync ? { auditEntryId } : { auditEntryId, record: materialized },
      );
    }
  }
}
