import '@anupheaus/common';
import type { Socket } from 'socket.io';
import { Server } from 'socket.io';
import type { SocketContextProps } from './SocketContext';
import { provideLogger, useLogger } from '../logger';
import { useKoa } from '../koa';
import { Context } from '../../contexts';
import { SocketIOParser } from '../../../common';
import { provideClient } from './provideClient';

const clientDataStore = new WeakMap<Socket, Map<string, any>>();

export function setupSocket() {
  const logger = useLogger();
  const { server } = useKoa();

  logger.info('Connecting websocket...');
  const socket = new Server(server, {
    path: '/mxdb-sync',
    transports: ['websocket'],
    serveClient: false,
    parser: new SocketIOParser({ logger }),
  });
  try {
    const onConnectedCallbacks = new Set<Parameters<SocketContextProps['onClientConnected']>[0]>();
    socket.on('connection', client => {
      const clientLogger = logger.createSubLogger(client.id);
      const clientData = clientDataStore.set(client, clientDataStore.get(client) ?? new Map()).get(client)!;

      clientLogger.info('Client connected', { IPAddress: client.handshake.address });

      const disconnectCallbacks = Array.from(onConnectedCallbacks)
        .mapWithoutNull(provideLogger(clientLogger, provideClient({ client, data: clientData }, callback => callback({ client }))));


      client.on('disconnect', () => {
        clientLogger.info('Client disconnected');
        provideLogger(clientLogger, provideClient({ client, data: clientData }, () => disconnectCallbacks.forEach(cb => cb())))();
      });
    });

    const onClientConnected: SocketContextProps['onClientConnected'] = (callback: Parameters<SocketContextProps['onClientConnected']>[0]) => {
      onConnectedCallbacks.add(callback);
    };

    Context.set<SocketContextProps>('socket', {
      socket,
      onClientConnected,
    });

    logger.info('Websocket ready.');

    return onClientConnected;
  } finally {
    // socket.close();
  }
}
