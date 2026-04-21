import type { Socket } from 'socket.io';
import type { ServerToClientSynchronisation } from '../../ServerToClientSynchronisation';

const store = new WeakMap<Socket, ServerToClientSynchronisation>();

export function registerClientS2C(socket: Socket, s2c: ServerToClientSynchronisation): void {
  store.set(socket, s2c);
}

export function unregisterClientS2C(socket: Socket): void {
  store.delete(socket);
}

export function lookupClientS2C(socket: Socket): ServerToClientSynchronisation | undefined {
  return store.get(socket);
}
