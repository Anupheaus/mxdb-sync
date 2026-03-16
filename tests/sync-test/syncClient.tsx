import React, { useRef, useImperativeHandle, forwardRef, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useMXDBSync } from '../../src/client';
import { useCollection } from '../../src/client/hooks/useCollection';
import { SyncProvider, DbsProvider, ClientToServerProvider, ServerToClientProvider } from '../../src/client/providers';
import type { SyncTestRecord } from './types';
import { syncTestCollection, type RunLogDetail, type RunLogEvent } from './types';

// Some dependencies ship without full TypeScript export typings in this repo setup.
// For tests, we `require` them and use `any` to keep the integration harness working.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useSocketAPI, SocketAPI } = require('@anupheaus/socket-api/client') as any;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { LoggerProvider } = require('@anupheaus/react-ui') as any;

export interface SyncClientDriverRef {
  upsert(record: SyncTestRecord): Promise<void>;
  remove(recordId: string): Promise<boolean>;
  disconnect(): void;
  reconnect(): void;
  getIsConnected(): boolean;
  getIsSynchronising(): boolean;
}

/**
 * Driver component that runs inside MXDBSync and exposes upsert / disconnect / reconnect via ref.
 * Uses real useCollection and useMXDBSync so the same code path as the app is exercised.
 */
const SyncClientDriverInner = forwardRef<SyncClientDriverRef, { clientId: string; onConnected?: () => void; log: (event: RunLogEvent, detail?: RunLogDetail) => void }>(
  function SyncClientDriverInner({ clientId, onConnected, log }, ref) {
    const { upsert, remove: collectionRemove, useQuery } = useCollection(syncTestCollection);
    // Ensure a live subscription exists so the real sync pipeline is exercised.
    // (Without an active query/subscription, some setups won't push local mutations to the server.)
    useQuery();
    const { testDisconnect, testReconnect, isSynchronising } = useMXDBSync();
    const { getIsConnected, getSocket } = useSocketAPI();
    const onConnectedRef = useRef(onConnected);
    onConnectedRef.current = onConnected;
    const pendingOfflineUpsertsRef = useRef<Map<string, SyncTestRecord>>(new Map());
    const pendingOfflineRemovesRef = useRef<Set<string>>(new Set());
    const flushingRef = useRef(false);
    const flushingRemovesRef = useRef(false);

    useEffect(() => {
      const id = setInterval(() => {
        if (getIsConnected() && onConnectedRef.current) {
          onConnectedRef.current();
        }
        // When reconnected, replay any offline upserts while connected so they are sent to server
        // via ClientToServerProvider's onChange hook.
        if (getIsConnected() && !flushingRef.current && pendingOfflineUpsertsRef.current.size > 0) {
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
        // When reconnected, replay any offline removes.
        if (getIsConnected() && !flushingRemovesRef.current && pendingOfflineRemovesRef.current.size > 0) {
          flushingRemovesRef.current = true;
          const ids = Array.from(pendingOfflineRemovesRef.current);
          pendingOfflineRemovesRef.current.clear();
          log('client_remove_flush', { clientId, count: ids.length, removedIds: ids });
          Promise.resolve(collectionRemove(ids))
            .then(() => log('client_remove_flush_done', { clientId, count: ids.length, removedIds: ids }))
            .catch(error => log('error', { type: 'client_remove_flush_failed', clientId, removedIds: ids, error: String((error as any)?.message ?? error) }))
            .finally(() => { flushingRemovesRef.current = false; });
        }
      }, 50);
      return () => clearInterval(id);
    }, [getIsConnected, upsert, collectionRemove]);

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
              const responses = ackArgs[0] as Array<{ collectionName: string; ids: string[] }>;
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
        upsert(record: SyncTestRecord) {
          if (!getIsConnected()) {
            pendingOfflineUpsertsRef.current.set(record.id, record);
            log('client_upsert_queued_offline', { clientId, recordId: record.id });
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
          return collectionRemove(recordId);
        },
        disconnect: testDisconnect,
        reconnect: testReconnect,
        getIsConnected,
        getIsSynchronising: () => isSynchronising,
      }),
      [upsert, collectionRemove, testDisconnect, testReconnect, getIsConnected, isSynchronising],
    );

    return null;
  },
);

export interface SyncClient {
  connect(serverUrl: string): Promise<void>;
  disconnect(): void;
  reconnect(): void;
  upsert(record: SyncTestRecord): Promise<void>;
  remove(recordId: string): Promise<boolean>;
  getIsConnected(): boolean;
  getIsSynchronising(): boolean;
  unmount(): void;
}

/**
 * Create a sync client: a React root with MXDBSync and a driver that exposes upsert/disconnect/reconnect.
 * Each client has a unique db name (for fake-indexeddb). Call connect(serverUrl) to mount and wait for connection.
 */
export function createSyncClient(
  clientId: string,
  runLogger: { log: (event: RunLogEvent, detail?: RunLogDetail) => void },
): SyncClient {
  const dbName = `sync-test-client-${clientId}`;
  const socketName = 'sync-test';
  let root: Root | null = null;
  let container: HTMLElement | null = null;
  const driverRef = React.createRef<SyncClientDriverRef>();
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

    root.render(
      <LoggerProvider loggerName="MXDB-Sync">
        <SocketAPI host={serverUrl} name={socketName}>
          <DbsProvider name={dbName} collections={[syncTestCollection]}>
            <SyncProvider>
              <ClientToServerProvider />
              <ServerToClientProvider />
              <SyncClientDriverInner
                ref={driverRef}
                clientId={clientId}
                log={runLogger.log}
                onConnected={() => {
                  if (resolveConnected) {
                    resolveConnected();
                    resolveConnected = null;
                  }
                }}
              />
            </SyncProvider>
          </DbsProvider>
        </SocketAPI>
      </LoggerProvider>,
    );

    runLogger.log('client_connect', { clientId, dbName, socketName });
    return connectedPromise;
  }

  function disconnect() {
    const d = driverRef.current;
    if (d) d.disconnect();
    runLogger.log('client_disconnect', { clientId });
  }

  function reconnect() {
    const d = driverRef.current;
    if (d) d.reconnect();
  }

  async function upsert(record: SyncTestRecord): Promise<void> {
    const d = driverRef.current;
    if (!d) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    runLogger.log('client_upsert_request', { clientId, record });
    await d.upsert(record);
    runLogger.log('client_upsert_response', { clientId, recordId: record.id });
  }

  async function remove(recordId: string): Promise<boolean> {
    const d = driverRef.current;
    if (!d) throw new Error(`Client ${clientId}: driver not ready (call connect first)`);
    runLogger.log('client_remove_request', { clientId, recordId });
    const result = await d.remove(recordId);
    runLogger.log('client_remove_response', { clientId, recordId });
    return result;
  }

  function getIsConnected(): boolean {
    const d = driverRef.current;
    return d ? d.getIsConnected() : false;
  }

  function getIsSynchronising(): boolean {
    const d = driverRef.current;
    return d ? d.getIsSynchronising() : false;
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
    upsert,
    remove,
    getIsConnected,
    getIsSynchronising,
    unmount,
  };
}
