import { useContext } from 'react';
import { SocketContext } from './SocketContext';
import { useBound } from '@anupheaus/react-ui';
import { InternalError } from '@anupheaus/common';
import type { Socket } from 'socket.io-client';

export function useSocket() {
  const { getSocket, onConnectionStateChange, fakeDisconnect, fakeReconnect, on } = useContext(SocketContext);
  const isConnected = useBound(() => getSocket() != null);

  const emit = useBound(async <ReturnType = void, DataType = unknown>(event: string, data: DataType): Promise<ReturnType> => {
    const socket = getSocket();
    if (socket == null) throw new InternalError('Socket is not connected');
    return socket.emitWithAck(event, data);
  });

  // const on = useBound(<DataType = unknown, ReturnType = unknown>(event: string, callback: (data: DataType) => ReturnType) => onConnectionStateChange((isNowConnected, socket) => {
  //   if (!isNowConnected || socket == null) return;
  //   console.log('registering on event', { event, isNowConnected });
  //   socket.off(event);        
  //   socket.on(event, (data, response) => {
  //     console.log('on event called', { event, data });
  //     return response(callback(data));
  //   });
  // }));

  const onConnected = (callback: (socket: Socket) => void, debugId?: string) => onConnectionStateChange((_result, socket) => {
    if (socket) callback(socket);
  }, debugId);

  const onDisconnected = (callback: () => void) => onConnectionStateChange((_result, socket) => {
    if (socket == null) callback();
  });

  return {
    isConnected,
    onConnected,
    onDisconnected,
    onConnectionStateChange,
    getSocket,
    emit,
    on,
    fakeDisconnect,
    fakeReconnect,
  };
}