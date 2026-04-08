import { mxdbClientToServerSyncAction } from '../../common/internalActions';
import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { useDb, useServerToClientSync, useServerToClientSynchronisation } from '../providers';
import type { ClientToServerSyncResponse, ClientToServerSyncRequestItem, ClientToServerSyncResponseItem, MXDBSyncIdResult } from '../../common/models';
import type { Record } from '@anupheaus/common';
import { useLogger } from '@anupheaus/socket-api/server';
import { configRegistry } from '../../common/registries';
import { useAuditor } from '../hooks/useAuditor';
import { processUpdates } from './syncAction';
import type { AnyAuditOf, AuditOf } from '../../common';
import { auditor } from '../../common';

/** Per-record promise chain — serialises concurrent C2S syncs for the same record across clients. */
const recordSyncGates = new Map<string, Promise<void>>();

function withRecordLock<T>(collectionName: string, recordId: string, fn: () => Promise<T>): Promise<T> {
  const key = `${collectionName}::${recordId}`;
  const prior = recordSyncGates.get(key) ?? Promise.resolve();
  const next = prior.then(fn, fn as () => Promise<T>);
  recordSyncGates.set(key, next.then(() => { }, () => { }));
  return next;
}

export const clientToServerSyncAction = createServerActionHandler(mxdbClientToServerSyncAction, async (request): Promise<ClientToServerSyncResponse> => {
  const db = useDb();
  const logger = useLogger();

  const responseItems = await request.mapAsync(async (item: ClientToServerSyncRequestItem): Promise<ClientToServerSyncResponseItem> => {
    logger.info(`C2S sync for collection "${item.collectionName}"...`);
    const c2sT0 = performance.now();
    try {
      let dbCollection: ReturnType<typeof db.use>;
      try {
        dbCollection = db.use(item.collectionName);
      } catch {
        logger.warn(`Unknown collection "${item.collectionName}" — skipping C2S sync`);
        return { collectionName: item.collectionName, successfulRecordIds: [] };
      }

      const audit = useAuditor(true);
      const disableAudit = configRegistry.getOrError(dbCollection.collection).disableAudit === true;
      const s2c = useServerToClientSynchronisation();
      const { pushRecordsToClient } = useServerToClientSync();

      logger.info(`C2S processing records for "${item.collectionName}" (${item.updates.length} updates)...`);

      // §5.1 — Convert C2S update entries into AuditOf objects for processUpdates.
      // Process each record independently under a per-record lock so concurrent C2S syncs
      // for different records proceed in parallel while the same record is serialised.
      const perRecordResults = await item.updates.mapAsync(async update => {
        const clientAudit: AuditOf<Record> = { id: update.recordId, entries: update.entries } as AuditOf<Record>;

        return withRecordLock(item.collectionName, update.recordId, async () => {
          const existingRecord = await dbCollection.get(update.recordId);
          const existingAudit = await dbCollection.getAudit(update.recordId);

          const removeIds = new Set<string>();
          const updateRecords = new Map<string, Record>();
          const updateAuditsMap = new Map<string, AnyAuditOf<Record>>();
          const results = new Map<string, Omit<MXDBSyncIdResult, 'id'>>();
          const removedIdsForClient = new Set<string>();

          processUpdates({
            audit,
            audits: [clientAudit],
            existingAudits: existingAudit != null ? [existingAudit] : [],
            existingRecords: existingRecord != null ? [existingRecord] : [],
            logger,
            collectionName: item.collectionName,
            updateAudits: updateAuditsMap,
            removeIds,
            updateRecords,
            results,
            removedIdsForClient,
          });

          const updated = Array.from(updateRecords.values());
          const removedIds = Array.from(removeIds);
          const updatedAudits = Array.from(updateAuditsMap.values());

          // Resurrection guard: if processUpdates decided to write a live record but the server
          // concurrently deleted it between our initial reads and now, re-run processUpdates with
          // the fresh (post-deletion) audit. This lets LWW decide correctly:
          //   - if all client entry ULIDs predate the deletion ULID → deletion wins, no write
          //   - if a client entry ULID postdates the deletion ULID → resurrection is correct
          if (updated.length > 0) {
            const freshAudit = await dbCollection.getAudit(update.recordId);
            if (freshAudit != null && auditor.isDeleted(freshAudit)) {
              const freshRecord = await dbCollection.get(update.recordId); // should be null, but read for correctness
              const freshRemoveIds = new Set<string>();
              const freshUpdateRecords = new Map<string, Record>();
              const freshUpdateAudits = new Map<string, AnyAuditOf<Record>>();
              const freshResults = new Map<string, Omit<MXDBSyncIdResult, 'id'>>();
              const freshRemovedForClient = new Set<string>();
              processUpdates({
                audit,
                audits: [clientAudit],
                existingAudits: [freshAudit],
                existingRecords: freshRecord != null ? [freshRecord] : [],
                logger,
                collectionName: item.collectionName,
                updateAudits: freshUpdateAudits,
                removeIds: freshRemoveIds,
                updateRecords: freshUpdateRecords,
                results: freshResults,
                removedIdsForClient: freshRemovedForClient,
              });
              const freshUpdated = Array.from(freshUpdateRecords.values());
              const freshRemovedIds = Array.from(freshRemoveIds);
              const freshUpdatedAudits = Array.from(freshUpdateAudits.values());
              if (freshUpdated.length > 0 || freshUpdatedAudits.length > 0 || freshRemovedIds.length > 0) {
                const writeResults = await dbCollection.sync({ updated: freshUpdated, updatedAudits: freshUpdatedAudits, removedIds: freshRemovedIds });
                for (const wr of writeResults) {
                  if (wr.error != null) {
                    logger.error(`C2S permanent I/O failure for record "${wr.id}"`, { error: wr.error });
                    freshResults.set(wr.id, { error: wr.error });
                  }
                }
              }
              return { updated: freshUpdated, removedIds: freshRemovedIds, results: freshResults };
            }
          }

          if (updated.length > 0 || updatedAudits.length > 0 || removedIds.length > 0) {
            const writeResults = await dbCollection.sync({ updated, updatedAudits, removedIds });
            for (const wr of writeResults) {
              if (wr.error != null) {
                logger.error(`C2S permanent I/O failure for record "${wr.id}"`, { error: wr.error });
                results.set(wr.id, { error: wr.error });
              }
            }
          }

          return { updated, removedIds, results };
        });
      });

      logger.info(`C2S finished processing records for "${item.collectionName}"`, { perRecordResults });


      // Aggregate per-record results
      const updated: Record[] = [];
      const removedIds: string[] = [];
      const results = new Map<string, Omit<MXDBSyncIdResult, 'id'>>();
      for (const r of perRecordResults) {
        updated.push(...r.updated);
        removedIds.push(...r.removedIds);
        for (const [id, result] of r.results) results.set(id, result);
      }

      // Determine successful record ids (no error in results)
      const successfulRecordIds: string[] = [];
      for (const [id, result] of results) {
        if (result.error == null) successfulRecordIds.push(id);
      }

      const successSet = new Set(successfulRecordIds);


      // §2.3 — Seed mirror from the persisted client batch before comparing server truth (avoids redundant S2C).
      const mirrorSeeds = item.updates
        .filter(update => successSet.has(update.recordId))
        .map(update => ({
          collectionName: item.collectionName,
          recordId: update.recordId,
          recordHash: update.recordHash,
          lastAuditEntryId: update.entries.length > 0 ? update.entries[update.entries.length - 1].id : '',
        }));
      const seededIds = new Set(mirrorSeeds.map(s => s.recordId));
      for (const id of removedIds) {
        if (!successSet.has(id) || seededIds.has(id)) continue;
        const serverAudit = await dbCollection.getAudit(id);
        const lastAuditEntryId =
          !disableAudit && serverAudit != null ? (auditor.getLastEntryId(serverAudit) ?? '') : '';
        mirrorSeeds.push({
          collectionName: item.collectionName,
          recordId: id,
          recordHash: '',
          lastAuditEntryId,
        });
      }
      // Seed mirror from passive entries (connect/reconnect only — records with no pending changes).
      if (item.entries != null && item.entries.length > 0) {
        const entrySeeds = await item.entries
          .filter(e => !seededIds.has(e.recordId)) // don't override update seeds
          .mapAsync(async ({ recordId, recordHash, lastAuditEntryId }) => {
            const existingRecord = await dbCollection.get(recordId);
            if (existingRecord == null) removedIds.push(recordId);
            return {
              collectionName: item.collectionName,
              recordId,
              recordHash,
              lastAuditEntryId,
            };
          });
        mirrorSeeds.push(...entrySeeds);
      }
      logger.silly('C2S setting seeds for client', { mirrorSeeds, removedIds });
      s2c.seedFromC2S(mirrorSeeds);

      const updatedIdsForS2c = updated.map(r => r.id).filter(id => successSet.has(id));
      // Do not await: awaiting S2C here deadlocks with the client (S2C handler waits on waitForS2CGate
      // until C2S sendBatch completes). Fire-and-forget after mirror seed; ack still runs on the client.
      logger.silly('C2S pushing records out to client', { updatedIdsForS2c, removedIds });
      if (updatedIdsForS2c.length > 0 || removedIds.length > 0) {
        void pushRecordsToClient(item.collectionName, updatedIdsForS2c, removedIds, disableAudit).catch(
          error => {
            logger.error(`pushRecordsToClient failed after C2S sync for "${item.collectionName}"`, { error });
          },
        );
      }

      const totalC2sMs = Math.round(performance.now() - c2sT0);
      logger.debug(`[c2s-timing] "${item.collectionName}"`, {
        totalMs: totalC2sMs,
        batchUpdateCount: item.updates.length,
      });
      if (totalC2sMs >= 3_000) {
        logger.warn(`[c2s-timing] slow C2S sync for "${item.collectionName}"`, {
          totalMs: totalC2sMs,
          batchUpdateCount: item.updates.length,
        });
      }

      logger.info(`C2S sync complete for "${item.collectionName}"`, {
        successfulCount: successfulRecordIds.length,
        totalCount: item.updates.length,
      });

      return { collectionName: item.collectionName, successfulRecordIds };
    } catch (error) {
      logger.error(`Error in C2S sync for collection "${item.collectionName}"`, { error });
      throw error;
    }
  });

  return responseItems;
});
