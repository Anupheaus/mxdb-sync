import type { AnyObject, Logger } from '@anupheaus/common';
import { PromiseState, type DeferredPromise } from '@anupheaus/common';
import type { MXDBCollection } from '../../../common';
import type {
  ClientToServerSyncRequest,
  ClientToServerSyncResponse,
  ClientToServerQueueEntry,
  ClientToServerSyncRequestItem,
  ClientToServerSyncMirrorEntry,
  ClientToServerSyncUpdate,
} from '../../../common/models';
import { auditor, AuditEntryType } from '../../../common';
import { hashRecord, contentHash } from '../../../common/auditor/hash';
import type { Db } from '../dbs';

/**
 * Debounced client-to-server sync queue (§4 of client-to-server-synchronisation.md).
 *
 * Framework-agnostic — no React imports. One instance per MXDBSync mount.
 * Accumulates local mutations via `enqueue()`, then flushes them to the server
 * in batched `mxdbClientToServerSyncAction` requests after a configurable debounce window.
 */
export interface ClientToServerSynchronisationProps {
  debounceMs: number;
  sendBatch: (request: ClientToServerSyncRequest) => Promise<ClientToServerSyncResponse>;
  getDb: () => Db;
  collections: MXDBCollection[];
  logger?: Logger;
  onError?: (error: unknown) => void;
}

export class ClientToServerSynchronisation {
  constructor(props: ClientToServerSynchronisationProps) {
    this.#debounceMs = props.debounceMs;
    this.#sendBatch = props.sendBatch;
    this.#getDb = props.getDb;
    this.#collections = props.collections;
    this.#logger = props.logger;
    this.#onError = props.onError;

    this.#queue = new Map();
    this.#reconnectEntries = new Map();
    this.#connected = false;
    this.#syncInProgress = false;
    this.#fullFlushInProgress = false;
    this.#debounceHandle = undefined;
    this.#closed = false;
    this.#s2cGate = Promise.createDeferred();
    this.#s2cGate.resolve(); // gate starts open
    this.#syncStateListeners = new Set();
  }

  // ─── Internal state ──────────────────────────────────────────────────────────

  readonly #debounceMs: number;
  readonly #sendBatch: (request: ClientToServerSyncRequest) => Promise<ClientToServerSyncResponse>;
  readonly #getDb: () => Db;
  readonly #collections: MXDBCollection[];
  readonly #logger: Logger | undefined;
  readonly #onError: ((error: unknown) => void) | undefined;

  #queue: Map<string, ClientToServerQueueEntry>;
  /** Per-collection mirror seed entries collected during fullFlush, consumed by the next #buildRequest. */
  #reconnectEntries: Map<string, ClientToServerSyncMirrorEntry[]>;
  #connected: boolean;
  #syncInProgress: boolean;
  /** True while fullFlush is running; prevents a stale debounce finally-block from clearing sync state mid-scan. */
  #fullFlushInProgress: boolean;
  #debounceHandle: ReturnType<typeof setTimeout> | undefined;
  #closed: boolean;
  #s2cGate: DeferredPromise<void>;
  #syncStateListeners: Set<(isSyncing: boolean) => void>;
  /** Bumped when the socket goes away (or the instance closes) while a flush is in flight; stale `#flush` continuations must not run success/failure handlers. */
  #flushEpoch = 0;

  // ─── Public API ──────────────────────────────────────────────────────────────

