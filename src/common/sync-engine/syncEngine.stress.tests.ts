/**
 * Sync Engine Stress Test
 *
 * 12 clients, 1 server, 20 initial records.
 * Each client randomly creates, updates, and deletes records for 30s.
 * Network transport: 0–80ms delay, 5% failure rate on each direction.
 * No artificial pauses or re-enqueues — the engine must converge on its own.
 *
 * Pass criteria:
 *   (a) All clients converge to server state after settling
 *   (b) At least 3 network failures occurred
 *   (c) Creates, updates, and deletes all occurred
 */
import { describe, it, expect } from 'vitest';
import '@anupheaus/common';
import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import { auditor } from '../auditor';
import { hashRecord, deterministicJson } from '../auditor/hash';
import {
  ClientDispatcher,
  ClientReceiver,
  ServerDispatcher,
  ServerReceiver,
  SyncPausedError,
  type MXDBRecordStates,
  type MXDBRecordStatesRequest,
  type MXDBUpdateRequest,
  type MXDBSyncEngineResponse,
  type ClientDispatcherRequest,
  type MXDBRecordCursors,
} from '.';
import type { AuditEntry, AuditOf } from '../auditor';

// ─── Types ────────────────────────────────────────────────────────────────────

type ItemRecord = MXDBRecord & {
  name: string;
  counter: number;
  tags: string[];
  nested: { value: number; label: string };
};

/** Active record stored locally */
type ActiveStoreEntry = { record: ItemRecord; audit: AuditEntry[] };

/**
 * Pending-deleted record: retained in store until the server ACKs the deletion
 * so that CD can dispatch the deletion in the next C2S round-trip.
 */
type DeletedStoreEntry = { deleted: true; audit: AuditEntry[] };

type StoreEntry = ActiveStoreEntry | DeletedStoreEntry;
type CollectionStore = Map<string, StoreEntry>; // recordId → entry
type ClientStore = Map<string, CollectionStore>; // collectionName → collection

const COLLECTION_NAME = 'items';
const NUM_CLIENTS = 12;
const NUM_INITIAL_RECORDS = 20;
const UPDATE_DURATION_MS = 30_000;
const SETTLE_TIMEOUT_MS = 120_000;
const MIN_UPDATE_INTERVAL_MS = 50;
const MAX_UPDATE_INTERVAL_MS = 200;
const NETWORK_MAX_DELAY_MS = 80;
const NETWORK_FAILURE_RATE = 0.05;

// ─── Logger ───────────────────────────────────────────────────────────────────

// Logs are buffered here; on test failure the last N lines per component are
// dumped to stderr so we can trace what happened to stuck records.
const logBuffer: string[] = [];
const LOG_BUFFER_MAX = 200000;
const loggedErrors: string[] = [];

function makeLogger(name: string): Logger {
  // eslint-disable-next-line no-console
  const emit = (level: string, msg: string, ...args: unknown[]) => {
    const line = `[${name}][${level}] ${msg}${args.length ? ' ' + args.map(a => JSON.stringify(a)).join(' ') : ''}`;
    logBuffer.push(line);
    if (logBuffer.length > LOG_BUFFER_MAX) logBuffer.splice(0, LOG_BUFFER_MAX / 2);
  };
  return {
    debug: (msg: string, ...args: unknown[]) => emit('D', msg, ...args),
    info: (msg: string, ...args: unknown[]) => emit('I', msg, ...args),
    warn: (msg: string, ...args: unknown[]) => emit('W', msg, ...args),
    error: (msg: string, ...args: unknown[]) => {
      emit('E', msg, ...args);
      const line = `[${name}] ${msg}${args.length ? ' ' + args.map(a => {
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(' ') : ''}`;
      loggedErrors.push(line);
      // eslint-disable-next-line no-console
      console.error(line);
    },
    silly: () => {},
  } as unknown as Logger;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function randomDelay(min: number, max: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, min + Math.random() * (max - min)));
}

function makeInitialRecord(id: string, index: number): ItemRecord {
  return {
    id,
    name: `item-${index}`,
    counter: 0,
    tags: [`tag-${index}`],
    nested: { value: index, label: `label-${index}` },
  };
}

