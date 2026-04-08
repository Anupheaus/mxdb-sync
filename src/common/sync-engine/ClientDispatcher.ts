import type { Logger, Record as MXDBRecord } from '@anupheaus/common';
import { hashRecord } from '../auditor/hash';
import {
  type ClientDispatcherEnqueueItem,
  type ClientDispatcherRequest,
  type MXDBRecordStates,
  type MXDBRecordStatesRequest,
  type MXDBSyncEngineResponse,
  type MXDBUpdateRequest,
} from './models';
import type { ClientReceiver } from './ClientReceiver';
import { isActiveRecordState, getStateId } from './utils';

interface ClientDispatcherProps {
  clientReceiver: ClientReceiver;
  onPayloadRequest<T extends MXDBRecord>(request: MXDBRecordStatesRequest): MXDBRecordStates<T>;
  onDispatching(isDispatching: boolean): void;
  onDispatch(payload: ClientDispatcherRequest): Promise<MXDBSyncEngineResponse>;
  onUpdate(updates: MXDBUpdateRequest): void;
  timerInterval?: number;
  onStart(): MXDBRecordStates;
}

export class ClientDispatcher {
  readonly #logger: Logger;
  readonly #props: ClientDispatcherProps;
  #started = false;
  #inFlight = false;
  #timer: ReturnType<typeof setTimeout> | undefined = undefined;
  #timerResolve: (() => void) | undefined = undefined;
  #queue: ClientDispatcherEnqueueItem[] = [];
  #pendingReEnqueue = new Set<string>(); // "collectionName:recordId" keys
  #epoch = 0;

  constructor(logger: Logger, props: ClientDispatcherProps) {
    this.#logger = logger;
    this.#props = props;
    this.#logger.debug('[CD] ClientDispatcher created');
  }

  enqueue(item: ClientDispatcherEnqueueItem): void {
    if (!this.#started) return;
    // If already in queue, mark for re-enqueue after the current dispatch so that
    // updates arriving while a record is in-flight are not lost when
    // #processSuccessResponse removes the in-flight entry.
    const exists = this.#queue.some(
      q => q.collectionName === item.collectionName && q.recordId === item.recordId,
    );
    if (exists) {
      // Only track for re-enqueue when in-flight. When not in-flight the existing
      // queue entry has not yet been snapshotted, so it will naturally pick up the
      // latest state when onPayloadRequest is called at dispatch time.
      if (this.#inFlight) {
        this.#pendingReEnqueue.add(`${item.collectionName}:${item.recordId}`);
      }
      return;
    }
    this.#queue.push(item);
    this.#logger.debug(`[CD] enqueued ${item.recordId} in ${item.collectionName}, queue length=${this.#queue.length}`);
    if (!this.#timer && !this.#inFlight) {
      this.#startTimer();
    }
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#logger.info('[CD] starting');
    void this.#doStart();
  }