  /**
   * §4.3 — Notify the instance of a connection state change.
   * Called by the host (ClientToServerSyncProvider) when the socket goes online/offline.
   */
  setConnected(isConnected: boolean): void {
    if (this.#closed) return;
    const wasConnected = this.#connected;
    this.#connected = isConnected;

    if (!isConnected) {
      // Went offline: clear any pending debounce timeout
      this.#clearDebounce();
      // If a batch is mid-flight, drop sync state immediately so the UI is not stuck on
      // `isSynchronising` until the socket action times out; the in-flight promise may
      // still settle later and must ignore results once `#flushEpoch` has moved on.
      if (this.#syncInProgress) {
        this.#flushEpoch += 1;
        if (this.#s2cGate.state === PromiseState.Pending) {
          this.#s2cGate.resolve();
        }
        this.#setSyncInProgress(false);
      }
    } else if (!wasConnected) {
      // Reconnected: run a full flush (scans all local records, seeds mirror, syncs pending changes)
      void this.#fullFlush();
    }
  }

  /**
   * Full flush — called on connect and every reconnect.
   *
   * Scans every configured collection for local records:
   * - Those with pending audit changes are enqueued for C2S sync.
   * - Those without pending changes are collected as mirror seed entries, which
   *   are included in the outgoing batch so the server can seed its S2C mirror
   *   and detect any stale records the client holds.
   *
   * Holds `#syncInProgress` for the duration so no concurrent debounced flush
   * can start and the S2C gate is closed until the batch completes.
   */
  async #fullFlush(): Promise<void> {
    if (this.#closed) return;

    this.#clearDebounce();
    // Bump epoch so any in-flight regular flush treats its response as stale
    this.#flushEpoch += 1;
    this.#fullFlushInProgress = true;
    this.#setSyncInProgress(true);

    try {
      const db = this.#getDb();

      // Reset reconnect entries — fresh scan each time
      this.#reconnectEntries.clear();

      for (const collection of this.#collections) {
        const collectionName = collection.name;
        const allAudits = await db.use(collectionName).getAllAudits();

        for (const audit of allAudits) {
          if (auditor.hasPendingChanges(audit)) {
            // Has pending changes — enqueue for C2S sync
            const record = await db.use(collectionName).get(audit.id);
            const recordHash = record != null
              ? await hashRecord(record)
              : contentHash(null);

            const lastAuditEntryId = auditor.getLastEntryId(audit);
            if (lastAuditEntryId == null) {
              this.#logger?.error('fullFlush: audit has pending changes but no last entry id', { collectionName, recordId: audit.id });
              continue;
            }

            this.enqueue({ collectionName, recordId: audit.id, recordHash, lastAuditEntryId });
          } else {
            // No pending changes — seed the server mirror so it can push deletions for stale records
            const record = await db.use(collectionName).get(audit.id);
            if (record == null) continue; // no live record, nothing to seed

            const recordHash = await hashRecord(record);
            const lastAuditEntryId = auditor.getLastEntryId(audit) ?? '';

            let collectionEntries = this.#reconnectEntries.get(collectionName);
            if (collectionEntries == null) {
              collectionEntries = [];
              this.#reconnectEntries.set(collectionName, collectionEntries);
            }
            collectionEntries.push({ recordId: audit.id, recordHash, lastAuditEntryId });
          }
        }
      }

      await this.#flush();
    } catch (error) {
      this.#recordError('fullFlush: unhandled error', { error });
    } finally {
      this.#fullFlushInProgress = false;
      this.#setSyncInProgress(false);
      this.#scheduleDebounce();
    }
  }

  /**
   * Add or update a queue entry for a record that has local changes to push (§4.5).
   *
   * Deduplicates by `(collectionName, recordId)` using §4.6 rules: the entry with
   * the lexicographically greater `lastAuditEntryId` wins. If connected and not
   * syncing, resets the debounce timer (§4.7).
   */
  enqueue(entry: ClientToServerQueueEntry): void {
    if (this.#closed) return;

    const key = `${entry.collectionName}::${entry.recordId}`;
    const existing = this.#queue.get(key);

    if (existing != null) {
      if (entry.lastAuditEntryId > existing.lastAuditEntryId) {
        // Incoming is newer — replace
        this.#queue.set(key, { ...entry });
      } else if (entry.lastAuditEntryId < existing.lastAuditEntryId) {
        // Incoming is older — this should not happen; log an error but do not throw (§4.6)
        this.#recordError('enqueue: incoming lastAuditEntryId is older than stored — possible ordering violation', {
          collectionName: entry.collectionName,
          recordId: entry.recordId,
          incomingId: entry.lastAuditEntryId,
          storedId: existing.lastAuditEntryId,
        });
        // Keep existing entry unchanged
      }
      // If equal, either hash describes the same row; keep existing
    } else {
      this.#queue.set(key, { ...entry });
    }

    // §4.7: arm or reset the debounce timer only while connected AND not syncing
    if (this.#connected && !this.#syncInProgress) {
      this.#scheduleDebounce();
    }
  }

  /**
   * Returns the current S2C admission gate promise (§4.9.2 step 6).
   *
   * The `ServerToClientProvider` must await this before applying any incoming
   * S2C payload so that local collapses finish first.
   */
  waitForS2CGate(): Promise<void> {
    return this.#s2cGate;
  }

  /** Whether a sync flush is currently in progress. */
  get isSyncing(): boolean {
    return this.#syncInProgress;
  }

  /**
   * Distinct `(collectionName, recordId)` keys still queued for a debounced C2S flush
   * (entries remain until the server ACK prunes matching snapshot rows).
   */
  get pendingQueueEntryCount(): number {
    return this.#queue.size;
  }

