import type { Logger } from '@anupheaus/common';
import type { MXDBCollection } from '../../../common';
import { auditor } from '../../../common';
import {
  ClientDispatcher,
  ClientReceiver,
  type ClientDispatcherRequest,
  type MXDBRecordStates,
  type MXDBRecordStatesRequest,
  type MXDBSyncEngineResponse,
  type MXDBUpdateRequest,
} from '../../../common/sync-engine';
import type { Db } from '../dbs';

/**
 * Thin per-Db wrapper around {@link ClientDispatcher}.
 *
 * Replaces the old bespoke C2S queue. One instance is created per MXDBSync mount
 * and owns a single ClientDispatcher that groups records by collection internally.
 * All sync-engine callbacks are routed to the synchronous DbCollection sync API.
 */
export interface ClientToServerSynchronisationProps {
  clientReceiver: ClientReceiver;
  sendBatch: (request: ClientDispatcherRequest) => Promise<MXDBSyncEngineResponse>;
  getDb: () => Db;
  collections: MXDBCollection[];
  logger: Logger;
  timerInterval?: number;
}

export class ClientToServerSynchronisation {
  readonly #getDb: () => Db;
  readonly #collections: MXDBCollection[];
  readonly #logger: Logger;
  readonly #cd: ClientDispatcher;
  #started = false;
  #isDispatching = false;
  #dispatchingListeners = new Set<(value: boolean) => void>();

  constructor(props: ClientToServerSynchronisationProps) {
    this.#getDb = props.getDb;
    this.#collections = props.collections;
    this.#logger = props.logger;

    this.#cd = new ClientDispatcher(props.logger, {
      clientReceiver: props.clientReceiver,
      onStart: () => this.#collectAllStatesForOnStart(),
      // CD declares onPayloadRequest with a method-level generic <T>; our
      // concrete MXDBRecordStates return value is cast because the caller
      // cannot satisfy the generic from inside a callback literal.
      onPayloadRequest: request => this.#collectStatesForRequest(request) as never,
      onDispatching: value => this.#setDispatching(value),
      onDispatch: request => props.sendBatch(request),
      onUpdate: updates => this.#applyCdUpdate(updates),
      timerInterval: props.timerInterval,
    });
  }

  // ── Public API ──────────────────────────────────────────────────────────

  get isDispatching(): boolean { return this.#isDispatching; }

  /**
   * Number of records with pending state across all configured collections.
   * Used by e2e stability checks — 0 means nothing waiting to be dispatched.
   */
  get pendingQueueEntryCount(): number {
    const db = this.#getDb();
    let total = 0;
    for (const collection of this.#collections) {
      total += db.use(collection.name).getPendingStatesSync().length;
    }
    return total;
  }

  onDispatchingChanged(listener: (value: boolean) => void): () => void {
    this.#dispatchingListeners.add(listener);
    return () => { this.#dispatchingListeners.delete(listener); };
  }

  /**
   * Start the dispatcher. Safe to call while already started.
   * Awaits every configured DbCollection's initial SQLite load first so that
   * the synchronous sync callbacks see a fully-populated in-memory layer.
   */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const db = this.#getDb();
    await Promise.all(this.#collections.map(c => db.use(c.name).whenReady()));
    this.#cd.start();
  }

  stop(): void {
    if (!this.#started) return;
    this.#started = false;
    this.#cd.stop();
  }

  close(): void {
    this.stop();
    this.#dispatchingListeners.clear();
  }

  /**
   * Enqueue a record for C2S dispatch. Called from the DbCollection `onChange`
   * subscriber when a client-originated upsert or delete lands.
   */
  enqueue(collectionName: string, recordId: string): void {
    this.#cd.enqueue({ collectionName, recordId });
  }

  // ── CD callback implementations ─────────────────────────────────────────

  /**
   * Feed the CD's onStart sweep with EVERY locally known record (pending or
   * branch-only), not just records with uncollapsed audit entries. The SR
   * mirrors this into the SD's filter and then walks every id against current
   * server state — that is the only place server-side deletions that happened
   * while we were disconnected get pushed back as disparity delete cursors. See
   * ServerReceiver branchOnly path for the merge semantics.
   */
  #collectAllStatesForOnStart(): MXDBRecordStates {
    const db = this.#getDb();
    const out: MXDBRecordStates = [];
    for (const collection of this.#collections) {
      const records = db.use(collection.name).getAllStatesSync();
      if (records.length > 0) out.push({ collectionName: collection.name, records });
    }
    return out;
  }

  #collectStatesForRequest(request: MXDBRecordStatesRequest): MXDBRecordStates {
    const db = this.#getDb();
    const out: MXDBRecordStates = [];
    for (const item of request) {
      const records = db.use(item.collectionName).getStatesSync(item.recordIds);
      if (records.length > 0) out.push({ collectionName: item.collectionName, records });
    }
    return out;
  }

  #applyCdUpdate(updates: MXDBUpdateRequest): void {
    const db = this.#getDb();
    for (const item of updates) {
      let collection: ReturnType<Db['use']>;
      try {
        collection = db.use(item.collectionName);
      } catch {
        this.#logger.warn('[C2S] onUpdate received unknown collection', { collectionName: item.collectionName });
        continue;
      }
      // Successful active records → collapse local audit to the server-confirmed anchor.
      // The CD passes the insertion-order last audit entry id (see ClientDispatcher §4.5),
      // which for a typical client-owned record is the final pending entry just synced.
      for (const rec of item.records ?? []) {
        collection.collapseAuditSync(rec.record.id, rec.lastAuditEntryId);
      }
      // Successful deletes → collapse the tombstone audit to a Branched anchor at
      // the Deleted entry's ULID so that a subsequent onStart sweep does not re-dispatch
      // the same delete forever. The in-memory record stays absent (already removed by
      // the local delete() that triggered the enqueue), and the collapsed branch-only
      // audit still registers as a tombstone for CR's delete-is-final check.
      for (const id of item.deletedRecordIds ?? []) {
        const states = collection.getStatesSync([id]);
        if (states.length === 0) continue;
        const anchor = auditor.getLastEntryId({ id, entries: states[0].audit });
        if (anchor == null) continue;
        collection.collapseAuditSync(id, anchor);
      }
    }
  }

  #setDispatching(value: boolean): void {
    if (this.#isDispatching === value) return;
    this.#isDispatching = value;
    for (const listener of this.#dispatchingListeners) listener(value);
  }
}
