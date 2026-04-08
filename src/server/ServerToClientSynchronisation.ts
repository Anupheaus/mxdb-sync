import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import type { MXDBCollection } from '../common';
import { auditor, configRegistry } from '../common';
import { hashRecord } from '../common/auditor/hash';
import {
  ServerDispatcher,
  SyncPausedError,
  type MXDBActiveRecordCursor,
  type MXDBDeletedRecordCursor,
  type MXDBRecordCursors,
  type MXDBSyncEngineResponse,
} from '../common/sync-engine';
import type { ServerDb } from './providers/db/ServerDb';

/**
 * Per-connection server→client synchronisation wrapper.
 *
 * Owns a single {@link ServerDispatcher} for one connected client. The SD handles
 * all the filter / deletedRecordIds bookkeeping, retry on `SyncPausedError`, and
 * queue management. This wrapper is the glue between the Socket.IO transport,
 * the MongoDB change stream, the auditor (for last-entry-ids and tombstone
 * detection), and the SD itself.
 *
 * One instance per connected client. Construct on connect, call {@link close}
 * on disconnect.
 */
export interface ServerToClientSynchronisationProps {
  /** Emits an `mxdbServerToClientSyncAction` to the connected client. */
  emitS2C(payload: MXDBRecordCursors): Promise<MXDBSyncEngineResponse>;
  getDb(): ServerDb;
  collections: MXDBCollection[];
  logger: Logger;
  /** When true, all outward S2C effects are skipped (server-startup no-op instance). */
  noOp?: boolean;
}

export class ServerToClientSynchronisation {
  readonly #logger: Logger;
  readonly #getDb: (() => ServerDb) | null;
  readonly #collectionNames: Set<string>;
  readonly #disableAuditByCollection: Map<string, boolean>;
  readonly #sd: ServerDispatcher | null;
  readonly #noOp: boolean;
  #closed = false;

  constructor(props: ServerToClientSynchronisationProps) {
    this.#logger = props.logger;
    this.#getDb = props.noOp === true ? null : props.getDb;
    this.#noOp = props.noOp === true;
    this.#collectionNames = new Set(props.collections.map(c => c.name));
    this.#disableAuditByCollection = new Map(
      props.collections.map(c => [c.name, configRegistry.getOrError(c).disableAudit === true]),
    );

    if (this.#noOp) {
      this.#sd = null;
      return;
    }