function isActiveEntry(entry: StoreEntry): entry is ActiveStoreEntry {
  return !('deleted' in entry);
}

/**
 * Read specific record states from the store (used by CD's onPayloadRequest and CR's onRetrieve).
 * Returns both active and deleted-pending entries so that CD can dispatch deletions.
 */
function readStateFromStore(store: ClientStore, request: MXDBRecordStatesRequest): MXDBRecordStates {
  return request.map(req => {
    const col = store.get(req.collectionName);
    const records: MXDBRecordStates[0]['records'] = [];
    for (const id of req.recordIds) {
      const entry = col?.get(id);
      if (entry == null) continue;
      if (isActiveEntry(entry)) {
        records.push({ record: entry.record, audit: entry.audit });
      } else {
        records.push({ recordId: id, audit: entry.audit });
      }
    }
    return { collectionName: req.collectionName, records };
  });
}

/**
 * Read all record states from the store (used by CD's onStart for initial sync).
 * Includes both active and deleted-pending entries.
 */
function readAllStateFromStore(store: ClientStore): MXDBRecordStates {
  const result: MXDBRecordStates = [];
  for (const [collName, col] of store) {
    const records: MXDBRecordStates[0]['records'] = [];
    for (const [id, entry] of col) {
      if (isActiveEntry(entry)) {
        records.push({ record: entry.record, audit: entry.audit });
      } else {
        records.push({ recordId: id, audit: entry.audit });
      }
    }
    result.push({ collectionName: collName, records });
  }
  return result;
}

/**
 * Apply an onUpdate callback result to the client store.
 *
 * Active-record updates: collapse audit to the new Branched anchor and replay any
 * pending local entries on top of the server record.
 * Deletions (server ACK or S2C push): remove from store entirely.
 */
function applyClientUpdate(store: ClientStore, updates: MXDBUpdateRequest, allowCreate = true): void {
  for (const update of updates) {
    let col = store.get(update.collectionName);
    if (col == null) {
      col = new Map();
      store.set(update.collectionName, col);
    }

    // Server-confirmed deletions (own C2S ACK or S2C push).  Retain the entry as
    // a tombstone — erasing it would let a late-arriving active cursor resurrect the
    // record via CR's "no local state + active cursor → accept" branch.  The tombstone
    // gives CR enough signal (via `isActiveRecordState === false`) to refuse resurrection.
    for (const id of update.deletedRecordIds ?? []) {
      const existing = col.get(id);
      const priorAudit = existing != null
        ? (isActiveEntry(existing) ? existing.audit : existing.audit)
        : [];
      col.set(id, { deleted: true, audit: priorAudit });
    }

    // Active-record updates
    for (const rec of update.records ?? []) {
      const existing = col.get(rec.record.id);

      // If locally marked for deletion, don't overwrite the pending delete with an
      // older server snapshot (CR would have blocked the S2C; this guards CD's ACK path).
      if (existing != null && !isActiveEntry(existing)) continue;

      // When called from CD's onUpdate (allowCreate=false), don't re-create a record
      // that was concurrently deleted by an S2C push while the C2S dispatch was in-flight.
      // The S2C path already removed the record from the store; resurrecting it here
      // would leave it permanently active since SD already added it to deletedRecordIds.
      if (!allowCreate && existing == null) continue;


      const existingAudit = (existing as ActiveStoreEntry | undefined)?.audit ?? [];

      // Stale guard: skip if local anchor is already newer than what this update anchors to.
      const existingBranchUlid = auditor.getBranchUlid({ id: rec.record.id, entries: existingAudit as any }) ?? '';
      if (existingBranchUlid > rec.lastAuditEntryId) continue;

      // Collapse audit to new Branched anchor, preserving any pending entries after it.
      const collapsed = auditor.collapseToAnchor(
        { id: rec.record.id, entries: existingAudit as any },
        rec.lastAuditEntryId,
      );

      // Replay pending entries on top of the server record to obtain the merged local view.
      const localRecord = (auditor.createRecordFrom(
        { id: rec.record.id, entries: collapsed.entries } as any,
        rec.record as ItemRecord,
      ) ?? rec.record) as ItemRecord;

      col.set(rec.record.id, {
        record: localRecord,
        audit: collapsed.entries as AuditEntry[],
      });
    }
  }
}

