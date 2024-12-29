import type { Server, Socket } from 'socket.io';
import type { Logger } from '@anupheaus/common';

export interface SocketClientConnectedProps {
  client: Socket;
  logger: Logger;
  // emit: <DataType = unknown, ReturnType = void>(event: string, data: DataType) => Promise<ReturnType>;
  // on: <DataType = unknown, ReturnType = void>(event: string, callback: (data: DataType) => ReturnType) => void;
}

export interface SocketContextProps {
  socket: Server;
  onClientConnected(callback: (props: SocketClientConnectedProps) => (() => void) | void): void;
}
