import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import {
  type MXDBRecordCursors,
  type MXDBSyncEngineResponse,
  type ServerDispatcherFilter,
  type ServerDispatcherFilterRecord,
  SyncPausedError,
} from './models';
import { isActiveCursor, isDeletedCursor, getCursorId, squashCursors } from './utils';

interface ServerDispatcherProps {
  onDispatch<T extends MXDBRecord>(payload: MXDBRecordCursors<T>): Promise<MXDBSyncEngineResponse>;
  retryInterval?: number;
}

export class ServerDispatcher {
  readonly #logger: Logger;
  readonly #props: ServerDispatcherProps;
  #isPaused = false;
  #inFlight = false;
  #retryTimer: ReturnType<typeof setTimeout> | undefined = undefined;
  #queue: MXDBRecordCursors[] = [];
  #filter: ServerDispatcherFilter[] = [];
  #deletedRecordIds: Map<string, Set<string>> = new Map();

  constructor(logger: Logger, props: ServerDispatcherProps) {
    this.#logger = logger;
    this.#props = props;
    this.#logger.debug('[SD] ServerDispatcher created');
  }

  pause(): void {
    if (this.#isPaused) return;
    this.#isPaused = true;
    this.#logger.debug('[SD] paused');
  }

  resume(): void {
    if (!this.#isPaused) return;
    this.#isPaused = false;
    this.#logger.debug('[SD] resumed');
    if (!this.#inFlight && this.#retryTimer == null) {
      void this.#dispatch();
    }
  }

  updateFilter(filters: ServerDispatcherFilter[]): void {
    for (const filterItem of filters) {
      const existing = this.#filter.find(f => f.collectionName === filterItem.collectionName);
      if (existing == null) {
        this.#filter.push({
          collectionName: filterItem.collectionName,
          records: [...filterItem.records],
          deletedRecordIds: filterItem.deletedRecordIds ? [...filterItem.deletedRecordIds] : undefined,
        });
      } else {
        // Merge records — update or add, never remove
        for (const rec of filterItem.records) {
          const existingRec = existing.records.find(r => r.id === rec.id);
          if (existingRec == null) {
            existing.records.push({ ...rec });
          } else {
            existingRec.hash = rec.hash;
            existingRec.lastAuditEntryId = rec.lastAuditEntryId;
          }
        }
      }

      // Register deletedRecordIds
      if (filterItem.deletedRecordIds && filterItem.deletedRecordIds.length > 0) {
        if (!this.#deletedRecordIds.has(filterItem.collectionName)) {
          this.#deletedRecordIds.set(filterItem.collectionName, new Set());
        }
        const deletedSet = this.#deletedRecordIds.get(filterItem.collectionName)!;
        for (const id of filterItem.deletedRecordIds) {
          deletedSet.add(id);
        }
      }
    }
    this.#logger.debug('[SD] filter updated');
  }

  push<T extends MXDBRecord>(request: MXDBRecordCursors<T>): void {
    this.#queue.push(request as MXDBRecordCursors);
    this.#logger.debug('[SD] push received, queue length=' + this.#queue.length);
    if (!this.#isPaused && !this.#inFlight && this.#retryTimer == null) {
      void this.#dispatch();
    }
  }

