import { bind, type Logger, type Record } from '@anupheaus/common';
import type { MXDBCollection } from '../common';
import type {
  ClientMirrorRow,
  MXDBServerToClientSyncPayload,
  MXDBServerToClientSyncPayloadItem,
  S2CUpdatedRecord,
  S2CDeletedRecord,
  ServerToClientSyncAck,
} from '../common/models';
import { auditor } from '../common';
import { hashRecord } from '../common/auditor/hash';
import type { ServerDb } from './providers/db/ServerDb';

/** Queued mirror seed entry buffered while an S2C round is in flight (section 2.6). */
interface PendingMirrorEntry {
  collectionName: string;
  recordId: string;
  recordHash: string;
  lastAuditEntryId: string;
}

/**
 * Per-connection server-to-client synchronisation manager.
 *
 * Maintains a mirror of what the server believes each connected client currently
 * holds for every tracked `(collectionName, recordId)` pair. Uses that mirror to
 * gate outgoing pushes so only stale rows are transmitted (section 2.4).
 *
 * There is exactly one instance per connected client (socket / connection).
 */
export type ServerToClientSynchronisationProps = {
  emitS2C: (payload: MXDBServerToClientSyncPayload) => Promise<ServerToClientSyncAck>;
  getDb: () => ServerDb;
  collections: MXDBCollection[];
  logger?: Logger;
  /** When true, all outward S2C effects are skipped (e.g. admin / impersonation scopes). */
  noOp?: boolean;
};

export class ServerToClientSynchronisation {
  constructor(props: ServerToClientSynchronisationProps) {
    this.#emitS2C = props.emitS2C;
    this.#getDb = props.getDb;
    this.#noOp = props.noOp === true;
    this.#collectionNames = new Set(props.collections.map(c => c.name));
    this.#logger = props.logger;
    this.#mirror = new Map();
    this.#s2cInFlight = false;
    this.#emitQueue = Promise.resolve();
    this.#pendingMirrorQueue = [];
    this.#pendingCatchUp = true;
    this.#closed = false;
  }

  /**
   * S2C manager that never emits or mutates mirror state — use under impersonation / seeding
   * so `useServerToClientSynchronisation()` is always defined.
   */
  static createNoOp(collections: MXDBCollection[]): ServerToClientSynchronisation {
    return new ServerToClientSynchronisation({
      noOp: true,
      emitS2C: async () => [],
      getDb: () => {
        throw new Error('ServerToClientSynchronisation no-op: getDb must not be called');
      },
      collections,
    });
  }


  // ── Private state ────────────────────────────────────────────────────────

  #emitS2C: ((payload: MXDBServerToClientSyncPayload) => Promise<ServerToClientSyncAck>) | null;
  #getDb: (() => ServerDb) | null;
  #noOp: boolean;
  /** Known collection names for validation. */
  #collectionNames: Set<string>;
  #logger: Logger | undefined;

  /** collectionName -> recordId -> ClientMirrorRow */
  #mirror: Map<string, Map<string, ClientMirrorRow>>;

  /** Whether an S2C emit is currently awaiting its ack. */
  #s2cInFlight: boolean;

  /** Serial queue for #emitS2CPayload — ensures only one S2C round is in flight at a time. */
  #emitQueue: Promise<void>;

  /** C2S mirror seeds buffered while S2C is in flight (section 2.6). */
  #pendingMirrorQueue: PendingMirrorEntry[];

  /** True until the first catch-up has been dispatched for this connection episode. */
  #pendingCatchUp: boolean;

  /** True after {@link close} has been called. */
  #closed: boolean;

  // ── Public API ───────────────────────────────────────────────────────────

