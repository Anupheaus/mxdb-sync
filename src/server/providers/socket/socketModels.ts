import type { Logger } from '@anupheaus/common';
import type { Socket } from 'socket.io';
// import type { SocketClientConnectedProps } from './SocketContext';

// type SocketOn = SocketClientConnectedProps['on'];
// type SocketEmit = SocketClientConnectedProps['emit'];

// export { SocketOn, SocketEmit };

export interface UseClient {
  client: Socket;
  logger: Logger;
  // on: SocketOn;
  // emit: SocketEmit;
}