/**
 * Persist SR-processed states to the server store and build a broadcast payload
 * so that all other clients' SDs are notified.
 *
 * Deleted records are retained as tombstones (`{ deleted: true, audit }`).
 * This lets SR later retrieve the deletion audit so it can correctly merge a
 * concurrent client update against a server-deleted record (the merged result
 * stays deleted, and SR pushes a deletion cursor back to that client).
 */
async function applyServerUpdate(
  store: ClientStore,
  updates: MXDBRecordStates,
): Promise<{ response: MXDBSyncEngineResponse; broadcastPayload: MXDBRecordCursors }> {
  const response: MXDBSyncEngineResponse = [];
  const broadcastPayload: MXDBRecordCursors = [];

  for (const col of updates) {
    const colStore = store.get(col.collectionName) ?? new Map<string, StoreEntry>();
    store.set(col.collectionName, colStore);
    const successIds: string[] = [];
    const broadcastRecords: MXDBRecordCursors[0]['records'] = [];

    for (const state of col.records) {
      if ('record' in state) {
        const record = state.record as ItemRecord;
        colStore.set(record.id, { record, audit: state.audit });
        successIds.push(record.id);

        const hash = await hashRecord(record);
        const sortedAudit = [...state.audit].sort((a, b) => (a as any).id < (b as any).id ? -1 : 1);
        const lastAuditEntryId = (sortedAudit[sortedAudit.length - 1] as any)?.id ?? '';
        (broadcastRecords as any[]).push({ record, lastAuditEntryId, hash });
      } else {
        // Keep as tombstone so SR can retrieve the deletion audit for future merges
        colStore.set(state.recordId, { deleted: true, audit: state.audit });
        successIds.push(state.recordId);

        const sortedAudit = [...state.audit].sort((a, b) => (a as any).id < (b as any).id ? -1 : 1);
        const lastAuditEntryId = (sortedAudit[sortedAudit.length - 1] as any)?.id ?? '';
        broadcastRecords.push({ recordId: state.recordId, lastAuditEntryId });
      }
    }

    response.push({ collectionName: col.collectionName, successfulRecordIds: successIds });
    if (broadcastRecords.length > 0) {
      broadcastPayload.push({ collectionName: col.collectionName, records: broadcastRecords });
    }
  }

  return { response, broadcastPayload };
}

/**
 * Convergence check: the set of active records on the server must exactly match
 * the set of active records on each client (same IDs, same content).
 * Pending-deleted entries in client stores are ignored — they represent deletions
 * in transit that have already been applied on the server.
 */
function isConverged(serverStore: ClientStore, clientStores: ClientStore[]): boolean {
  const serverCol = serverStore.get(COLLECTION_NAME) ?? new Map<string, StoreEntry>();

  // Server only ever holds active entries (deletions remove the map key)
  const serverActive = new Map<string, ItemRecord>();
  for (const [id, entry] of serverCol) {
    if (isActiveEntry(entry)) serverActive.set(id, entry.record);
  }

  for (const clientStore of clientStores) {
    const clientCol = clientStore.get(COLLECTION_NAME) ?? new Map<string, StoreEntry>();

    const clientActive = new Map<string, ItemRecord>();
    for (const [id, entry] of clientCol) {
      if (isActiveEntry(entry)) clientActive.set(id, entry.record);
    }

    // Every server record must be present in the client with matching content
    for (const [id, serverRecord] of serverActive) {
      const clientRecord = clientActive.get(id);
      if (clientRecord == null) return false;
      if (deterministicJson(serverRecord) !== deterministicJson(clientRecord)) return false;
    }

    // Client must not have active records the server doesn't know about (unsynced creates)
    for (const id of clientActive.keys()) {
      if (!serverActive.has(id)) return false;
    }
  }

  return true;
}

// ─── Stress test ─────────────────────────────────────────────────────────────

