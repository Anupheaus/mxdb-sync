import type { AnyFunction } from '@anupheaus/common';
import { is } from '@anupheaus/common';
import { Server } from 'socket.io';
import type { SocketContextProps } from './SocketContext';
import { useLogger } from '../logger';
import { useKoa } from '../koa';
import { provideUserData } from '../userData';
import { Context } from '../../contexts';
import { SocketIOParser } from '../../../common';

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
      const registeredListeners = new Map<string, AnyFunction>();
      const emit = <DataType = unknown, ReturnType = void>(event: string, data: DataType): Promise<ReturnType> => client.emitWithAck(event, data);
      const on = <DataType = unknown, ReturnType = void>(event: string, callback: (data: DataType) => ReturnType) => {
        if (registeredListeners.has(event)) throw new Error(`Listener for event '${event}' already registered.`);
        const handler = (...args: unknown[]) => provideUserData(client, async () => {
          const requestId = Math.uniqueId();
          const response = args.pop();
          clientLogger.info('Request', { event, args, requestId });
          const result = await (callback as Function)(...args);
          clientLogger.info('Response', { event, result, requestId });
          if (is.function(response)) response(result);
        });
        clientLogger.debug('Registering listener', { event });
        client.on(event, handler);
        registeredListeners.set(event, handler);
      };
      const disconnectCallbacks = Array.from(onConnectedCallbacks).map(callback => {
        const dcCallback = callback({ client, logger: clientLogger, emit, on });
        return () => {
          registeredListeners.forEach((handler, event) => {
            clientLogger.debug('Unregistering listener', { event });
            client.off(event, handler);
          });
          dcCallback?.();
        };
      });
      client.on('disconnect', () => provideUserData(client, () => disconnectCallbacks.forEach(cb => cb())));
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
