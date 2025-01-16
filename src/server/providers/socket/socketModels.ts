import type { Socket } from 'socket.io';

export interface UseClient {
  client: Socket;
  data: Map<string, any>;
}