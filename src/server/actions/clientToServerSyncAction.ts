import { createServerActionHandler } from '@anupheaus/socket-api/server';
import { useLogger } from '@anupheaus/socket-api/server';
import type { Record as MXDBRecord } from '@anupheaus/common';
import { mxdbClientToServerSyncAction } from '../../common/internalActions';
import { useDb, useServerToClientSynchronisation } from '../providers';
import {
  ServerReceiver,
  type ClientDispatcherRequest,
  type MXDBRecordStates,
  type MXDBRecordStatesRequest,
  type MXDBSyncEngineResponse,
  type MXDBActiveRecordState,
  type MXDBDeletedRecordState,
} from '../../common/sync-engine';
import { auditor } from '../../common';
import type { AnyAuditOf, AuditOf } from '../../common';
import { isActiveRecordState } from '../../common/sync-engine';

/**
 * §5.1 — Client-to-Server sync handler.
 *
 * Thin wrapper around {@link ServerReceiver}. The SR handles merge, replay,
 * delete-is-final enforcement, and post-merge SD push orchestration. This
 * handler just plumbs `onRetrieve` (read current server audits) and
 * `onUpdate` (persist merged audits + materialised records via
 * `ServerDbCollection.sync`).
 */
export const clientToServerSyncAction = createServerActionHandler(
  mxdbClientToServerSyncAction,
  async (request: ClientDispatcherRequest): Promise<MXDBSyncEngineResponse> => {
    const db = useDb();
    const logger = useLogger();
    const s2c = useServerToClientSynchronisation();

    if (s2c.isNoOp) {
      logger.warn('C2S sync handler invoked under no-op S2C instance — skipping');
      return [];
    }

    const sr = new ServerReceiver(logger.createSubLogger('sr'), {
      serverDispatcher: s2c.dispatcher,

      onRetrieve: async (retrieveRequest: MXDBRecordStatesRequest): Promise<MXDBRecordStates> => {
        const out: MXDBRecordStates = [];
        for (const item of retrieveRequest) {
          let collection: ReturnType<typeof db.use>;
          try { collection = db.use(item.collectionName); }
          catch {
            logger.warn(`C2S onRetrieve: unknown collection "${item.collectionName}" — skipping`);
            continue;
          }
          const records: (MXDBActiveRecordState | MXDBDeletedRecordState)[] = [];
          for (const recordId of item.recordIds) {
            try {
              const serverAudit = await collection.getAudit(recordId);
              if (serverAudit == null) continue; // No server state → SR treats as "new record"
              const entries = auditor.entriesOf(serverAudit as AnyAuditOf<MXDBRecord>);
              if (auditor.isDeleted(serverAudit as AnyAuditOf<MXDBRecord>)) {
                records.push({ recordId, audit: entries });
              } else {
                const serverRecord = await collection.get(recordId);
                if (serverRecord == null) {
                  // Audit exists but no live record — treat as deleted (split-brain guard).
                  records.push({ recordId, audit: entries });
                } else {
                  records.push({ record: serverRecord, audit: entries });
                }
              }
            } catch (error) {
              logger.error(`C2S onRetrieve failed for "${recordId}" in "${item.collectionName}"`, { error });
            }
          }
          if (records.length > 0) out.push({ collectionName: item.collectionName, records });
        }
        return out;
      },

      onUpdate: async (records: MXDBRecordStates): Promise<MXDBSyncEngineResponse> => {
        const response: MXDBSyncEngineResponse = [];
        for (const col of records) {
          let collection: ReturnType<typeof db.use>;
          try { collection = db.use(col.collectionName); }
          catch {
            logger.warn(`C2S onUpdate: unknown collection "${col.collectionName}" — skipping`);
            continue;
          }

          const updated: MXDBRecord[] = [];
          const removedIds: string[] = [];
          const updatedAudits: AnyAuditOf<MXDBRecord>[] = [];
          const attempted: string[] = [];

          for (const state of col.records) {
            if (isActiveRecordState(state)) {
              updated.push(state.record);
              updatedAudits.push({ id: state.record.id, entries: state.audit } as AuditOf<MXDBRecord>);
              attempted.push(state.record.id);
            } else {
              removedIds.push(state.recordId);
              updatedAudits.push({ id: state.recordId, entries: state.audit } as AuditOf<MXDBRecord>);
              attempted.push(state.recordId);
            }
          }

          try {
            const writeResults = await collection.sync({ updated, updatedAudits, removedIds });
            const failedIds = new Set<string>();
            for (const wr of writeResults) {
              if (wr.error != null) {
                logger.error(`C2S permanent I/O failure for record "${wr.id}"`, { error: wr.error });
                failedIds.add(wr.id);
              }
            }
            const successfulRecordIds = attempted.filter(id => !failedIds.has(id));
            response.push({ collectionName: col.collectionName, successfulRecordIds });
          } catch (error) {
            logger.error(`C2S onUpdate failed for "${col.collectionName}"`, { error });
            response.push({ collectionName: col.collectionName, successfulRecordIds: [] });
          }
        }
        return response;
      },
    });

    try {
      return await sr.process(request);
    } catch (error) {
      logger.error('C2S sync process failed', { error });
      throw error;
    }
  },
);
