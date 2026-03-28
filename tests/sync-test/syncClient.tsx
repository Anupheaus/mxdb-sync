import React, { useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMXDBSync } from '../../src/client';
import { useCollection } from '../../src/client/hooks/useCollection';
import {
  DbsProvider,
  ClientToServerProvider,
  ClientToServerSyncProvider,
  ServerToClientProvider,
  useClientToServerSyncInstance,
  useDb,
} from '../../src/client/providers';
import type { AuditOf } from '../../src/common';
import type { SyncTestRecord } from './types';
import { syncTestCollection, type RunLogDetail, type RunLogEvent } from './types';
import { diagLog } from './diagLog';

// Use ES imports so vitest applies resolve aliases (source code), avoiding
// context-identity mismatches between the dist and the source versions.
import { useSocketAPI, SocketAPI } from '@anupheaus/socket-api/client';
import { LoggerProvider } from '@anupheaus/react-ui';

export interface SyncClientDriverRef {
  get(recordId: string): Promise<SyncTestRecord | undefined>;
  getLocal(recordId: string): Promise<SyncTestRecord | undefined>;
  /** Establishes mxdbGetAllSubscription so server pushes full collection snapshots on DB changes. */
  subscribeGetAll(): Promise<void>;
  getGetAllSubscriptionSnapshot(): SyncTestRecord[];
  upsert(record: SyncTestRecord): Promise<void>;
  remove(recordId: string): Promise<boolean>;
  disconnect(): void;
  reconnect(): void;
  getIsConnected(): boolean;
  getIsSynchronising(): boolean;
  getLocalRecords(): SyncTestRecord[];
  /** Pending C2S sync queue size (`ClientToServerSynchronisation` deduped entries). */
  getPendingC2SSyncQueueSize(): number;
  getLocalAudit(recordId: string): Promise<AuditOf<SyncTestRecord> | undefined>;
}

/**
 * Driver component that runs inside MXDBSync and exposes upsert / disconnect / reconnect via ref.
 * Uses real useCollection and useMXDBSync so the same code path as the app is exercised.
 */
