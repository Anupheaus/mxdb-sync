import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import { auditor, AuditEntryType } from '../auditor';
import { replayHistoryEndState } from '../auditor/replay';
import { hashRecord } from '../auditor/hash';
import type { AuditEntry } from '../auditor';
import {
  type ClientDispatcherRequest,
  type MXDBRecordStatesRequest,
  type MXDBRecordStates,
  type MXDBActiveRecordState,
  type MXDBDeletedRecordState,
  type MXDBSyncEngineResponse,
  type ServerDispatcherFilter,
  type MXDBRecordCursors,
} from './models';
import type { ServerDispatcher } from './ServerDispatcher';
import { isActiveRecordState } from './utils';

interface ServerReceiverProps {
  onRetrieve(request: MXDBRecordStatesRequest): Promise<MXDBRecordStates>;
  onUpdate(records: MXDBRecordStates): Promise<MXDBSyncEngineResponse>;
  serverDispatcher: ServerDispatcher;
}

export class ServerReceiver {
  readonly #logger: Logger;
  readonly #props: ServerReceiverProps;

  constructor(logger: Logger, props: ServerReceiverProps) {
    this.#logger = logger;
    this.#props = props;
    this.#logger.debug('[SR] ServerReceiver created');
  }

  async process(request: ClientDispatcherRequest): Promise<MXDBSyncEngineResponse> {
    const { serverDispatcher } = this.#props;

    // Step 1: Pause SD
    serverDispatcher.pause();
    this.#logger.debug('[SR] processing request, SD paused');

    try {
      // Step 2: Build retrieve request and fetch current server states
      const retrieveRequest: MXDBRecordStatesRequest = request.map(item => ({
        collectionName: item.collectionName,
        recordIds: item.records.map(r => r.id),
      }));

      const serverStates = await this.#props.onRetrieve(retrieveRequest);

      // Build lookup: collectionName -> recordId -> server state
      const serverStateMap = new Map<string, Map<string, MXDBActiveRecordState | MXDBDeletedRecordState>>();
      for (const col of serverStates) {
        const colMap = new Map<string, MXDBActiveRecordState | MXDBDeletedRecordState>();
        for (const state of col.records) {
          const id = isActiveRecordState(state) ? state.record.id : state.recordId;
          colMap.set(id, state);
        }
        serverStateMap.set(col.collectionName, colMap);
      }

      // Step 3: Process each record
      type PendingPersistItem = {
        collectionName: string;
        recordId: string;
        mergedEntries: AuditEntry[];
        liveRecord: MXDBRecord | undefined;
        clientHash?: string;
      };

      type FilterSeedItem = {
        collectionName: string;
        recordId: string;
        hash?: string;
        lastAuditEntryId: string;
        isDelete: boolean;
      };

      const pendingPersist: PendingPersistItem[] = [];
      const filterSeeds: FilterSeedItem[] = [];
      const branchOnlySuccessIds = new Map<string, string[]>(); // collectionName -> recordIds

      for (const item of request) {
        const colName = item.collectionName;
        const colServerMap = serverStateMap.get(colName) ?? new Map();

        for (const rec of item.records) {
          const recordId = rec.id;

          // Strip Branched entries
          const strippedEntries = rec.entries.filter(e => e.type !== AuditEntryType.Branched);

          if (strippedEntries.length === 0) {
            // Branched-only: seed filter
            if (rec.hash != null) {
              // Active record: use client's hash and lastAuditEntryId
              // lastAuditEntryId from the Branched entry id in the entries array
              const branchedEntry = rec.entries.find(e => e.type === AuditEntryType.Branched);
              const lastAuditEntryId = branchedEntry?.id ?? '';
              filterSeeds.push({ collectionName: colName, recordId, hash: rec.hash, lastAuditEntryId, isDelete: false });
              if (!branchOnlySuccessIds.has(colName)) branchOnlySuccessIds.set(colName, []);
              branchOnlySuccessIds.get(colName)!.push(recordId);
              this.#logger.debug(`[SR] branched-only active record ${recordId} in ${colName} — seeding filter`);
            } else {
              // Deleted record: collect into deletedRecordIds for filter
              filterSeeds.push({ collectionName: colName, recordId, isDelete: true, lastAuditEntryId: '' });
              if (!branchOnlySuccessIds.has(colName)) branchOnlySuccessIds.set(colName, []);
              branchOnlySuccessIds.get(colName)!.push(recordId);
              this.#logger.debug(`[SR] branched-only deleted record ${recordId} in ${colName} — seeding filter`);
            }
            continue;
          }

          // Entries remain — process
          const serverState = colServerMap.get(recordId);

          let mergedEntries: AuditEntry[];

          if (serverState == null) {
            // New record: first entry must be Created
            if (strippedEntries[0].type !== AuditEntryType.Created) {
              // Check if this is a pending deletion for a record the server already deleted
              // (e.g. two clients both deleted the same record — already consistent)
              const isClientDeletion = strippedEntries.some(e => e.type === AuditEntryType.Deleted);
              if (isClientDeletion) {
                this.#logger.debug(`[SR] record ${recordId} in ${colName} — client deletion for already-absent server record; already consistent`);
                if (!branchOnlySuccessIds.has(colName)) branchOnlySuccessIds.set(colName, []);
                branchOnlySuccessIds.get(colName)!.push(recordId);
              } else {
                this.#logger.error(`[SR] new record ${recordId} in ${colName} does not have Created as first entry — skipping`);
              }
              continue;
            }
            mergedEntries = strippedEntries;
          } else {
            // Existing record: merge
            try {
              const serverAuditOf = { id: recordId, entries: serverState.audit as AuditEntry[] };
              const clientAuditOf = { id: recordId, entries: strippedEntries };
              const merged = auditor.merge(serverAuditOf, clientAuditOf, this.#logger);
              mergedEntries = merged.entries as AuditEntry[];
            } catch (err) {
              this.#logger.error(`[SR] merge failed for ${recordId} in ${colName} — skipping`, err);
              continue;
            }
          }

          // Replay to get live record
          let liveRecord: MXDBRecord | undefined;
          try {
            const { live } = replayHistoryEndState(mergedEntries, undefined, this.#logger);
            liveRecord = live;
          } catch (err) {
            this.#logger.error(`[SR] replay failed for ${recordId} in ${colName} — skipping`, err);
            continue;
          }

          pendingPersist.push({ collectionName: colName, recordId, mergedEntries, liveRecord, clientHash: rec.hash });
        }
      }

      // Step 4: Build MXDBRecordStates for onUpdate
      const persistStates: MXDBRecordStates = [];

      // Group by collection
      const persistByCollection = new Map<string, (MXDBActiveRecordState | MXDBDeletedRecordState)[]>();
      for (const item of pendingPersist) {
        if (!persistByCollection.has(item.collectionName)) {
          persistByCollection.set(item.collectionName, []);
        }
        if (item.liveRecord != null) {
          persistByCollection.get(item.collectionName)!.push({
            record: item.liveRecord,
            audit: item.mergedEntries,
          } as MXDBActiveRecordState);
        } else {
          persistByCollection.get(item.collectionName)!.push({
            recordId: item.recordId,
            audit: item.mergedEntries,
          } as MXDBDeletedRecordState);
        }
      }
      for (const [colName, records] of persistByCollection) {
        persistStates.push({ collectionName: colName, records });
      }

      let updateResponse: MXDBSyncEngineResponse = [];
      if (persistStates.length > 0) {
        updateResponse = await this.#props.onUpdate(persistStates);
      }

      // Build lookup for what was successfully persisted
      const persistSuccessMap = new Map<string, Set<string>>();
      for (const item of updateResponse) {
        persistSuccessMap.set(item.collectionName, new Set(item.successfulRecordIds));
      }

      // Step 5: Collect successfulRecordIds
      const successResponse: MXDBSyncEngineResponse = [];

      // Add persisted successes
      for (const [colName, ids] of persistSuccessMap) {
        successResponse.push({ collectionName: colName, successfulRecordIds: [...ids] });
      }

      // Add branched-only successes
      for (const [colName, ids] of branchOnlySuccessIds) {
        const existing = successResponse.find(r => r.collectionName === colName);
        if (existing) {
          existing.successfulRecordIds.push(...ids);
        } else {
          successResponse.push({ collectionName: colName, successfulRecordIds: [...ids] });
        }
      }

      // Step 6: Build ServerDispatcherFilter[] — only from branched-only seeds.
      // Persisted records are NOT seeded here: the SD will update its own filter
      // after successfully pushing the merged result to the client. Pre-seeding the
      // filter with the server's hash would cause the SD to skip the push, leaving
      // the client stuck with its stale record.
      const filterByCollection = new Map<string, ServerDispatcherFilter>();

      for (const seed of filterSeeds) {
        const colName = seed.collectionName;
        if (!filterByCollection.has(colName)) {
          filterByCollection.set(colName, { collectionName: colName, records: [], deletedRecordIds: [] });
        }
        const filterItem = filterByCollection.get(colName)!;

        if (seed.isDelete) {
          filterItem.deletedRecordIds!.push(seed.recordId);
        } else {
          filterItem.records.push({
            id: seed.recordId,
            hash: seed.hash,
            lastAuditEntryId: seed.lastAuditEntryId,
          });
        }
      }

      // Step 7: updateFilter (branched-only seeds only)
      const filters = [...filterByCollection.values()];
      if (filters.length > 0) {
        serverDispatcher.updateFilter(filters);
      }

      // Step 8: Compare and push
      const pushPayload: MXDBRecordCursors = [];

      // For persisted records, compare hashes
      for (const item of pendingPersist) {
        const colName = item.collectionName;
        const successIds = persistSuccessMap.get(colName) ?? new Set();
        if (!successIds.has(item.recordId)) continue;

        const lastEntry = [...item.mergedEntries].sort((a, b) => a.id < b.id ? -1 : 1).pop();
        const lastAuditEntryId = lastEntry?.id ?? '';

        if (item.liveRecord != null) {
          // Active result
          const serverHash = await hashRecord(item.liveRecord);
          if (serverHash !== item.clientHash) {
            // Hash differs — push active cursor
            this.#logger.debug(`[SR] push active cursor for ${item.recordId} in ${colName} — hash differs`);
            let colPush = pushPayload.find(p => p.collectionName === colName);
            if (colPush == null) { colPush = { collectionName: colName, records: [] }; pushPayload.push(colPush); }
            (colPush.records as any[]).push({
              record: item.liveRecord,
              lastAuditEntryId,
              hash: serverHash,
            });
          } else {
            // Hash matches — client is already up to date, no push needed.
            // However, register the record in SD's filter so that future deletion
            // broadcasts from other clients can be delivered.  Without this, SD skips
            // deletion cursors for records the client created locally (they were never
            // dispatched BY SD to the client, so SD's filter has no entry for them).
            serverDispatcher.updateFilter([{
              collectionName: colName,
              records: [{ id: item.recordId, hash: serverHash, lastAuditEntryId }],
            }]);
          }
        } else {
          // Deleted result
          if (item.clientHash != null) {
            // Client sent as active but server result is deleted — push delete cursor.
            // Register the record in the SD filter (as a pending-deletion entry, no hash)
            // BEFORE pushing the cursor.  Without this, SD would skip the deletion cursor
            // for records that the client created locally — those are never dispatched BY the
            // SD to the client, so they are absent from the SD filter.
            serverDispatcher.updateFilter([{
              collectionName: colName,
              records: [{ id: item.recordId, lastAuditEntryId }],
            }]);
            this.#logger.debug(`[SR] push delete cursor for ${item.recordId} in ${colName} — server deleted`);
            let colPush = pushPayload.find(p => p.collectionName === colName);
            if (colPush == null) { colPush = { collectionName: colName, records: [] }; pushPayload.push(colPush); }
            colPush.records.push({ recordId: item.recordId, lastAuditEntryId });
          }
          // Both deleted — no push needed
        }
      }

      // For branched-only active records: compare server state vs client hash
      for (const seed of filterSeeds) {
        if (seed.isDelete) continue; // branched-only deleted — no push needed
        const colName = seed.collectionName;
        const serverState = serverStateMap.get(colName)?.get(seed.recordId);
        if (serverState == null) continue;

        if (isActiveRecordState(serverState)) {
          const serverHash = await hashRecord(serverState.record);
          if (serverHash !== seed.hash) {
            this.#logger.debug(`[SR] push active cursor for branched-only ${seed.recordId} in ${colName} — hash differs`);
            let colPush = pushPayload.find(p => p.collectionName === colName);
            if (colPush == null) { colPush = { collectionName: colName, records: [] }; pushPayload.push(colPush); }
            const serverLastEntry = [...serverState.audit].sort((a, b) => (a as any).id < (b as any).id ? -1 : 1).pop() as AuditEntry | undefined;
            const lastAuditEntryId = serverLastEntry?.id ?? '';
            (colPush.records as any[]).push({
              record: serverState.record,
              lastAuditEntryId,
              hash: serverHash,
            });
          }
        } else {
          // Server is deleted but client thinks active — push delete cursor
          this.#logger.debug(`[SR] push delete cursor for branched-only ${seed.recordId} in ${colName} — server deleted`);
          let colPush = pushPayload.find(p => p.collectionName === colName);
          if (colPush == null) { colPush = { collectionName: colName, records: [] }; pushPayload.push(colPush); }
          const serverLastEntry = [...serverState.audit].sort((a, b) => (a as any).id < (b as any).id ? -1 : 1).pop() as AuditEntry | undefined;
          const lastAuditEntryId = serverLastEntry?.id ?? '';
          colPush.records.push({ recordId: seed.recordId, lastAuditEntryId });
        }
      }

      if (pushPayload.length > 0) {
        serverDispatcher.push(pushPayload);
      }

      return successResponse;

    } finally {
      // Step 9: Resume SD unconditionally
      serverDispatcher.resume();
      this.#logger.debug('[SR] process complete, SD resumed');
    }
  }
}