    this.#sd = new ServerDispatcher(this.#logger.createSubLogger('sd'), {
      onDispatch: async (payload: MXDBRecordCursors): Promise<MXDBSyncEngineResponse> => {
        try {
          return await props.emitS2C(payload);
        } catch (error) {
          // The socket layer surfaces client-side paused state as a plain Error with
          // this sentinel message (SyncPausedError instances cannot cross socket.io).
          if (error instanceof Error && error.message === 'MXDB_SYNC_PAUSED') {
            throw new SyncPausedError();
          }
          throw error;
        }
      },
    });
  }

  /**
   * No-op instance used under impersonation / startup seeding so that
   * `useServerToClientSynchronisation()` is always defined without emitting.
   */
  static createNoOp(collections: MXDBCollection[], logger: Logger): ServerToClientSynchronisation {
    return new ServerToClientSynchronisation({
      noOp: true,
      emitS2C: async () => [],
      getDb: () => { throw new Error('ServerToClientSynchronisation no-op: getDb must not be called'); },
      collections,
      logger,
    });
  }

  get isNoOp(): boolean { return this.#noOp; }

  /** Pause the underlying SD (prevents further dispatches until {@link resume}). */
  pause(): void { this.#sd?.pause(); }

  /** Resume the underlying SD. */
  resume(): void { this.#sd?.resume(); }

  /** Access the underlying ServerDispatcher, used by the SR in the C2S action handler. */
  get dispatcher(): ServerDispatcher {
    if (this.#sd == null) throw new Error('ServerToClientSynchronisation: dispatcher unavailable on no-op instance');
    return this.#sd;
  }

  /** Release references; no further emits will occur. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    // Pause to stop any in-flight retry timer from re-triggering.
    this.#sd?.pause();
  }

  /**
   * §2.4 — Feed a MongoDB change-stream event into the SD.
   *
   * Tombstoned records are **filtered OUT here** (§10.1): once a record has
   * been deleted, only the original `Deleted` transition is propagated to the
   * SD. Subsequent audit mutations on a tombstoned record never reach SD/CR
   * and cannot resurrect the record on the client.
   *
   * The caller (`clientDbWatches`) provides either:
   *   - `upsert` events: the current live records from the DB
   *   - `delete` events: ids that were just deleted in MongoDB
   */
  async onDbChange(event:
    | { type: 'upsert'; collectionName: string; records: MXDBRecord[] }
    | { type: 'delete'; collectionName: string; recordIds: string[] },
  ): Promise<void> {
    if (this.#noOp || this.#closed || this.#sd == null) return;
    if (!this.#collectionNames.has(event.collectionName)) return;
    const db = this.#getDb?.();
    if (db == null) return;

    let collection: ReturnType<typeof db.use>;
    try { collection = db.use(event.collectionName); }
    catch { return; }

    const disableAudit = this.#disableAuditByCollection.get(event.collectionName) === true;

    const cursors: (MXDBActiveRecordCursor | MXDBDeletedRecordCursor)[] = [];

    if (event.type === 'upsert') {
      for (const record of event.records) {
        try {
          let lastAuditEntryId = '';
          let tombstoned = false;
          if (!disableAudit) {
            const serverAudit = await collection.getAudit(record.id);
            if (serverAudit != null) {
              // §10.1 — if the record is tombstoned, do NOT propagate an active cursor.
              // The original delete transition was already broadcast (or will be via a
              // delete change event); any further mutation on a tombstoned audit must
              // be silently absorbed here to prevent resurrection pushes reaching SD/CR.
              if (auditor.isDeleted(serverAudit)) {
                tombstoned = true;
              } else {
                lastAuditEntryId = auditor.getLastEntryId(serverAudit) ?? '';
              }
            }
          }
          if (tombstoned) {
            this.#logger.silly('[s2c] onDbChange: filtered tombstoned upsert per §10.1', {
              collectionName: event.collectionName, recordId: record.id,
            });
            continue;
          }
          const hash = await hashRecord(record);
          const active: MXDBActiveRecordCursor & { hash: string } = {
            record,
            lastAuditEntryId,
            hash,
          };
          cursors.push(active);
        } catch (error) {
          this.#logger.error('[s2c] onDbChange: failed to build active cursor', {
            collectionName: event.collectionName,
            recordId: record.id,
            error: error as Record<string, unknown>,
          });
        }
      }
    } else {
      for (const recordId of event.recordIds) {
        try {
          let lastAuditEntryId = '';
          if (!disableAudit) {
            const serverAudit = await collection.getAudit(recordId);
            if (serverAudit != null) {
              lastAuditEntryId = auditor.getLastEntryId(serverAudit) ?? '';
            }
          }
          cursors.push({ recordId, lastAuditEntryId });
        } catch (error) {
          this.#logger.error('[s2c] onDbChange: failed to build delete cursor', {
            collectionName: event.collectionName,
            recordId,
            error: error as Record<string, unknown>,
          });
        }
      }
    }

    if (cursors.length === 0) return;
    this.#sd.push([{ collectionName: event.collectionName, records: cursors }]);
  }

  /**
   * Register that the client has just received the given records via another
   * route (query result, getAll, subscription fetch, etc.). This seeds the SD
   * filter so that future change-stream events compare against the correct
   * hash / lastAuditEntryId and only actual deltas are dispatched to the client.
   *
   * This does NOT push the records to the client — the caller has already
   * delivered them via the query response.
   */
  async seedActive(collectionName: string, records: MXDBRecord[]): Promise<void> {
    if (this.#noOp || this.#closed || this.#sd == null) return;
    if (!this.#collectionNames.has(collectionName)) return;
    if (records.length === 0) return;
    const db = this.#getDb?.();
    if (db == null) return;

    let collection: ReturnType<typeof db.use>;
    try { collection = db.use(collectionName); }
    catch { return; }

    const disableAudit = this.#disableAuditByCollection.get(collectionName) === true;
    const filterRecords: { id: string; hash?: string; lastAuditEntryId: string }[] = [];

    for (const record of records) {
      try {
        let lastAuditEntryId = '';
        if (!disableAudit) {
          const serverAudit = await collection.getAudit(record.id);
          if (serverAudit != null) {
            // §10.1 — tombstoned records must not be registered as active in the filter.
            if (auditor.isDeleted(serverAudit)) continue;
            lastAuditEntryId = auditor.getLastEntryId(serverAudit) ?? '';
          }
        }
        const hash = await hashRecord(record);
        filterRecords.push({ id: record.id, hash, lastAuditEntryId });
      } catch (error) {
        this.#logger.error('[s2c] seedActive: failed to build filter entry', {
          collectionName, recordId: record.id, error: error as Record<string, unknown>,
        });
      }
    }
    if (filterRecords.length > 0) {
      this.#sd.updateFilter([{ collectionName, records: filterRecords }]);
    }
  }

  /**
   * Push explicit delete cursors to the SD — used by reconcile to tell a
   * reconnecting client about records that have been removed while offline.
   */
  async pushDeletes(collectionName: string, recordIds: string[]): Promise<void> {
    if (this.#noOp || this.#closed || this.#sd == null) return;
    if (recordIds.length === 0) return;
    await this.onDbChange({ type: 'delete', collectionName, recordIds });
  }
}