const SyncClientDriverInner = forwardRef<SyncClientDriverRef, { clientId: string; onConnected?: () => void; log: (event: RunLogEvent, detail?: RunLogDetail) => void; }>(
  function SyncClientDriverInner({ clientId, onConnected, log }, ref) {
    const { get, getAll, upsert, remove: collectionRemove, useQuery } = useCollection(syncTestCollection);
    // Ensure a live subscription exists so the real sync pipeline is exercised.
    // (Without an active query/subscription, some setups won't push local mutations to the server.)
    const { records: localRecords } = useQuery();
    const localRecordsRef = useRef(localRecords);
    localRecordsRef.current = localRecords;
    const { testDisconnect, testReconnect, isSynchronising } = useMXDBSync();
    const { getIsConnected, getSocket, getRawSocket } = useSocketAPI();
    const c2sInstance = useClientToServerSyncInstance();
    const { db } = useDb();
    const onConnectedRef = useRef(onConnected);
    onConnectedRef.current = onConnected;
    const getAllSubscriptionRecordsRef = useRef<SyncTestRecord[]>([]);
    const getAllSubscribeLastRef = useRef<SyncTestRecord[] | undefined>(undefined);
    const pendingOfflineUpsertsRef = useRef<Map<string, SyncTestRecord>>(new Map());
    const pendingOfflineRemovesRef = useRef<Set<string>>(new Set());
    const flushingRef = useRef(false);
    const flushingRemovesRef = useRef(false);

    // Flush queued offline upserts/removes on socket `connect` (same timing a real app would use),
    // not a polling interval.
    useEffect(() => {
      const socket = getRawSocket() ?? getSocket();
      if (socket == null) return undefined;

      const flushOfflineQueues = () => {
        if (!getIsConnected()) return;
        onConnectedRef.current?.();

        if (!flushingRef.current && pendingOfflineUpsertsRef.current.size > 0) {
          flushingRef.current = true;
          const records = Array.from(pendingOfflineUpsertsRef.current.values());
          pendingOfflineUpsertsRef.current.clear();
          const recordIds = records.map(r => r.id);
          log('client_upsert_flush', { clientId, count: records.length, recordIds });
          Promise.resolve(upsert(records))
            .then(() => log('client_upsert_flush_done', { clientId, count: recordIds.length, recordIds }))
            .catch(error => log('error', { type: 'client_upsert_flush_failed', clientId, recordIds, error: String((error as any)?.message ?? error) }))
            .finally(() => { flushingRef.current = false; });
        }
        if (!flushingRemovesRef.current && pendingOfflineRemovesRef.current.size > 0) {
          flushingRemovesRef.current = true;
          const ids = Array.from(pendingOfflineRemovesRef.current);
          pendingOfflineRemovesRef.current.clear();
          log('client_remove_flush', { clientId, count: ids.length, removedIds: ids });
          Promise.resolve(collectionRemove(ids))
            .then(() => log('client_remove_flush_done', { clientId, count: ids.length, removedIds: ids }))
            .catch(error => log('error', { type: 'client_remove_flush_failed', clientId, removedIds: ids, error: String((error as any)?.message ?? error) }))
            .finally(() => { flushingRemovesRef.current = false; });
        }
      };

      socket.on('connect', flushOfflineQueues);
      if (socket.connected) flushOfflineQueues();
      return () => {
        socket.off('connect', flushOfflineQueues);
      };
    }, [getSocket, getRawSocket, getIsConnected, upsert, collectionRemove, clientId, log]);

    // Instrument socket emits and important socket events for test-owned logging.
    useEffect(() => {
      const socket = getSocket();
      if (!socket) return;

      const originalEmit = socket.emit.bind(socket);
      socket.emit = ((eventName: string, ...args: any[]) => {
        const ts = process.hrtime.bigint().toString();
        const hasAck = typeof args[args.length - 1] === 'function';
        const ack = hasAck ? args[args.length - 1] : undefined;
        const payload = hasAck ? args.slice(0, -1) : args;
        log('socket_emit', { clientId, ts, eventName, payload });
        if (ack) {
          const wrappedAck = (...ackArgs: any[]) => {
            log('socket_ack', { clientId, ts, eventName, ackArgs });
            if (eventName === 'mxdbSyncCollectionsAction' && Array.isArray(ackArgs[0])) {
              const responses = ackArgs[0] as Array<{ collectionName: string; ids: string[]; }>;
              log('sync_ack', { clientId, responses: responses.map(r => ({ collectionName: r.collectionName, acknowledgedCount: r.ids?.length ?? 0, acknowledgedIds: r.ids ?? [] })) });
            }
            return (ack as any)(...ackArgs);
          };
          return originalEmit(eventName, ...payload, wrappedAck);
        }
        return originalEmit(eventName, ...payload);
      }) as any;

      const onConnect = () => log('socket_connect', { clientId, socketId: socket.id });
      const onDisconnect = (reason: any) => log('socket_disconnect', { clientId, reason });
      const onError = (err: any) => log('socket_error', { clientId, error: String(err?.message ?? err) });
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.on('connect_error', onError);
      socket.on('error', onError);

      return () => {
        socket.emit = originalEmit as any;
        socket.off('connect', onConnect);
        socket.off('disconnect', onDisconnect);
        socket.off('connect_error', onError);
        socket.off('error', onError);
      };
    }, [getSocket, getIsConnected, clientId, log]);

    useImperativeHandle(
      ref,
      () => ({
        get(recordId: string) {
          return get(recordId, { locallyOnly: false });
        },
        getLocal(recordId: string) {
          return get(recordId, { locallyOnly: true });
        },
        subscribeGetAll() {
          return getAll(
            {},
            records => {
              getAllSubscribeLastRef.current = records;
              getAllSubscriptionRecordsRef.current = records;
            },
            () => {
              if (getAllSubscribeLastRef.current != null) {
                getAllSubscriptionRecordsRef.current = getAllSubscribeLastRef.current;
              }
            },
          );
        },
        getGetAllSubscriptionSnapshot: () => getAllSubscriptionRecordsRef.current ?? [],
        upsert(record: SyncTestRecord) {
          const connected = getIsConnected();
          const rawSocket = getRawSocket();
          if (!connected) {
            pendingOfflineUpsertsRef.current.set(record.id, record);
            diagLog('syncClient', 'upsert_offline', {
              clientId, recordId: record.id,
              rawSocketConnected: rawSocket?.connected ?? false,
              rawSocketId: rawSocket?.id ?? 'none',
              hasRawSocket: rawSocket != null,
            });
            log('client_upsert_queued_offline', {
              clientId, recordId: record.id,
              socketConnected: rawSocket?.connected ?? false,
              socketId: rawSocket?.id ?? 'none',
              hasSocket: rawSocket != null,
            } as any);
          }
          return upsert(record);
        },
        async remove(recordId: string) {
          if (!getIsConnected()) {
            pendingOfflineRemovesRef.current.add(recordId);
            pendingOfflineUpsertsRef.current.delete(recordId);
            log('client_remove_queued_offline', { clientId, recordId });
            return true;
          }
          await collectionRemove(recordId);
          return true;
        },
        disconnect() {
          diagLog('syncClient', 'disconnect_called', { clientId, rawSocketId: getRawSocket()?.id ?? 'none', rawSocketConnected: getRawSocket()?.connected ?? false });
          testDisconnect();
        },
        reconnect() {
          diagLog('syncClient', 'reconnect_called', { clientId, rawSocketId: getRawSocket()?.id ?? 'none', rawSocketConnected: getRawSocket()?.connected ?? false });
          testReconnect();
        },
        getIsConnected,
        getIsSynchronising: () => isSynchronising,
        getLocalRecords: () => (localRecordsRef.current ?? []) as SyncTestRecord[],
        getPendingC2SSyncQueueSize: () => c2sInstance?.pendingQueueEntryCount ?? 0,
        getLocalAudit(recordId: string) {
          return db.use<SyncTestRecord>(syncTestCollection.name).getAudit(recordId);
        },
      }),
      [get, getAll, upsert, collectionRemove, testDisconnect, testReconnect, getIsConnected, getRawSocket, isSynchronising, c2sInstance, db],
    );

    return null;
  },
);

