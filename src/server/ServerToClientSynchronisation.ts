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
import { isTransientMongoCloseError } from './utils/isTransientMongoCloseError';

/**
 * Per-connection server→client synchronisation adapter.
 *
 * Owns a single {@link ServerDispatcher} for one connected client and translates
 * between MXDB concepts (audit, hash, ServerDb) and the pure sync-engine cursor
 * model. The SD handles all filter/deletedRecordIds bookkeeping; this class is
 * the impurity boundary that fetches audits, computes hashes, and builds cursors.
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
   * Tombstoned records are filtered OUT here (§10.1): once a record has been
   * deleted, only the original `Deleted` transition is propagated. Subsequent
   * audit mutations on a tombstoned record never reach the SD.
   *
   * Pushes are dispatched with `addToFilter=false` — change-stream fan-out is
   * not allowed to bootstrap records on the CR. If the client doesn't already
   * know about a record, the SD will drop the cursor.
   */
  async onDbChange(event:
    | { type: 'upsert'; collectionName: string; records: MXDBRecord[] }
    | { type: 'delete'; collectionName: string; recordIds: string[] },
  ): Promise<void> {
    if (this.#noOp || this.#closed || this.#sd == null) return;
    if (!this.#collectionNames.has(event.collectionName)) return;

    if (event.type === 'upsert') {
      await this.#buildAndPush(event.collectionName, event.records, /* addToFilter */ false);
    } else {
      const cursors = await this.#buildDeleteCursors(event.collectionName, event.recordIds);
      if (cursors.length > 0) {
        this.#sd.push([{ collectionName: event.collectionName, records: cursors }], /* addToFilter */ false);
      }
    }
  }

  /**
   * Authoritative push of live records to the CR. Used by getAll / query / get /
   * subscription result paths to deliver records to the client via the SD. On
   * successful dispatch, the SD adds each record to its filter so subsequent
   * change-stream events for the same id can reach the client.
   *
   * Unlike {@link onDbChange}, this path bootstraps records — the CR may have
   * no prior knowledge of the record and the dispatch will still go through.
   */
  async pushActive(collectionName: string, records: MXDBRecord[]): Promise<void> {
    if (this.#noOp || this.#closed || this.#sd == null) return;
    if (!this.#collectionNames.has(collectionName)) return;
    await this.#buildAndPush(collectionName, records, /* addToFilter */ true);
  }

  /**
   * Push explicit delete cursors to the SD — used by reconcile to tell a
   * reconnecting client about records that have been removed while offline.
   * Dispatched as change-stream-style (`addToFilter=false`) so the SD drops
   * deletes for records the CR never knew about.
   */
  async pushDeletes(collectionName: string, recordIds: string[]): Promise<void> {
    if (this.#noOp || this.#closed || this.#sd == null) return;
    if (recordIds.length === 0) return;
    if (!this.#collectionNames.has(collectionName)) return;
    const cursors = await this.#buildDeleteCursors(collectionName, recordIds);
    if (cursors.length > 0) {
      this.#sd.push([{ collectionName, records: cursors }], /* addToFilter */ false);
    }
  }

  // ─── Private: cursor construction ─────────────────────────────────────────

  async #buildAndPush(collectionName: string, records: MXDBRecord[], addToFilter: boolean): Promise<void> {
    if (records.length === 0 || this.#sd == null) return;
    const db = this.#getDb?.();
    if (db == null) return;

    let collection: ReturnType<typeof db.use>;
    try { collection = db.use(collectionName); }
    catch { return; }

    const disableAudit = this.#disableAuditByCollection.get(collectionName) === true;
    const cursors: (MXDBActiveRecordCursor | MXDBDeletedRecordCursor)[] = [];

    for (const record of records) {
      try {
        // Pair-consistency loop — the cursor's `record` and `lastAuditEntryId` MUST
        // reflect the same server state. The change-stream `fullDocument` that seeded
        // this call is a snapshot from the event's own write point, which under
        // concurrent writes can be stale relative to later-committed audit entries;
        // splicing that stale record together with a freshly-read `lastAuditEntryId`
        // produced cursors that claimed to represent the newest entry but carried an
        // older record payload, so clients materialised the wrong state (observed
        // across multiple stress runs: all clients branched at the latest entry id
        // but with an earlier entry's record content).
        //
        // To guarantee a consistent pair without a transaction: read audit → read
        // live record → read audit again. If the audit's last entry id is unchanged,
        // no write raced us between the two reads, so the live record reflects at
        // least that entry's state and the pair is safe to push. Otherwise retry.
        let lastAuditEntryId = '';
        let freshRecord: MXDBRecord | undefined;
        if (disableAudit) {
          freshRecord = (await collection.get([record.id]))[0];
        } else {
          let tombstoned = false;
          for (let attempt = 0; attempt < 4; attempt++) {
            const auditBefore = await collection.getAudit(record.id);
            if (auditBefore != null && auditor.isDeleted(auditBefore)) {
              // §10.1 — drop upserts for tombstoned records to prevent resurrection.
              this.#logger.silly('[s2c] #buildAndPush: filtered tombstoned record per §10.1', {
                collectionName, recordId: record.id,
              });
              tombstoned = true;
              break;
            }
            const idBefore = auditBefore != null ? (auditor.getLastEntryId(auditBefore) ?? '') : '';
            const candidate = (await collection.get([record.id]))[0];
            const auditAfter = await collection.getAudit(record.id);
            if (auditAfter != null && auditor.isDeleted(auditAfter)) {
              this.#logger.silly('[s2c] #buildAndPush: filtered tombstoned record per §10.1 (post-read)', {
                collectionName, recordId: record.id,
              });
              tombstoned = true;
              break;
            }
            const idAfter = auditAfter != null ? (auditor.getLastEntryId(auditAfter) ?? '') : '';
            if (idBefore === idAfter) {
              freshRecord = candidate;
              lastAuditEntryId = idAfter;
              break;
            }
            this.#logger.silly('[s2c] #buildAndPush: audit changed between reads — retrying for pair consistency', {
              collectionName, recordId: record.id, idBefore, idAfter, attempt,
            });
          }
          if (tombstoned) continue;
          if (freshRecord === undefined && lastAuditEntryId === '') {
            this.#logger.warn('[s2c] #buildAndPush: gave up on pair consistency after retries — skipping', {
              collectionName, recordId: record.id,
            });
            continue;
          }
        }
        if (freshRecord == null) {
          // Record was deleted between audit snapshots but the audit has not yet been
          // marked as deleted (rare race). Skip — the delete cursor path will catch it.
          this.#logger.silly('[s2c] #buildAndPush: live record missing after audit — skipping', {
            collectionName, recordId: record.id,
          });
          continue;
        }
        const hash = await hashRecord(freshRecord);
        const active: MXDBActiveRecordCursor & { hash: string } = {
          record: freshRecord,
          lastAuditEntryId,
          hash,
        };
        cursors.push(active);
      } catch (error) {
        // Client close races are expected at shutdown / mid-test server restart —
        // the in-flight audit/hash work gets aborted. Not a correctness failure;
        // downgrade so getAppLoggerErrorCount() does not trip on transient shutdown noise.
        if (isTransientMongoCloseError(error)) {
          this.#logger.warn('[s2c] #buildAndPush: aborted by client close (shutdown race)', {
            collectionName, recordId: record.id,
          });
        } else {
          this.#logger.error('[s2c] #buildAndPush: failed to build active cursor', {
            collectionName,
            recordId: record.id,
            error: error as Record<string, unknown>,
          });
        }
      }
    }

    if (cursors.length === 0) return;
    this.#sd.push([{ collectionName, records: cursors }], addToFilter);
  }

  async #buildDeleteCursors(collectionName: string, recordIds: string[]): Promise<MXDBDeletedRecordCursor[]> {
    if (recordIds.length === 0) return [];
    const db = this.#getDb?.();
    if (db == null) return [];

    let collection: ReturnType<typeof db.use>;
    try { collection = db.use(collectionName); }
    catch { return []; }

    const disableAudit = this.#disableAuditByCollection.get(collectionName) === true;
    const cursors: MXDBDeletedRecordCursor[] = [];

    for (const recordId of recordIds) {
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
        if (isTransientMongoCloseError(error)) {
          this.#logger.warn('[s2c] #buildDeleteCursors: aborted by client close (shutdown race)', {
            collectionName, recordId,
          });
        } else {
          this.#logger.error('[s2c] #buildDeleteCursors: failed to build delete cursor', {
            collectionName,
            recordId,
            error: error as Record<string, unknown>,
          });
        }
      }
    }

    return cursors;
  }
}
