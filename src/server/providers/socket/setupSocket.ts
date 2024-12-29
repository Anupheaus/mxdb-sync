import { is, type AnyFunction } from '@anupheaus/common';
import { Server } from 'socket.io';
import type { SocketContextProps } from './SocketContext';
import { useLogger } from '../logger';
import { useKoa } from '../koa';
import { provideUserData } from '../userData';
import { Context } from '../../contexts';
import { SocketIOParser } from '../../../common';
import { provideClient } from './provideClient';

export function setupSocket() {
  const { logger } = useLogger();
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
    socket.on('connection', client => provideUserData(client, () => {
      const clientLogger = logger.createSubLogger(client.id);
      const disconnectCallbacks = Array.from(onConnectedCallbacks)
        .mapWithoutNull(callback => provideClient({ client, logger: clientLogger },
          () => provideUserData(client, () => callback({ client, logger: clientLogger }))));

      client.on('disconnect', () => {
        clientLogger.info('Client disconnected');
        provideClient({ client, logger: clientLogger }, () => provideUserData(client, () => disconnectCallbacks.forEach(cb => cb())));
      });
    }));

    Context.set<SocketContextProps>('socket', {
      socket,
      onClientConnected: callback => {
        onConnectedCallbacks.add(callback);
      },
    });

    logger.info('Websocket ready.');
  } finally {
    socket.close();
  }
}