export interface SyncClient {
  connect(serverUrl: string): Promise<void>;
  disconnect(): void;
  reconnect(): void;
  get(recordId: string): Promise<SyncTestRecord | undefined>;
  getLocal(recordId: string): Promise<SyncTestRecord | undefined>;
  subscribeGetAll(): Promise<void>;
  getGetAllSubscriptionSnapshot(): SyncTestRecord[];
  upsert(record: SyncTestRecord): Promise<void>;
  remove(recordId: string): Promise<boolean>;
  getIsConnected(): boolean;
  getIsSynchronising(): boolean;
  getLocalRecords(): SyncTestRecord[];
  getPendingC2SSyncQueueSize(): number;
  getLocalAudit(recordId: string): Promise<AuditOf<SyncTestRecord> | undefined>;
  unmount(): void;
}

export interface CreateSyncClientOptions {
  /** Override IndexedDB / DbsProvider database name (default: `sync-test-client-${clientId}`). */
  dbName?: string;
}

/**
 * Create a sync client: a React root with MXDBSync and a driver that exposes upsert/disconnect/reconnect.
 * Each client has a unique db name. Call connect(serverUrl) to mount and wait for connection.
 */
export function createSyncClient(
  clientId: string,
  runLogger: { log: (event: RunLogEvent, detail?: RunLogDetail) => void; },
  options?: CreateSyncClientOptions,
): SyncClient {
  const dbName = options?.dbName ?? `sync-test-client-${clientId}`;
  const socketName = 'sync-test';
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  let driver: SyncClientDriverRef;
  let resolveConnected: (() => void) | null = null;
  const connectedPromise = new Promise<void>(resolve => {
    resolveConnected = resolve;
  });

  function connect(serverUrl: string): Promise<void> {
    if (container != null) {
      return connectedPromise;
    }
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    const saveDriver = (innerDriver: SyncClientDriverRef) => {
      driver = innerDriver;
      if (resolveConnected) resolveConnected();
    };

    root.render(
      <LoggerProvider loggerName="MXDB-Sync">
        <SocketAPI host={serverUrl} name={socketName}>
          <DbsProvider name={dbName} collections={[syncTestCollection]}>
            <ClientToServerSyncProvider collections={[syncTestCollection]}>
              <ClientToServerProvider />
              <ServerToClientProvider />
              <SyncClientDriverInner
                ref={saveDriver}
                clientId={clientId}
                log={runLogger.log}
              // onConnected={() => {
              //   if (resolveConnected) {
              //     resolveConnected();
              //     resolveConnected = null;
              //   }
              // }}
              />
            </ClientToServerSyncProvider>
          </DbsProvider>
        </SocketAPI>
      </LoggerProvider>,
    );

    runLogger.log('client_connect', { clientId, dbName, socketName });
    return connectedPromise;
  }

  function disconnect() {
    if (driver) driver.disconnect();
    else diagLog('syncClient', 'disconnect_no_driver', { clientId });
    runLogger.log('client_disconnect', { clientId });
  }

  function reconnect() {
    if (driver) driver.reconnect();
    else diagLog('syncClient', 'reconnect_no_driver', { clientId });
  }

  async function get(recordId: string): Promise<SyncTestRecord | undefined> {
    if (!driver) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    runLogger.log('client_get_request', { clientId, recordId, mode: 'server' });
    const row = await driver.get(recordId);
    runLogger.log('client_get_response', { clientId, recordId, found: row != null, mode: 'server' });
    return row;
  }

  async function getLocal(recordId: string): Promise<SyncTestRecord | undefined> {
    if (!driver) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    return driver.getLocal(recordId);
  }

  async function subscribeGetAll(): Promise<void> {
    if (!driver) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    runLogger.log('client_getAll_subscribe', { clientId, phase: 'start' });
    await driver.subscribeGetAll();
    const snap = driver.getGetAllSubscriptionSnapshot();
    runLogger.log('client_getAll_subscribe', { clientId, phase: 'ready', recordCount: snap.length });
  }

  function getGetAllSubscriptionSnapshot(): SyncTestRecord[] {
    return driver ? driver.getGetAllSubscriptionSnapshot() : [];
  }

  async function upsert(record: SyncTestRecord): Promise<void> {
    if (!driver) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    runLogger.log('client_upsert_request', { clientId, record });
    await driver.upsert(record);
    runLogger.log('client_upsert_response', { clientId, recordId: record.id });
  }

  async function remove(recordId: string): Promise<boolean> {
    if (!driver) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    runLogger.log('client_remove_request', { clientId, recordId });
    const result = await driver.remove(recordId);
    runLogger.log('client_remove_response', { clientId, recordId });
    return result;
  }

  function getIsConnected(): boolean {
    return driver ? driver.getIsConnected() : false;
  }

  function getIsSynchronising(): boolean {
    return driver ? driver.getIsSynchronising() : false;
  }

  function getLocalRecords(): SyncTestRecord[] {
    return driver ? driver.getLocalRecords() : [];
  }

  function getPendingC2SSyncQueueSize(): number {
    return driver ? driver.getPendingC2SSyncQueueSize() : 0;
  }

  async function getLocalAudit(recordId: string): Promise<AuditOf<SyncTestRecord> | undefined> {
    if (!driver) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    return driver.getLocalAudit(recordId);
  }

  function unmount() {
    if (root != null && container != null) {
      root.unmount();
      container.remove();
      root = null;
      container = null;
    }
  }

  return {
    connect,
    disconnect,
    reconnect,
    get,
    getLocal,
    subscribeGetAll,
    getGetAllSubscriptionSnapshot,
    upsert,
    remove,
    getIsConnected,
    getIsSynchronising,
    getLocalRecords,
    getPendingC2SSyncQueueSize,
    getLocalAudit,
    unmount,
  };
}