  /** True when this is the server-startup no-op instance (never emits). */
  get isNoOp(): boolean { return this.#noOp; }

  /**
   * Seed the mirror from a `mxdbClientToServerSyncAction` batch (section 2.3).
   *
   * If an S2C round is NOT in flight the entries are applied to the mirror
   * immediately. If an S2C round IS in flight the entries are enqueued and
   * will be drained when the ack arrives (section 2.6).
   *
   * This method never blocks on S2C ack processing (no deadlock risk).
   */
  seedFromC2S(updates: Array<{ collectionName: string; recordId: string; recordHash: string; lastAuditEntryId: string; }>): void {
    if (this.#noOp || this.#closed) return;

    if (this.#s2cInFlight) {
      for (const entry of updates) {
        this.#pendingMirrorQueue.push({
          collectionName: entry.collectionName,
          recordId: entry.recordId,
          recordHash: entry.recordHash,
          lastAuditEntryId: entry.lastAuditEntryId,
        });
      }
    } else {
      for (const entry of updates) {
        this.#applyMirrorEntry(entry.collectionName, entry.recordId, entry.recordHash, entry.lastAuditEntryId);
      }
      // If a catch-up is pending (first C2S after reconnect), schedule it now so any stale
      // (updated-but-not-deleted) records are pushed to the client. Deletions are handled by
      // pushRecordsToClient; updates with no corresponding C2S push would otherwise be missed.
      if (this.#pendingCatchUp) {
        void this.catchUp().catch(error => {
          this.#logger?.error('Catch-up after seedFromC2S failed', { error });
        });
      }
    }
  }

