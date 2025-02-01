// import { createComponent, useBound, useId, useMap, useOnUnmount } from '@anupheaus/react-ui';
// import type { ReactNode } from 'react';
// import { useLayoutEffect, useMemo, useRef, useState } from 'react';
// import type { Socket } from 'socket.io-client';
// import { io } from 'socket.io-client';
// import type { SocketContextProps } from './SocketContext';
// import { SocketContext } from './SocketContext';
// import { SocketIOParser } from '../../../common';
// import { useLogger } from '../../logger';
// import { InternalError, type AnyFunction } from '@anupheaus/common';

// interface CallbackRecord {
//   callback: (isConnected: boolean, socket: Socket | undefined) => void;
//   debugId?: string;
// }

// interface Props {
//   children?: ReactNode;
// }

// export const SocketProvider = createComponent('SocketProvider', ({
//   children,
// }: Props) => {
//   const logger = useLogger();
//   const customEvents = useMap<string, AnyFunction>();
//   const [uniqueConnectionId, setUniqueConnectionId] = useState('');
//   const socketRef = useRef<Socket>();

//   const getSocket = () => {
//     const sck = socketRef.current;
//     if (sck == null) throw new InternalError('Socket is not available yet.');
//     return sck;
//   };

//   useMemo(() => {
//     logger.info('Connecting socket to server...');
//     const sck = io({ path: '/mxdb-sync', transports: ['websocket'], parser: new SocketIOParser({ logger }), forceNew: true, autoConnect: false });
//     let isConnected = false;

//     sck.on('connect', () => {
//       if (isConnected) return; // prevent multiple calls
//       isConnected = true;
//       logger.debug('Socket connected to server', { id: sck.id });
//       connectionCallbacks.forEach(({ callback, debugId }, callbackId) => {
//         logger.silly('Calling connection state change callback from connect', { callbackId, debugId, connected: true });
//         callback(true, sck);
//       });
//     });
//     sck.on('disconnect', () => {
//       if (!isConnected) return; // prevent multiple calls
//       isConnected = false;
//       logger.debug('Socket disconnected from server', { id: sck.id });
//       connectionCallbacks.forEach(({ callback, debugId }, callbackId) => {
//         logger.silly('Calling connection state change callback from connect', { callbackId, debugId, connected: false });
//         callback(false, undefined);
//       });
//     });
//     sck.on('connect_error', error => logger.error('Socket connection error', { error }));
//     if (uniqueConnectionId === '') sck.connect(); // only connect if the unique connection id is not set
//     socketRef.current = sck;
//   }, [uniqueConnectionId]);
//   const connectionCallbacks = useMap<string, CallbackRecord>();

//   const disconnectSocket = useBound(() => {
//     const socket = getSocket();
//     Array.from(customEvents.entries()).forEach(([event, handler]) => socket.removeListener(event, handler));
//     customEvents.clear();
//     socket.disconnect();
//     setUniqueConnectionId(Math.uniqueId());
//   });

//   const context = useMemo<SocketContextProps>(() => ({
//     getSocket() {
//       const socket = getSocket();
//       if (socket.connected) return socket;
//     },
//     onConnectionStateChange(callback, debugId) {
//       const callbackId = useId();
//       const boundCallback = useBound(callback);
//       logger.silly('Registering connection state change callback', { callbackId, debugId });
//       connectionCallbacks.set(callbackId, { callback: boundCallback, debugId });
//       useLayoutEffect(() => {
//         const socket = getSocket();
//         logger.silly('Calling connection state change callback', { callbackId, debugId, connected: socket.connected });
//         if (socket.connected) boundCallback(true, socket); else boundCallback(false, undefined);
//         return () => {
//           logger.silly('Deleting connection state change callback', { callbackId, debugId });
//           connectionCallbacks.delete(callbackId);
//         };
//       }, []);
//     },
//     fakeDisconnect() {
//       disconnectSocket();
//     },
//     fakeReconnect() {
//       const socket = getSocket();
//       socket.connect();
//     },
//     on(event, callback) {
//       context.onConnectionStateChange(isConnected => {
//         const socket = getSocket();
//         const previousHandler = customEvents.get(event);
//         if (previousHandler != null) socket.removeListener(event, previousHandler);
//         customEvents.delete(event);
//         if (!isConnected) return;
//         const handler = (data: any, response: AnyFunction) => response(callback(data));
//         customEvents.set(event, handler);
//         socket.on(event, handler);
//       });
//     },
//   }), []);

//   useOnUnmount(() => disconnectSocket());

//   return (
//     <SocketContext.Provider value={context}>
//       {children}
//     </SocketContext.Provider>
//   );
// });