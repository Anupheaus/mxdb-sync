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

  /** C2S mirror seeds buffered while S2C is in flight (section 2.6). */
  #pendingMirrorQueue: PendingMirrorEntry[];

  /** True until the first catch-up has been dispatched for this connection episode. */
  #pendingCatchUp: boolean;

  /** True after {@link close} has been called. */
  #closed: boolean;

  // ── Public API ───────────────────────────────────────────────────────────

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

    if (this.#mirror.get(collectionName) == null) return;

    const { updates, deletions } = this.#filterChangesToS2CLists(collectionName, changes, false);
    if (updates.length === 0 && deletions.length === 0) return;

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
        if (!disableAudit) {
          const serverAudit = await collection.getAudit(recordId);
          lastAuditEntryId = serverAudit != null ? (auditor.getLastEntryId(serverAudit) ?? '') : '';
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

    // Pre-set mirror rows for every update we are about to send.
    // Without this, any deletion that arrives from the change stream while the
    // S2C round-trip is in flight would see mirrorRow == null and be silently
    // dropped by #filterChangesToS2CLists / onDbChange.
    const collectionMirror = this.#mirror.get(collectionName)!;
    const changeByRecordId = new Map(changes.filter(c => !c.deleted).map(c => [c.recordId, c]));
    for (const update of updates) {
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
   * Emit an S2C payload to the client and process the ack (section 2.6 / section 6).
   *
   * Sets the in-flight flag before emit, processes the ack (deletions remove
   * mirror rows, successes refresh from current server state, omissions leave
   * mirror unchanged), drains the pending mirror queue, and clears in-flight.
   *
   * If the emit fails while the connection is still open, schedules a
   * catch-up style recovery (section 2.7).
   */
  async #emitS2CPayload(payload: MXDBServerToClientSyncPayload): Promise<void> {
    if (this.#noOp || this.#closed || this.#emitS2C == null) return;

    this.#s2cInFlight = true;

    try {
      const ack = await this.#emitS2C(payload);
      await this.#processAck(ack);
    } catch (error) {
      this.#logger?.error('S2C emit failed', { error });

      // Section 2.7: if still connected (not closed), attempt catch-up recovery
      if (!this.#closed) {
        this.#s2cInFlight = false;
        this.#drainPendingMirrorQueue();
        this.#pendingCatchUp = true;
        try {
          await this.catchUp();
        } catch (catchUpError) {
          this.#logger?.error('S2C catch-up recovery also failed', { error: catchUpError });
        }
        return;
      }
    }

    this.#drainPendingMirrorQueue();
    this.#s2cInFlight = false;

    // If catch-up was deferred while S2C was in flight, run it now
    if (this.#pendingCatchUp && !this.#closed) {
      try {
        await this.catchUp();
      } catch (error) {
        this.#logger?.error('Deferred catch-up failed', { error });
      }
    }
  }

  /**
   * Process the client ack according to section 6.
   *
   * - `deletedRecordIds`: remove from mirror.
   * - `successfulRecordIds`: refresh mirror row from current server DB state.
   * - Omitted ids: leave mirror unchanged.
   */
  async #processAck(ack: ServerToClientSyncAck): Promise<void> {
    const db = this.#getDb?.();
    if (db == null) return;

    for (const item of ack) {
      const collectionMirror = this.#mirror.get(item.collectionName);
      if (collectionMirror == null) continue;

      // Section 6.1: deletedRecordIds -> remove from mirror
      for (const recordId of item.deletedRecordIds) {
        collectionMirror.delete(recordId);
      }

      // Section 6.2: successfulRecordIds -> refresh mirror from current server state
      if (item.successfulRecordIds.length > 0) {
        const collection = db.use(item.collectionName);
        if (collection == null) continue;

        for (const recordId of item.successfulRecordIds) {
          try {
            const serverRecord = await collection.get(recordId);
            const serverAudit = await collection.getAudit(recordId);

            if (serverRecord == null) {
              // Record was deleted between emit and ack. Do NOT clear the mirror row —
              // leaving it stale allows catchUp() or the next clientDbWatches delete
              // event to detect the discrepancy and deliver the deletion to the client.
              continue;
            }

            const serverHash = await hashRecord(serverRecord);
            const serverLastEntryId = serverAudit != null ? auditor.getLastEntryId(serverAudit) : undefined;

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
          } catch (error) {
            this.#logger?.error('Failed to refresh mirror row after ack', {
              collectionName: item.collectionName,
              recordId,
              error,
            });
          }
        }
      }
    }
  }
}
