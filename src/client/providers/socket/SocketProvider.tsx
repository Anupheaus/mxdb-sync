import { createComponent, useBound, useId, useMap } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useLayoutEffect, useMemo } from 'react';
import type { Socket } from 'socket.io-client';
import { io } from 'socket.io-client';
import type { SocketContextProps } from './SocketContext';
import { SocketContext } from './SocketContext';
import { SocketIOParser } from '../../../common';
import { useLogger } from '../../logger';

interface CallbackRecord {
  callback: (isConnected: boolean, socket: Socket | undefined) => void;
  debugId?: string;
}

interface Props {
  children?: ReactNode;
}

export const SocketProvider = createComponent('SocketProvider', ({
  children,
}: Props) => {
  const logger = useLogger();
  const socket = useMemo(() => {
    logger.info('Connecting socket to server...');
    const sck = io({ path: '/mxdb-sync', transports: ['websocket'], parser: new SocketIOParser({ logger }) });
    let isConnected = false;

    const onConnected = () => {
      logger.debug('Socket connected to server', { id: sck.id });
      connectionCallbacks.forEach(({ callback, debugId }, callbackId) => {
        logger.silly('Calling connection state change callback from connect', { callbackId, debugId, connected: true });
        callback(true, sck);
      });
    };

    const onDisconnected = () => {
      logger.debug('Socket disconnected from server', { id: sck.id });
      connectionCallbacks.forEach(({ callback, debugId }, callbackId) => {
        logger.silly('Calling connection state change callback from connect', { callbackId, debugId, connected: false });
        callback(false, undefined);
      });
    };

    sck.on('connect', () => {
      if (isConnected) return; // prevent multiple calls
      isConnected = true;
      onConnected();
    });
    sck.on('disconnect', () => {
      if (!isConnected) return; // prevent multiple calls
      isConnected = false;
      onDisconnected();
    });
    sck.on('connect_error', error => logger.error('Socket connection error', { error }));
    return sck;
  }, []);
  const connectionCallbacks = useMap<string, CallbackRecord>();

  const context = useMemo<SocketContextProps>(() => ({
    getSocket() {
      if (socket.connected) return socket;
    },
    onConnectionStateChange(callback, debugId) {
      const callbackId = useId();
      const boundCallback = useBound(callback);
      logger.silly('Adding connection state change callback', { callbackId, debugId });
      connectionCallbacks.set(callbackId, { callback: boundCallback, debugId });
      useLayoutEffect(() => {
        logger.silly('Calling connection state change callback', { callbackId, debugId, connected: socket.connected });
        if (socket.connected) boundCallback(true, socket); else boundCallback(false, undefined);
        return () => {
          logger.silly('Deleting connection state change callback', { callbackId, debugId });
          connectionCallbacks.delete(callbackId);
        };
      }, []);
    },
  }), []);

  return (
    <SocketContext.Provider value={context}>
      {children}
    </SocketContext.Provider>
  );
});