  async #dispatch(): Promise<void> {
    // Step 1: Record queue length and squash
    const queueLength = this.#queue.length;
    const squashed = squashCursors(this.#queue);

    // Step 2: Filter against #filter and #deletedRecordIds
    const freshRequest: MXDBRecordCursors = [];

    for (const col of squashed) {
      const colName = col.collectionName;
      const filterItem = this.#filter.find(f => f.collectionName === colName);
      const deletedSet = this.#deletedRecordIds.get(colName);
      const freshRecords: (typeof col.records[0])[] = [];

      for (const cursor of col.records) {
        const id = getCursorId(cursor);

        if (isDeletedCursor(cursor)) {
          // Deletion cursor
          if (filterItem == null) {
            // Record not tracked in filter — send the delete anyway. The client may have
            // acquired the record via another route (e.g. an earlier active cursor that
            // squashed into this delete before being dispatched, or a broadcast received
            // while this SD was paused). The CR gracefully handles "no local state" as
            // already-consistent, so sending a redundant delete is safe.
            this.#logger.debug(`[SD] filter: sending delete for unknown record ${id} in ${colName}`);
            freshRecords.push(cursor);
            continue;
          }
          const filterRec = filterItem.records.find(r => r.id === id);
          if (filterRec == null) {
            // Collection known but record not tracked — same reasoning as above, send anyway.
            this.#logger.debug(`[SD] filter: sending delete for record ${id} not in filter records`);
            freshRecords.push(cursor);
            continue;
          }
          if (filterRec.hash == null) {
            // Pending deletion: compare and pick latest
            if (cursor.lastAuditEntryId >= filterRec.lastAuditEntryId) {
              freshRecords.push(cursor);
            } else {
              freshRecords.push({ recordId: id, lastAuditEntryId: filterRec.lastAuditEntryId });
            }
          } else {
            // Normal filter record with hash: send deletion
            freshRecords.push(cursor);
          }
        } else {
          // Update cursor
          if (filterItem == null) {
            // No filter for this collection
            if (deletedSet?.has(id)) {
              // Already confirmed deleted on client — skip
              this.#logger.debug(`[SD] filter: skip update for confirmed-deleted record ${id} in ${colName}`);
              continue;
            }
            // Not in deletedRecordIds — send
            freshRecords.push(cursor);
          } else {
            const filterRec = filterItem.records.find(r => r.id === id);
            if (filterRec == null) {
              // Not in filter records
              if (deletedSet?.has(id)) {
                // Already confirmed deleted on client — skip
                this.#logger.debug(`[SD] filter: skip update for confirmed-deleted record ${id} in ${colName}`);
                continue;
              }
              // Not confirmed deleted — send
              freshRecords.push(cursor);
            } else {
              if (filterRec.hash == null) {
                // Pending deletion — re-send the deletion cursor from filter
                this.#logger.debug(`[SD] filter: re-sending pending deletion for ${id} in ${colName}`);
                freshRecords.push({ recordId: id, lastAuditEntryId: filterRec.lastAuditEntryId });
              } else if (deletedSet?.has(id)) {
                // Confirmed deleted — skip
                this.#logger.debug(`[SD] filter: skip update for confirmed-deleted record ${id} in ${colName}`);
                continue;
              } else {
                // Compare hash and lastAuditEntryId — skip if client already up to date
                // The MXDBActiveRecordCursor carries a hash from the SR via the push call.
                // We store hash on the cursor when building it in SR (using the materialised record hash).
                // The cursor in the SD queue is typed as MXDBActiveRecordCursor which has no hash field,
                // but we attach one from SR via the push payload. Access it via type cast.
                const cursorHash = (cursor as any).hash as string | undefined;
                if (filterRec.hash === cursorHash && filterRec.lastAuditEntryId === cursor.lastAuditEntryId) {
                  // Client is already up to date — skip
                  this.#logger.debug(`[SD] filter: skip update — client already up to date for ${id} in ${colName}`);
                  continue;
                }
                freshRecords.push(cursor);
              }
            }
          }
        }
      }

      if (freshRecords.length > 0) {
        for (const cursor of freshRecords) {
          const id = getCursorId(cursor);
          const kind = isDeletedCursor(cursor) ? 'delete' : 'active';
          const inDeletedSet = deletedSet?.has(id) ?? false;
          const filterHasIt = (filterItem?.records.some(r => r.id === id)) ?? false;
          this.#logger.debug(`[SD] dispatch ${kind} ${id} in ${colName} filterHas=${filterHasIt} deletedSet=${inDeletedSet}`);
        }
        freshRequest.push({ collectionName: colName, records: freshRecords });
      }
    }

    // Step 3: If empty, return without dispatching
    if (freshRequest.length === 0) {
      this.#logger.debug('[SD] dispatch: fresh request empty, skipping');
      return;
    }

    // Step 4: Set inFlight and call onDispatch
    this.#inFlight = true;
    let success = false;
    let syncPaused = false;
    let response: MXDBSyncEngineResponse | undefined;

    try {
      this.#logger.debug('[SD] dispatching fresh request');
      response = await this.#props.onDispatch(freshRequest);
      success = true;

      // Step 5: Update #filter and #deletedRecordIds on success
      for (const col of freshRequest) {
        const colName = col.collectionName;
        const successIds = response.find(r => r.collectionName === colName)?.successfulRecordIds ?? [];
        const successSet = new Set(successIds);
        let filterItem = this.#filter.find(f => f.collectionName === colName);

        for (const cursor of col.records) {
          const id = getCursorId(cursor);

          if (isDeletedCursor(cursor)) {
            if (successSet.has(id)) {
              // Delete-is-final: permanently block future active cursors for this id on
              // this SD, regardless of whether the record was previously in the filter.
              // Records the client acquired via bootstrap, initial seed, or a concurrent
              // route are all covered by deletedRecordIds so that stale actives arriving
              // after the delete can be filtered here instead of reaching the CR.
              if (filterItem != null) {
                const idx = filterItem.records.findIndex(r => r.id === id);
                if (idx >= 0) filterItem.records.splice(idx, 1);
              }
              if (!this.#deletedRecordIds.has(colName)) {
                this.#deletedRecordIds.set(colName, new Set());
              }
              this.#deletedRecordIds.get(colName)!.add(id);
              this.#logger.debug(`[SD] successfully deleted ${id} in ${colName}`);
            } else {
              // Unsuccessfully deleted: mark as pending deletion (remove hash, keep lastAuditEntryId)
              if (filterItem == null) {
                filterItem = { collectionName: colName, records: [] };
                this.#filter.push(filterItem);
              }
              const filterRec = filterItem.records.find(r => r.id === id);
              if (filterRec != null) {
                filterRec.hash = undefined;
                filterRec.lastAuditEntryId = cursor.lastAuditEntryId;
              } else {
                filterItem.records.push({ id, lastAuditEntryId: cursor.lastAuditEntryId });
              }
              this.#logger.debug(`[SD] unsuccessfully deleted ${id} in ${colName} — marked as pending deletion`);
            }
          } else if (isActiveCursor(cursor)) {
            if (successSet.has(id)) {
              // Successfully updated: update filter
              if (filterItem == null) {
                filterItem = { collectionName: colName, records: [] };
                this.#filter.push(filterItem);
              }
              const filterRec = filterItem.records.find(r => r.id === id);
              const cursorWithHash = cursor as MXDBRecordCursors[0]['records'][0] & { hash?: string };
              if (filterRec != null) {
                filterRec.hash = (cursorWithHash as any).hash;
                filterRec.lastAuditEntryId = cursor.lastAuditEntryId;
              } else {
                filterItem.records.push({
                  id,
                  hash: (cursorWithHash as any).hash,
                  lastAuditEntryId: cursor.lastAuditEntryId,
                });
              }
            }
          }
        }
      }

      // Step 6: Trim #queue and push back failed records
      this.#queue.splice(0, queueLength);

      // Push back failed cursors for retry — each collection is wrapped in an array (MXDBRecordCursors)
      const failedBatch: MXDBRecordCursors = [];
      for (const col of freshRequest) {
        const colName = col.collectionName;
        const successIds = response.find(r => r.collectionName === colName)?.successfulRecordIds ?? [];
        const successSet = new Set(successIds);
        const failedRecords = col.records.filter(c => !successSet.has(getCursorId(c)));
        if (failedRecords.length > 0) {
          failedBatch.push({ collectionName: colName, records: failedRecords });
        }
      }
      if (failedBatch.length > 0) {
        this.#queue.unshift(failedBatch);
      }

    } catch (err) {
      if (err instanceof SyncPausedError) {
        syncPaused = true;
        this.#logger.debug('[SD] SyncPausedError received — scheduling retry');
      } else {
        this.#logger.error('[SD] dispatch error', err);
        this.#inFlight = false;
        throw err;
      }
    } finally {
      this.#inFlight = false;
    }

    if (success) {
      if (this.#queue.length > 0 && !this.#isPaused) {
        void this.#dispatch();
      }
    } else if (syncPaused) {
      if (!this.#isPaused) {
        this.#startRetryTimer();
      }
    }
  }

  #startRetryTimer(): void {
    const interval = this.#props.retryInterval ?? 250;
    this.#retryTimer = setTimeout(() => {
      this.#retryTimer = undefined;
      if (!this.#isPaused && !this.#inFlight) {
        void this.#dispatch();
      }
    }, interval);
  }
}