  /**
   * Register a listener that fires whenever the sync-in-progress state changes.
   * Returns an unsubscribe function.
   */
  onSyncStateChanged(listener: (isSyncing: boolean) => void): () => void {
    this.#syncStateListeners.add(listener);
    return () => { this.#syncStateListeners.delete(listener); };
  }

  /**
   * Tear down the instance (§4.1 unmount).
   *
   * Clears any pending debounce timeout, resolves the S2C gate if pending,
   * and marks the instance as terminated so no further flushes occur.
   */
  close(): void {
    this.#closed = true;
    this.#clearDebounce();

    if (this.#syncInProgress) this.#flushEpoch += 1;
    this.#setSyncInProgress(false);

    this.#syncStateListeners.clear();
  }

  // ─── Private: sync state ────────────────────────────────────────────────────

  #setSyncInProgress(value: boolean): void {
    if (this.#syncInProgress === value) return;
    this.#syncInProgress = value;
    if (value === true) {
      // Close the S2C gate (replace deferred with an unresolved one)
      this.#s2cGate = Promise.createDeferred();
    } else {
      // Resolve the S2C gate so nothing is left stuck
      this.#s2cGate.resolve();
    }
    for (const listener of this.#syncStateListeners) listener(value);
  }

  // ─── Private: debounce management ────────────────────────────────────────────

  #clearDebounce(): void {
    if (this.#debounceHandle != null) {
      clearTimeout(this.#debounceHandle);
      this.#debounceHandle = undefined;
    }
  }

  /** Clear any existing timeout, then set a new one from "now" if connected and queue is non-empty. */
  #scheduleDebounce(): void {
    this.#clearDebounce();
    if (!this.#connected || this.#queue.size === 0) return;
    this.#debounceHandle = setTimeout(() => {
      this.#debounceHandle = undefined;
      if (this.#syncInProgress) return;
      (async () => {
        try {
          this.#setSyncInProgress(true);
          await this.#flush();
        } catch (error) {
          this.#recordError('flush timer: unhandled error', { error });
        } finally {
          // If fullFlush took over mid-flight, leave sync state and scheduling to it
          if (!this.#fullFlushInProgress) {
            this.#setSyncInProgress(false);
            this.#scheduleDebounce();
          }
        }
      })();
    }, this.#debounceMs);
  }

  // ─── Private: flush (debounce fired) ─────────────────────────────────────────

  async #flush(): Promise<void> {
    if (this.#closed) return;

    // Re-check connected; if offline, abort (§4.7 timer-fire guard)
    if (!this.#connected) return;

    // §4.7 step 1: snapshot the queue (clone entries so mutations don't affect snapshot)
    const snapshot = new Map<string, ClientToServerQueueEntry>();
    for (const [key, entry] of this.#queue) {
      snapshot.set(key, { ...entry });
    }

    if (snapshot.size === 0 && this.#reconnectEntries.size === 0) return;

    // §6: Build the ClientToServerSyncRequest from the snapshot (+ any reconnect entries)
    const request = await this.#buildRequest(snapshot);
    this.#logger?.silly('flush: request', { request });

    // If building produced no items, abort
    if (request.length === 0) {
      this.#recordError('flush: request building produced no items despite non-empty queue or reconnect entries');
      return;
    }

    // If disconnected during building, abort
    if (!this.#connected) return;

    const atSendEpoch = this.#flushEpoch;

    try {
      // §4.7 step 3: Send the batch and await the response
      const response = await this.#sendBatch(request);

      if (this.#flushEpoch !== atSendEpoch) {
        return;
      }

      // §4.9: Handle success (phases A-C)
      await this.#handleSuccess(snapshot, response);
    } catch (error) {
      if (this.#flushEpoch !== atSendEpoch) return;
      this.#recordError('flush: sendBatch failed', { error });
    }
  }

  // ─── Private: build request (§6) ─────────────────────────────────────────────

  async #buildRequest(snapshot: Map<string, ClientToServerQueueEntry>): Promise<ClientToServerSyncRequest> {
    const db = this.#getDb();
    const byCollection = new Map<string, { updates: ClientToServerSyncUpdate[]; entries: ClientToServerSyncMirrorEntry[]; }>();

    for (const [, entry] of snapshot) {
      const { collectionName, recordId, recordHash, lastAuditEntryId } = entry;

      // §6.1: Load the current AuditOf from local storage
      const audit = await db.use(collectionName).getAudit(recordId);
      if (audit == null) {
        this.#recordError('buildRequest: audit not found for record — skipping', { collectionName, recordId });
        continue;
      }

      const entries = audit.entries;

      // §6.2 step 1: Find index i where entries[i].id === lastAuditEntryId
      const capIndex = entries.findIndex(e => e.id === lastAuditEntryId);
      if (capIndex < 0) {
        this.#recordError('buildRequest: lastAuditEntryId not found in audit entries — skipping', {
          collectionName, recordId, lastAuditEntryId,
        });
        continue;
      }

      // §6.2 step 2: Take subarray entries[0..capIndex] inclusive
      const slice = entries.slice(0, capIndex + 1);

      // §6.2 step 3: Remove every Branched entry
      const filteredSlice = slice.filter(e => e.type !== AuditEntryType.Branched);

      // §6.2: If filtered slice is empty, treat as error and skip
      if (filteredSlice.length === 0) {
        this.#recordError('buildRequest: filtered slice is empty after removing Branched entries — skipping', {
          collectionName, recordId, lastAuditEntryId,
        });
        continue;
      }

      const update: ClientToServerSyncUpdate = {
        recordId,
        recordHash,
        entries: filteredSlice,
      };

      if (!byCollection.has(collectionName)) {
        byCollection.set(collectionName, { updates: [], entries: [] });
      }
      byCollection.get(collectionName)!.updates.push(update);
    }

    // Consume reconnect entries — skip any recordId already covered by the queue snapshot
    const snapshotIds = new Set(Array.from(snapshot.values()).map(e => `${e.collectionName}::${e.recordId}`));
    for (const [collectionName, mirrorEntries] of this.#reconnectEntries) {
      let item = byCollection.get(collectionName);
      if (item == null) {
        item = { updates: [], entries: [] };
        byCollection.set(collectionName, item);
      }
      for (const e of mirrorEntries) {
        if (!snapshotIds.has(`${collectionName}::${e.recordId}`)) {
          item.entries.push(e);
        }
      }
    }
    this.#reconnectEntries.clear();

    // Group into per-collection request items
    const request: ClientToServerSyncRequest = [];
    for (const [collectionName, { updates, entries }] of byCollection) {
      const item: ClientToServerSyncRequestItem = {
        collectionName,
        updates,
        ...(entries.length > 0 ? { entries } : {}),
      };
      request.push(item);
    }
    return request;
  }

  // ─── Private: success handling (§4.9 phases A-C) ─────────────────────────────

  async #handleSuccess(
    snapshot: Map<string, ClientToServerQueueEntry>,
    response: ClientToServerSyncResponse,
  ): Promise<void> {
    const db = this.#getDb();

    // ── Phase A: Queue prune (§4.9.1) ──────────────────────────────────────────

    // Build set S of (collectionName, recordId) from response successfulRecordIds
    const successfulPairs = new Set<string>();
    for (const item of response) {
      for (const recordId of item.successfulRecordIds) {
        successfulPairs.add(`${item.collectionName}::${recordId}`);
      }
    }

    // For each pair in S, if current queue entry matches snapshot exactly, remove it
    for (const key of successfulPairs) {
      const snapshotEntry = snapshot.get(key);
      if (snapshotEntry == null) continue; // defensive — should not happen

      const currentEntry = this.#queue.get(key);
      if (currentEntry != null && this.#entriesMatch(currentEntry, snapshotEntry)) {
        this.#queue.delete(key);
      }
      // If not matching or not present, keep (§4.9.1 steps 3-4)
    }

    // ── Phase B: Collapse ─────────────────────────────────


    await Array.from(successfulPairs.keys()).mapAsync(async key => {
      try {
        const snapshotEntry = snapshot.get(key);
        if (snapshotEntry == null) return;

        // Only collapse if the current queue entry was removed (i.e. still matches snapshot)
        // The check: the key was in the queue and matched the snapshot — which means we deleted it above.
        // Re-check: if the key is NOT in the queue now, the entry matched and was pruned.
        // If the key IS still in the queue, fields changed since snapshot — do not collapse.
        if (this.#queue.has(key)) return;

        const { collectionName, recordId, lastAuditEntryId } = snapshotEntry;
        await db.use(collectionName).collapseAudit(recordId, lastAuditEntryId);
      } catch (error) {
        this.#recordError('handleSuccess: collapseAudit failed', { error });
      }
    });
  }

  // ─── Private: failure handling (§4.10) ───────────────────────────────────────

  #recordError(message: string, meta?: AnyObject): void {
    this.#logger?.error(message, meta);
    const error = meta?.error;
    if (error == null) return;
    this.#onError?.(error);
  }

  // ─── Private: helpers ────────────────────────────────────────────────────────

  /** Check whether two queue entries match on all four fields (§4.9.1 step 2). */
  #entriesMatch(a: ClientToServerQueueEntry, b: ClientToServerQueueEntry): boolean {
    return (
      a.collectionName === b.collectionName &&
      a.recordId === b.recordId &&
      a.recordHash === b.recordHash &&
      a.lastAuditEntryId === b.lastAuditEntryId
    );
  }
}
