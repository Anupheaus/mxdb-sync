import { createContext } from 'react';
import type { Socket } from 'socket.io-client';

export interface SocketContextProps {
  getSocket(): Socket | undefined;
  onConnectionStateChange(callback: (isConnected: boolean, socket: Socket | undefined) => void, debugId?: string): void;
}

export const SocketContext = createContext<SocketContextProps>({
  getSocket: () => undefined,
  onConnectionStateChange: () => void 0,
});