  /**
   * Feed database change events into the synchronisation gate (section 2.4).
   *
   * For each change, if the record is tracked in the mirror and either the
   * `recordHash` or `lastAuditEntryId` differs from the mirror row, the
   * change is included in the outgoing S2C payload.
   */
  async onDbChange(
    collectionName: string,
    changes: Array<{
      recordId: string;
      record?: Record;
      lastAuditEntryId: string;
      recordHash: string;
      deleted?: boolean;
    }>,
  ): Promise<void> {
    if (this.#noOp || this.#closed) return;
    if (!this.#collectionNames.has(collectionName)) return;

    if (this.#mirror.get(collectionName) == null) {
      const deletedIds = changes.filter(c => c.deleted).map(c => c.recordId);
      if (deletedIds.length > 0) {
        this.#logger?.debug('[s2c-conv] onDbChange: dropping delete — no collection mirror for this client', {
          collectionName, deletedIds,
        });
      }
      return;
    }

    const { updates, deletions } = this.#filterChangesToS2CLists(collectionName, changes, false);
    if (updates.length === 0 && deletions.length === 0) return;

    this.#logger?.debug('[s2c-conv] onDbChange: emitting S2C payload', {
      collectionName,
      updateIds: updates.map(u => u.record.id),
      deletionIds: deletions.map(d => d.recordId),
    });
    await this.#emitS2CPayload([{ collectionName, updates, deletions }]);
  }

  @bind
  async pushRecordsToClient(
    collectionName: string,
    updatedRecordIds: string[],
    removedRecordIds: string[],
    disableAudit: boolean,
  ): Promise<void> {
    if (this.#noOp || this.#closed) return;
    if (!this.#collectionNames.has(collectionName)) return;

    const db = this.#getDb?.();
    if (db == null) return;

    if (this.#mirror.get(collectionName) == null) {
      this.#mirror.set(collectionName, new Map());
    }

    const collection = db.use(collectionName);
    const changes: Array<{
      recordId: string;
      record?: Record;
      lastAuditEntryId: string;
      recordHash: string;
      deleted?: boolean;
    }> = [];

    const seen = new Set<string>();

    for (const recordId of updatedRecordIds) {
      if (seen.has(recordId)) continue;
      seen.add(recordId);
      try {
        const serverRecord = await collection.get(recordId);
        if (serverRecord == null) continue;
        let lastAuditEntryId = '';
        const serverAudit = await collection.getAudit(recordId);
        if (!disableAudit) {
          lastAuditEntryId = serverAudit != null ? (auditor.getLastEntryId(serverAudit) ?? '') : '';
        }
        // Split-brain guard: if audit says deleted, route to deletion instead of update.
        if (serverAudit != null && auditor.isDeleted(serverAudit)) {
          changes.push({ recordId, lastAuditEntryId, recordHash: '', deleted: true });
          continue;
        }
        const recordHash = await hashRecord(serverRecord);
        changes.push({ recordId, record: serverRecord, lastAuditEntryId, recordHash });
      } catch (error) {
        this.#logger?.error('pushRecordsToClient: failed to load updated record', { collectionName, recordId, error });
      }
    }

    for (const recordId of removedRecordIds) {
      if (seen.has(recordId)) continue;
      seen.add(recordId);
      try {
        let lastAuditEntryId = '';
        if (!disableAudit) {
          const serverAudit = await collection.getAudit(recordId);
          lastAuditEntryId = serverAudit != null ? (auditor.getLastEntryId(serverAudit) ?? '') : '';
        }
        changes.push({ recordId, lastAuditEntryId, recordHash: '', deleted: true });
      } catch (error) {
        this.#logger?.error('pushRecordsToClient: failed to load removed record audit', { collectionName, recordId, error });
      }
    }

    const { updates, deletions } = this.#filterChangesToS2CLists(collectionName, changes, true);
    if (updates.length === 0 && deletions.length === 0) return;

    this.#logger?.debug('[s2c-conv] pushRecordsToClient: emitting S2C payload', {
      collectionName,
      updateIds: updates.map(u => u.record.id),
      deletionIds: deletions.map(d => d.recordId),
    });

    // Pre-set mirror rows only for records with NO existing mirror entry (genuinely new records).
    // This prevents a concurrent changeStream update for a brand-new record from being silently
    // dropped by the mirrorRow == null check in #filterChangesToS2CLists / onDbChange.
    // We must NOT pre-set existing records: if the client drops the S2C (e.g. hasPendingChanges),
    // the mirror must retain the old value so the next pushRecordsToClient call detects the
    // discrepancy (mirror != server) and re-delivers the update.
    const collectionMirror = this.#mirror.get(collectionName)!;
    const changeByRecordId = new Map(changes.filter(c => !c.deleted).map(c => [c.recordId, c]));
    for (const update of updates) {
      if (collectionMirror.has(update.record.id)) continue;
      const change = changeByRecordId.get(update.record.id);
      if (change != null) collectionMirror.set(update.record.id, { recordHash: change.recordHash, lastAuditEntryId: change.lastAuditEntryId });
    }

    await this.#emitS2CPayload([{ collectionName, updates, deletions }]);
  }

  /**
   * Run the catch-up snapshot (section 2.5).
   *
   * Enumerates every tracked `(collectionName, recordId)` in the mirror,
   * loads current server state, and emits a single S2C payload for any rows
   * where the mirror is stale. Only runs once per connection episode.
   */
  async catchUp(): Promise<void> {
    if (this.#noOp || this.#closed) return;
    if (!this.#pendingCatchUp) return;

    // If S2C is currently in flight, defer until the ack arrives
    if (this.#s2cInFlight) return;

    this.#pendingCatchUp = false;

    const db = this.#getDb?.();
    if (db == null) return;

    const payloadItems: MXDBServerToClientSyncPayloadItem[] = [];

    for (const [collectionName, recordMap] of this.#mirror) {
      if (recordMap.size === 0) continue;

      const recordIds = Array.from(recordMap.keys());
      const collection = db.use(collectionName);
      if (collection == null) continue;

      const updates: S2CUpdatedRecord[] = [];
      const deletions: S2CDeletedRecord[] = [];

      for (const recordId of recordIds) {
        const mirrorRow = recordMap.get(recordId);
        if (mirrorRow == null) continue;

        try {
          const serverRecord = await collection.get(recordId);
          const serverAudit = await collection.getAudit(recordId);

          if (serverRecord == null) {
            // Record has been deleted on the server
            if (serverAudit != null) {
              const lastEntryId = auditor.getLastEntryId(serverAudit);
              if (lastEntryId != null && (mirrorRow.lastAuditEntryId !== lastEntryId || mirrorRow.recordHash !== '')) {
                deletions.push({ recordId, lastAuditEntryId: lastEntryId });
              }
            }
            continue;
          }

          // Split-brain guard: serverRecord was read before a concurrent deletion committed,
          // serverAudit was read after — audit is the source of truth.
          if (serverAudit != null && auditor.isDeleted(serverAudit)) {
            const lastEntryId = auditor.getLastEntryId(serverAudit);
            if (lastEntryId != null && (mirrorRow.lastAuditEntryId !== lastEntryId || mirrorRow.recordHash !== '')) {
              deletions.push({ recordId, lastAuditEntryId: lastEntryId });
            }
            continue;
          }

          const serverHash = await hashRecord(serverRecord);
          const serverLastEntryId = serverAudit != null ? auditor.getLastEntryId(serverAudit) : undefined;

          // Apply the same gate as section 2.4
          const hashDiffers = mirrorRow.recordHash !== serverHash;
          const entryIdDiffers = serverLastEntryId != null && mirrorRow.lastAuditEntryId !== serverLastEntryId;

          if (hashDiffers || entryIdDiffers) {
            updates.push({
              record: serverRecord,
              lastAuditEntryId: serverLastEntryId ?? mirrorRow.lastAuditEntryId,
            });
          }
        } catch (error) {
          this.#logger?.error('Catch-up failed for record', { collectionName, recordId, error });
        }
      }

      if (updates.length > 0 || deletions.length > 0) {
        payloadItems.push({ collectionName, updates, deletions });
      }
    }

    if (payloadItems.length > 0) {
      await this.#emitS2CPayload(payloadItems);
    }
  }

  /**
   * Tear down this instance. No further emits will be attempted.
   *
   * Releases references to the emit callback, database accessor, and clears
   * the mirror and pending queue so the GC can reclaim connection-scoped
   * resources.
   */
  close(): void {
    this.#closed = true;
    this.#emitS2C = null;
    this.#getDb = null;
    this.#mirror.clear();
    this.#pendingMirrorQueue.length = 0;
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Build S2C update/deletion lists from server-side change descriptors and mirror rows.
   * @param includeUpdatesWhenMirrorMissing — DB change stream: false (only tracked rows). C2S follow-up: true.
   */
  #filterChangesToS2CLists(
    collectionName: string,
    changes: Array<{
      recordId: string;
      record?: Record;
      lastAuditEntryId: string;
      recordHash: string;
      deleted?: boolean;
    }>,
    includeUpdatesWhenMirrorMissing: boolean,
  ): { updates: S2CUpdatedRecord[]; deletions: S2CDeletedRecord[]; } {
    const collectionMirror = this.#mirror.get(collectionName);
    if (collectionMirror == null) {
      return { updates: [], deletions: [] };
    }

    const updates: S2CUpdatedRecord[] = [];
    const deletions: S2CDeletedRecord[] = [];

    for (const change of changes) {
      const mirrorRow = collectionMirror.get(change.recordId);

      if (change.deleted === true) {
        // if (mirrorRow == null) continue;
        // if (mirrorRow.recordHash === change.recordHash && mirrorRow.lastAuditEntryId === change.lastAuditEntryId) continue;
        deletions.push({ recordId: change.recordId, lastAuditEntryId: change.lastAuditEntryId });
        continue;
      }

      if (change.record == null) continue;

      if (mirrorRow == null) {
        if (includeUpdatesWhenMirrorMissing) {
          updates.push({ record: change.record, lastAuditEntryId: change.lastAuditEntryId });
        } else {
          this.#logger?.debug('[s2c-conv] filterChanges: dropping update — no mirror row for this record (client has not seeded it yet)', {
            collectionName, recordId: change.recordId,
          });
        }
        continue;
      }

      if (mirrorRow.recordHash === change.recordHash && mirrorRow.lastAuditEntryId === change.lastAuditEntryId) continue;

      updates.push({ record: change.record, lastAuditEntryId: change.lastAuditEntryId });
    }

    return { updates, deletions };
  }

  /** Apply a single entry directly into the mirror. */
  #applyMirrorEntry(collectionName: string, recordId: string, recordHash: string, lastAuditEntryId: string): void {
    let collectionMirror = this.#mirror.get(collectionName);
    if (collectionMirror == null) {
      collectionMirror = new Map();
      this.#mirror.set(collectionName, collectionMirror);
    }
    collectionMirror.set(recordId, { recordHash, lastAuditEntryId });
  }

  /** Drain the pending mirror queue into the live mirror (last-queued values win for duplicates). */
  #drainPendingMirrorQueue(): void {
    for (const entry of this.#pendingMirrorQueue) {
      this.#applyMirrorEntry(entry.collectionName, entry.recordId, entry.recordHash, entry.lastAuditEntryId);
    }
    this.#pendingMirrorQueue.length = 0;
  }

  /**
   * Enqueue an S2C payload emit. Serialises all emits via #emitQueue so only
   * one S2C round is ever in-flight at a time (section 2.6).
   */
  #emitS2CPayload(payload: MXDBServerToClientSyncPayload): Promise<void> {
    if (this.#noOp || this.#closed || this.#emitS2C == null) return Promise.resolve();
    this.#emitQueue = this.#emitQueue.then(() => this.#doEmitS2C(payload));
    return this.#emitQueue;
  }

  /**
   * Inner emit — runs serially via #emitQueue. Processes the ack (deletions
   * remove mirror rows, successes refresh from current server state, omissions
   * leave mirror unchanged), drains the pending mirror queue, and clears in-flight.
   *
   * If the emit fails while still connected, schedules catch-up recovery (section 2.7).
   */
  async #doEmitS2C(payload: MXDBServerToClientSyncPayload): Promise<void> {
    if (this.#noOp || this.#closed || this.#emitS2C == null) return;

    this.#s2cInFlight = true;

    try {
      const ack = await this.#emitS2C(payload);
      await this.#processAck(ack, payload);
    } catch (error) {
      this.#logger?.error('S2C emit failed', { error });

      // Section 2.7: if still connected (not closed), attempt catch-up recovery.
      // Fire-and-forget: catchUp enqueues onto #emitQueue, so we must not await it
      // from within #doEmitS2C (which itself runs on #emitQueue) to avoid a deadlock.
      if (!this.#closed) {
        this.#s2cInFlight = false;
        this.#drainPendingMirrorQueue();
        this.#pendingCatchUp = true;
        void this.catchUp().catch(catchUpError => {
          this.#logger?.error('S2C catch-up recovery also failed', { error: catchUpError });
        });
        return;
      }
    }

    this.#drainPendingMirrorQueue();
    this.#s2cInFlight = false;

    // If catch-up was deferred while S2C was in flight, run it now.
    // Fire-and-forget for the same reason as above: catchUp enqueues onto #emitQueue,
    // so awaiting it here (inside a #emitQueue task) would deadlock.
    if (this.#pendingCatchUp && !this.#closed) {
      void this.catchUp().catch(error => {
        this.#logger?.error('Deferred catch-up failed', { error });
      });
    }
  }

  /**
   * Process the client ack according to section 6.
   *
   * - `deletedRecordIds`: remove from mirror.
   * - `successfulRecordIds`: refresh mirror row from current server DB state.
   * - Omitted ids: leave mirror unchanged.
   */
  async #processAck(ack: ServerToClientSyncAck, payload: MXDBServerToClientSyncPayload): Promise<void> {
    const db = this.#getDb?.();
    if (db == null) return;

    for (const item of ack) {
      const collectionMirror = this.#mirror.get(item.collectionName);
      if (collectionMirror == null) continue;

      // Section 6.1: deletedRecordIds -> remove from mirror
      for (const recordId of item.deletedRecordIds) {
        collectionMirror.delete(recordId);
      }

      // Section 6.2: successfulRecordIds -> set mirror to SENT state, schedule catch-up if server advanced.
      // We intentionally mirror what was *sent* (not current server state) so that future onDbChange
      // comparisons detect any server changes that happened between emit and ack.
      if (item.successfulRecordIds.length > 0) {
        const collection = db.use(item.collectionName);
        if (collection == null) continue;

        // Build a lookup of what was sent in this payload for quick access.
        const sentPayloadItem = payload.find(p => p.collectionName === item.collectionName);
        const sentUpdateMap = new Map<string, { record: Record; lastAuditEntryId: string }>();
        if (sentPayloadItem != null) {
          for (const u of sentPayloadItem.updates) {
            sentUpdateMap.set(u.record.id, { record: u.record, lastAuditEntryId: u.lastAuditEntryId });
          }
        }

        for (const recordId of item.successfulRecordIds) {
          try {
            const serverRecord = await collection.get(recordId);
            const serverAudit = await collection.getAudit(recordId);

            if (serverRecord == null) {
              // Record was deleted between emit and ack (e.g. a stale resurrection push arrived
              // after a deletion was already committed). Do NOT clear the mirror row — leaving
              // it stale lets catchUp() detect the discrepancy and re-deliver the deletion.
              this.#pendingCatchUp = true;
              continue;
            }

            const serverLastEntryId = serverAudit != null ? auditor.getLastEntryId(serverAudit) : undefined;

            const sentUpdate = sentUpdateMap.get(recordId);
            if (sentUpdate != null) {
              // Set mirror to what was actually sent, so future onDbChange diffs are relative
              // to the client's current state (not a potentially newer server state).
              const sentHash = await hashRecord(sentUpdate.record);
              collectionMirror.set(recordId, {
                recordHash: sentHash,
                lastAuditEntryId: sentUpdate.lastAuditEntryId,
              });
              // If the server has moved on since we sent, schedule a catch-up so the client
              // receives the newer state.
              if (serverLastEntryId != null && serverLastEntryId !== sentUpdate.lastAuditEntryId) {
                this.#pendingCatchUp = true;
              }
            } else {
              // Sent via pushRecordsToClient (not this payload) — fall back to current server state.
              const serverHash = await hashRecord(serverRecord);
              if (serverLastEntryId != null) {
                collectionMirror.set(recordId, { recordHash: serverHash, lastAuditEntryId: serverLastEntryId });
              } else {
                // Audit-free collection: update hash, keep existing lastAuditEntryId
                const existing = collectionMirror.get(recordId);
                collectionMirror.set(recordId, {
                  recordHash: serverHash,
                  lastAuditEntryId: existing?.lastAuditEntryId ?? '',
                });
              }
            }
          } catch (error) {
            this.#logger?.error('Failed to refresh mirror row after ack', {
              collectionName: item.collectionName,
              recordId,
              error,
            });
          }
        }
      }

      // Section 6.3: detect silently-deferred deletions.
      // If the client deferred a deletion (hasPendingChanges=true at the time), it will be
      // absent from deletedRecordIds. Schedule a catchUp so the deletion is re-delivered once
      // the client's collapseAudit finishes and hasPendingChanges becomes false.
      const sentDeletionIds = payload.find(p => p.collectionName === item.collectionName)?.deletions.map(d => d.recordId) ?? [];
      const ackedDeletionIds = new Set(item.deletedRecordIds);
      const unansweredDeletions = sentDeletionIds.filter(id => !ackedDeletionIds.has(id));
      if (unansweredDeletions.length > 0) {
        this.#logger?.debug('S2C deletions deferred by client — scheduling catch-up', {
          collectionName: item.collectionName,
          unansweredDeletions,
        });
        this.#pendingCatchUp = true;
      }
    }
  }
}