  stop(): void {
    this.#epoch++;
    if (this.#timer != null) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    this.#timerResolve?.();
    this.#timerResolve = undefined;
    this.#queue = [];
    this.#pendingReEnqueue.clear();
    this.#started = false;
    this.#logger.info('[CD] stopped');
  }

  async #doStart(): Promise<void> {
    const startEpoch = this.#epoch;
    const interval = this.#props.timerInterval ?? 250;

    while (true) {
      if (this.#epoch !== startEpoch) return;

      const states = this.#props.onStart();

      if (this.#epoch !== startEpoch) return;

      // Mark in-flight before awaiting #buildRequest (see #timerTick for rationale).
      const dispatchEpoch = this.#epoch;
      this.#inFlight = true;

      const dispatchRequest = await this.#buildRequest(states);
      this.#props.onDispatching(true);
      this.#props.clientReceiver.pause();

      try {
        const response = await this.#props.onDispatch(dispatchRequest);

        if (this.#epoch !== dispatchEpoch) {
          // stop() was called mid-flight — discard response
          return;
        }

        this.#processSuccessResponse(response, states);

        // Start timer if queue has items
        if (this.#queue.length > 0 && this.#epoch === startEpoch) {
          this.#startTimer();
        }
        return; // Success — exit loop

      } catch (err) {
        if (this.#epoch !== startEpoch) return;
        this.#logger.warn('[CD] onStart dispatch failed, retrying', err);
        // Fall through to retry delay
      } finally {
        this.#inFlight = false;
        this.#props.onDispatching(false);
        this.#props.clientReceiver.resume();
      }

      // Retry delay — reuses #timer
      await new Promise<void>(resolve => {
        this.#timerResolve = resolve;
        this.#timer = setTimeout(() => {
          this.#timer = undefined;
          this.#timerResolve = undefined;
          resolve();
        }, interval);
      });

      if (this.#epoch !== startEpoch) return;
    }
  }

  #startTimer(): void {
    const interval = this.#props.timerInterval ?? 250;
    this.#timer = setTimeout(async () => {
      this.#timer = undefined;
      await this.#timerTick();
    }, interval);
  }

  async #timerTick(): Promise<void> {
    if (!this.#started) return;

    // Step 1: Group queued items into MXDBRecordStatesRequest
    const grouped = new Map<string, string[]>();
    for (const item of this.#queue) {
      if (!grouped.has(item.collectionName)) grouped.set(item.collectionName, []);
      grouped.get(item.collectionName)!.push(item.recordId);
    }
    const request: MXDBRecordStatesRequest = [];
    for (const [collectionName, recordIds] of grouped) {
      request.push({ collectionName, recordIds });
    }

    // Step 2: Get states
    const states = this.#props.onPayloadRequest(request);

    // Drop queue entries whose state has disappeared (e.g. record deleted by an
    // incoming S2C push while it was waiting in the queue).  Keeping them would
    // cause the entry to sit in the queue indefinitely since onPayloadRequest
    // will never return a state for a record that no longer exists locally.
    const stateKeys = new Set<string>();
    for (const col of states) {
      for (const s of col.records) {
        stateKeys.add(`${col.collectionName}:${getStateId(s)}`);
      }
    }
    this.#queue = this.#queue.filter(q => stateKeys.has(`${q.collectionName}:${q.recordId}`));

    // Mark in-flight BEFORE awaiting #buildRequest so that any enqueue() calls
    // during async hash computation are captured in #pendingReEnqueue.
    const epoch = this.#epoch;
    this.#inFlight = true;

    // Step 3: Build dispatch request
    const dispatchRequest = await this.#buildRequest(states);
    this.#props.onDispatching(true);
    this.#props.clientReceiver.pause();

    let success = false;
    try {
      const response = await this.#props.onDispatch(dispatchRequest);

      if (epoch !== this.#epoch) {
        // stop() was called — skip steps 6-7
        return;
      }

      this.#processSuccessResponse(response, states);
      success = true;

    } catch (err) {
      this.#logger.warn('[CD] timer dispatch failed', err);
    } finally {
      this.#inFlight = false;
      this.#props.onDispatching(false);
      this.#props.clientReceiver.resume();
    }

    // Post-finally
    if (success && epoch === this.#epoch && this.#queue.length > 0) {
      this.#startTimer();
    } else if (!success && epoch === this.#epoch) {
      this.#startTimer(); // Retry
    }
  }

  async #buildRequest(states: MXDBRecordStates): Promise<ClientDispatcherRequest> {
    const result: ClientDispatcherRequest = [];

    for (const col of states) {
      const colName = col.collectionName;
      const records: ClientDispatcherRequest[0]['records'] = [];

      for (const state of col.records) {
        const id = getStateId(state);
        if (isActiveRecordState(state)) {
          const hash = await hashRecord(state.record);
          records.push({ id, hash, entries: state.audit });
        } else {
          // Deleted — no hash
          records.push({ id, entries: state.audit });
        }
      }

      if (records.length > 0) {
        result.push({ collectionName: colName, records });
      }
    }

    return result;
  }

  #processSuccessResponse(response: MXDBSyncEngineResponse, states: MXDBRecordStates): void {
    const updateRequest: MXDBUpdateRequest = [];

    for (const col of states) {
      const colName = col.collectionName;
      const successIds = response.find(r => r.collectionName === colName)?.successfulRecordIds ?? [];
      const successSet = new Set(successIds);

      const records: { record: MXDBRecord; lastAuditEntryId: string }[] = [];
      const deletedRecordIds: string[] = [];

      for (const state of col.records) {
        const id = getStateId(state);
        if (!successSet.has(id)) continue;

        if (isActiveRecordState(state)) {
          // Use the last element's id (insertion order), not the max ULID.
          // The audit may contain a Branched entry whose id is a server-side ULID
          // newer than the client's own pending entries; getLastEntryId (max ULID)
          // would return that anchor id, leaving the pending entries after the
          // collapse point and keeping the audit non-branch-only permanently.
          const lastEntryId = state.audit.length > 0
            ? state.audit[state.audit.length - 1].id
            : undefined;
          if (lastEntryId != null) {
            records.push({ record: state.record, lastAuditEntryId: lastEntryId });
          }
        } else {
          deletedRecordIds.push(id);
        }
      }

      if (records.length > 0 || deletedRecordIds.length > 0) {
        const item: MXDBUpdateRequest[0] = { collectionName: colName };
        if (records.length > 0) item.records = records;
        if (deletedRecordIds.length > 0) item.deletedRecordIds = deletedRecordIds;
        updateRequest.push(item);
      }
    }

    if (updateRequest.length > 0) {
      this.#props.onUpdate(updateRequest);
      this.#logger.debug('[CD] onUpdate called with processed response');
    }

    // Remove successfully processed items from queue
    const successByCollection = new Map<string, Set<string>>();
    for (const item of response) {
      successByCollection.set(item.collectionName, new Set(item.successfulRecordIds));
    }
    this.#queue = this.#queue.filter(q => {
      const successIds = successByCollection.get(q.collectionName);
      return !(successIds?.has(q.recordId));
    });

    // Re-enqueue records that received a new update while the previous dispatch was
    // in-flight. Without this, those updates would be orphaned: enqueue() was a no-op
    // (the record was already in queue), and the removal above cleared that entry.
    for (const item of response) {
      for (const id of item.successfulRecordIds) {
        const key = `${item.collectionName}:${id}`;
        if (this.#pendingReEnqueue.has(key)) {
          this.#pendingReEnqueue.delete(key);
          if (!this.#queue.some(q => q.collectionName === item.collectionName && q.recordId === id)) {
            this.#queue.push({ collectionName: item.collectionName, recordId: id });
            this.#logger.debug(`[CD] re-enqueued ${id} in ${item.collectionName} — update arrived during dispatch`);
          }
        }
      }
    }
  }
}