describe('sync engine stress test', () => {
  it('12 clients converge with server after 30s of creates, updates, and deletes', { timeout: 200_000 }, async () => {
    logBuffer.length = 0;
    loggedErrors.length = 0;

    // ── Server setup ────────────────────────────────────────────────────────

    const serverStore: ClientStore = new Map();
    const serverCol = new Map<string, StoreEntry>();
    serverStore.set(COLLECTION_NAME, serverCol);

    // Serialise all SR.process() calls so that the read-modify-write cycle is
    // atomic.  In production this is handled by database transactions; here the
    // in-memory store requires explicit serialisation to prevent stale reads from
    // one SR instance racing with the writes of another.
    let serverProcessMutex: Promise<void> = Promise.resolve();

    const initialRecordIds = Array.from(
      { length: NUM_INITIAL_RECORDS },
      (_, i) => `record-${i.toString().padStart(3, '0')}`,
    );
    for (let i = 0; i < NUM_INITIAL_RECORDS; i++) {
      const record = makeInitialRecord(initialRecordIds[i], i);
      const audit = auditor.createAuditFrom(record);
      serverCol.set(record.id, { record, audit: audit.entries as AuditEntry[] });
    }

    // ── Operation counters ──────────────────────────────────────────────────

    let networkFailureCount = 0;
    let createCount = 0;
    let updateCount = 0;
    let deleteCount = 0;

    // ── Client setup ────────────────────────────────────────────────────────

    const clientStores: ClientStore[] = [];
    const clientReceivers: ClientReceiver[] = [];

    for (let clientIdx = 0; clientIdx < NUM_CLIENTS; clientIdx++) {
      const clientStore: ClientStore = new Map();
      const clientCol = new Map<string, StoreEntry>();
      clientStore.set(COLLECTION_NAME, clientCol);

      // Bootstrap each client with Branched-anchor audits from server initial state
      for (const [id, entry] of serverCol) {
        const serverAudit = { id, entries: (entry as ActiveStoreEntry).audit };
        const lastEntryId = auditor.getLastEntryId(serverAudit)!;
        const branchedAudit = auditor.collapseToAnchor(serverAudit, lastEntryId);
        clientCol.set(id, {
          record: { ...(entry as ActiveStoreEntry).record },
          audit: branchedAudit.entries as AuditEntry[],
        });
      }

      clientStores.push(clientStore);

      const cr = new ClientReceiver(makeLogger(`cr-${clientIdx}`), {
        onRetrieve: req => readStateFromStore(clientStore, req) as any,
        onUpdate: updates => {
          applyClientUpdate(clientStore, updates);
          const response: MXDBSyncEngineResponse = [];
          for (const u of updates) {
            response.push({
              collectionName: u.collectionName,
              successfulRecordIds: [
                ...(u.deletedRecordIds ?? []),
                ...(u.records?.map(r => r.record.id) ?? []),
              ],
            });
          }
          return response;
        },
      });
      clientReceivers.push(cr);
    }

    // ── Server-side components (one SD + SR + CD per client) ─────────────────

    const serverDispatchers: ServerDispatcher[] = [];
    const serverReceivers: ServerReceiver[] = [];
    const clientDispatchers: ClientDispatcher[] = [];

    for (let clientIdx = 0; clientIdx < NUM_CLIENTS; clientIdx++) {
      const cr = clientReceivers[clientIdx];
      const clientStore = clientStores[clientIdx];

      const sd = new ServerDispatcher(makeLogger(`sd-${clientIdx}`), {
        onDispatch: async (payload: MXDBRecordCursors) => {
          // Simulate S2C network: random delay + 5% failure
          await randomDelay(0, NETWORK_MAX_DELAY_MS);
          if (Math.random() < NETWORK_FAILURE_RATE) {
            networkFailureCount++;
            // SyncPausedError causes SD to retry — matches real behaviour when CR is busy
            throw new SyncPausedError();
          }
          return cr.process(payload);
        },
        retryInterval: 250,
      });

      const sr = new ServerReceiver(makeLogger(`sr-${clientIdx}`), {
        onRetrieve: async req => {
          const result: MXDBRecordStates = [];
          for (const reqCol of req) {
            const col = serverStore.get(reqCol.collectionName);
            const records: MXDBRecordStates[0]['records'] = [];
            for (const id of reqCol.recordIds) {
              const entry = col?.get(id);
              if (entry == null) continue;
              if (isActiveEntry(entry)) {
                records.push({ record: entry.record, audit: entry.audit });
              } else {
                // Return tombstone so SR can merge a client update against a deletion
                records.push({ recordId: id, audit: entry.audit });
              }
            }
            result.push({ collectionName: reqCol.collectionName, records });
          }
          return result;
        },
        onUpdate: async states => {
          const { response, broadcastPayload } = await applyServerUpdate(serverStore, states);

          // Broadcast to all clients' SDs — including the originator.  The originator's
          // SD filter is responsible for suppressing redundant pushes; the server does not
          // know which client originated a given change in production.
          if (broadcastPayload.length > 0) {
            for (let i = 0; i < serverDispatchers.length; i++) {
              serverDispatchers[i].push(broadcastPayload);
            }
          }

          return response;
        },
        serverDispatcher: sd,
      });

      const cd = new ClientDispatcher(makeLogger(`cd-${clientIdx}`), {
        clientReceiver: cr,
        onPayloadRequest: req => readStateFromStore(clientStore, req) as any,
        onDispatching: () => {},
        onDispatch: async (payload: ClientDispatcherRequest) => {
          // Simulate C2S network: random delay + 5% failure
          await randomDelay(0, NETWORK_MAX_DELAY_MS);
          if (Math.random() < NETWORK_FAILURE_RATE) {
            networkFailureCount++;
            throw new Error('Network error (C2S)');
          }
          // Serialise the entire SR read-modify-write so concurrent dispatches
          // cannot read stale server state and produce conflicting results.
          let resolveSlot!: () => void;
          const slot = new Promise<void>(r => { resolveSlot = r; });
          const prev = serverProcessMutex;
          serverProcessMutex = slot;
          await prev;
          try {
            return await sr.process(payload);
          } finally {
            resolveSlot();
          }
        },
        onUpdate: updates => applyClientUpdate(clientStore, updates, false),
        timerInterval: 200,
        onStart: () => readAllStateFromStore(clientStore),
      });

      serverDispatchers.push(sd);
      serverReceivers.push(sr);
      clientDispatchers.push(cd);
    }

    // ── Start clients with a small stagger to avoid thundering herd ─────────

    for (let i = 0; i < NUM_CLIENTS; i++) {
      await new Promise(resolve => setTimeout(resolve, 50));
      clientDispatchers[i].start();
    }

    // ── Update loop: creates, updates, and deletes for UPDATE_DURATION_MS ───

    let running = true;
    const updatePromises: Promise<void>[] = [];

    for (let clientIdx = 0; clientIdx < NUM_CLIENTS; clientIdx++) {
      const clientStore = clientStores[clientIdx];
      const cd = clientDispatchers[clientIdx];

      const updateLoop = async () => {
        while (running) {
          await randomDelay(MIN_UPDATE_INTERVAL_MS, MAX_UPDATE_INTERVAL_MS);
          if (!running) break;

          const clientCol = clientStore.get(COLLECTION_NAME)!;
          const activeIds = [...clientCol.entries()]
            .filter(([, e]) => isActiveEntry(e))
            .map(([id]) => id);

          const roll = Math.random();

          if (roll < 0.10 && activeIds.length < 60) {
            // ── Create ────────────────────────────────────────────────────
            const newId = auditor.generateUlid();
            const newRecord: ItemRecord = {
              id: newId,
              name: `new-c${clientIdx}-${newId.slice(-6)}`,
              counter: 0,
              tags: [`tag-c${clientIdx}`],
              nested: { value: clientIdx, label: `created-by-${clientIdx}` },
            };
            const newAudit = auditor.createAuditFrom(newRecord);
            clientCol.set(newId, { record: newRecord, audit: newAudit.entries as AuditEntry[] });
            cd.enqueue({ collectionName: COLLECTION_NAME, recordId: newId });
            createCount++;

          } else if (roll < 0.25 && activeIds.length > 5) {
            // ── Delete ────────────────────────────────────────────────────
            const recordId = activeIds[Math.floor(Math.random() * activeIds.length)];
            const entry = clientCol.get(recordId) as ActiveStoreEntry;
            const currentAudit = { id: recordId, entries: entry.audit as any };
            const deletedAudit = auditor.delete(currentAudit);
            clientCol.set(recordId, { deleted: true, audit: deletedAudit.entries as AuditEntry[] });
            cd.enqueue({ collectionName: COLLECTION_NAME, recordId });
            deleteCount++;

          } else if (activeIds.length > 0) {
            // ── Update ────────────────────────────────────────────────────
            const recordId = activeIds[Math.floor(Math.random() * activeIds.length)];
            const entry = clientCol.get(recordId) as ActiveStoreEntry;
            const updatedRecord: ItemRecord = {
              ...entry.record,
              counter: entry.record.counter + 1,
              name: `item-${recordId.slice(-4)}-c${clientIdx}-${Date.now()}`,
            };
            // Pass entry.record as baseRecord so the diff produces an Updated entry
            // (not a Created entry), ensuring isBranchOnly() correctly returns false.
            const currentAudit: AuditOf<ItemRecord> = { id: recordId, entries: entry.audit as any };
            const newAudit = auditor.updateAuditWith(updatedRecord, currentAudit, entry.record);
            clientCol.set(recordId, { record: updatedRecord, audit: newAudit.entries as AuditEntry[] });
            cd.enqueue({ collectionName: COLLECTION_NAME, recordId });
            updateCount++;
          }
        }
      };

      updatePromises.push(updateLoop());
    }

    // Let it run
    await new Promise(resolve => setTimeout(resolve, UPDATE_DURATION_MS));
    running = false;
    await Promise.all(updatePromises);

    // ── Settling phase ───────────────────────────────────────────────────────
    // The engine converges on its own: pending C2S dispatches drain via the CD timer,
    // SR broadcasts to other clients' SDs, and SD retries on failure.
    // No re-enqueuing — if the engine requires an external nudge to converge, that
    // would indicate a design gap.

    const settleStart = Date.now();
    let converged = false;

    let lastProgressLog = settleStart;
    while (Date.now() - settleStart < SETTLE_TIMEOUT_MS) {
      await new Promise(resolve => setTimeout(resolve, 500));
      if (isConverged(serverStore, clientStores)) {
        converged = true;
        break;
      }
      if (Date.now() - lastProgressLog >= 10_000) {
        lastProgressLog = Date.now();
        const elapsed = Math.round((Date.now() - settleStart) / 1000);
        const serverColData = serverStore.get(COLLECTION_NAME)!;
        const serverActive = [...serverColData.entries()].filter(([, e]) => isActiveEntry(e)).length;
        let divergentClients = 0;
        for (const cs of clientStores) {
          const col = cs.get(COLLECTION_NAME) ?? new Map();
          const clientActive = [...col.entries()].filter(([, e]) => isActiveEntry(e)).length;
          if (clientActive !== serverActive) divergentClients++;
        }
        // eslint-disable-next-line no-console
        console.error(`[settle +${elapsed}s] server=${serverActive} active, ${divergentClients}/${NUM_CLIENTS} clients divergent`);
      }
    }

    // Stop all CDs
    for (const cd of clientDispatchers) cd.stop();

    // ── Diagnostics on failure ───────────────────────────────────────────────
    /* eslint-disable no-console */
    if (!converged) {
      const serverColData = serverStore.get(COLLECTION_NAME)!;
      const serverActive = new Map(
        [...serverColData.entries()].filter(([, e]) => isActiveEntry(e)) as [string, ActiveStoreEntry][],
      );

      console.error(`Server has ${serverActive.size} active records`);
      let shown = 0;

      for (let clientIdx = 0; clientIdx < NUM_CLIENTS && shown < 5; clientIdx++) {
        const clientCol = clientStores[clientIdx].get(COLLECTION_NAME)!;
        const clientActive = [...clientCol.entries()].filter(([, e]) => isActiveEntry(e));
        const clientDeleted = [...clientCol.entries()].filter(([, e]) => !isActiveEntry(e));

        const missing = [...serverActive.keys()].filter(id => !clientCol.has(id) || !isActiveEntry(clientCol.get(id)!));
        const extra = clientActive.filter(([id]) => !serverActive.has(id));
        const mismatched = clientActive.filter(([id, e]) => {
          const sv = serverActive.get(id);
          return sv != null && deterministicJson(sv.record) !== deterministicJson((e as ActiveStoreEntry).record);
        });

        if (missing.length + extra.length + mismatched.length === 0) continue;

        console.error(
          `Client ${clientIdx}: ${clientActive.length} active, ${clientDeleted.length} pending-deleted`
          + ` | missing=${missing.length} extra=${extra.length} mismatched=${mismatched.length}`,
        );

        for (const [id] of extra.slice(0, 2)) {
          const serverEntry = serverColData.get(id);
          const clientEntry = clientCol.get(id) as ActiveStoreEntry;
          const serverStatus = serverEntry == null ? 'absent' : isActiveEntry(serverEntry) ? 'active' : 'tombstone';
          console.error(`  Extra: ${id.slice(-6)} server=${serverStatus} client.name=${clientEntry.record.name} client.counter=${clientEntry.record.counter}`);
          if (!isActiveEntry(serverEntry ?? {} as StoreEntry) && serverEntry != null) {
            const tomb = serverEntry as DeletedStoreEntry;
            console.error(`    Tombstone has ${tomb.audit.length} audit entries`);
          }
          shown++;
        }
        for (const [id, e] of mismatched.slice(0, 2)) {
          const sv = serverActive.get(id)!;
          console.error(`  Mismatch: ${id.slice(-6)} server.name=${sv.record.name} client.name=${(e as ActiveStoreEntry).record.name}`);
          shown++;
        }
        for (const id of missing.slice(0, 2)) {
          const clientEntry = clientCol.get(id);
          const clientStatus = clientEntry == null ? 'absent' : isActiveEntry(clientEntry) ? 'active' : 'pending-deleted';
          console.error(`  Missing: ${id.slice(-6)} client=${clientStatus}`);
          shown++;
        }
      }
    }

    // Dump log lines for stuck records (convergence failure) OR ids that CR refused
    // to resurrect (a latent bug even if convergence eventually happened).
    const shouldDump = !converged || loggedErrors.length > 0;
    if (shouldDump && logBuffer.length > 0) {
      const stuckIds = new Set<string>();
      // Pull ids out of the resurrection-refusal errors so we can trace them too
      for (const err of loggedErrors) {
        const m = err.match(/resurrect tombstoned ([A-Za-z0-9-]+) in/);
        if (m) stuckIds.add(m[1]);
      }
      const stuckByClient = new Map<string, number>();
      const serverColData2 = serverStore.get(COLLECTION_NAME)!;
      for (let ci = 0; ci < clientStores.length; ci++) {
        const cs = clientStores[ci];
        const col = cs.get(COLLECTION_NAME) ?? new Map();
        for (const [id, entry] of col) {
          if (isActiveEntry(entry) && !isActiveEntry(serverColData2.get(id) ?? {} as StoreEntry)) {
            stuckIds.add(id);
            stuckByClient.set(id, ci);
          }
        }
      }
      // Group log lines by the stuck record ID they mention, and dump each group.
      const fs = await import('node:fs');
      const os = await import('node:os');
      const path = await import('node:path');
      const dumpPath = path.join(os.tmpdir(), 'stress-stuck-logs.txt');
      const out: string[] = [];
      for (const stuckId of stuckIds) {
        const clientIdx = stuckByClient.get(stuckId);
        const lines = logBuffer.filter(l => l.includes(stuckId));
        out.push(`── ${stuckId} stuck-on-client=${clientIdx} (${lines.length} lines) ──`);
        for (const line of lines) out.push(line);
        out.push('');
      }
      fs.writeFileSync(dumpPath, out.join('\n'));
      console.error(`\n── Stuck record log dump written to ${dumpPath} (${out.length} lines) ──`);
    }

    /* eslint-enable no-console */

    // ── Assertions ──────────────────────────────────────────────────────────

    expect(loggedErrors, `no errors must be logged by the sync engine (got ${loggedErrors.length}):\n${loggedErrors.slice(0, 10).join('\n')}`).toEqual([]);
    expect(networkFailureCount, 'at least 3 network failures must have occurred').toBeGreaterThanOrEqual(3);
    expect(createCount, 'creates must have occurred').toBeGreaterThan(0);
    expect(updateCount, 'updates must have occurred').toBeGreaterThan(0);
    expect(deleteCount, 'deletes must have occurred').toBeGreaterThan(0);
    expect(converged, 'all clients must converge to server state').toBe(true);
  });
});
