import type { Logger } from '@anupheaus/common';
import type { Db } from 'mongodb';
import { MongoClient } from 'mongodb';
import { WatchStream } from './WatchStream';
import { Context } from '../../contexts';
import type { DbContextProps } from './DbContext';
import { useLogger, useSocketAPI } from '@anupheaus/socket-api/server';

async function clearDatabase(db: Db) {
  const collections = await db.collections();
  for (const collection of collections) {
    await collection.drop();
  }
}

async function connectToDb(mongoDbName: string, mongoDbUrl: string, logger: Logger) {
  const client = new MongoClient(mongoDbUrl);

  logger.info(`Connecting to database "${mongoDbName}"...`);
  try {
    await client.connect();
  } catch (error) {
    if (error instanceof Error) {
      logger.error('Failed to connect to database, could this be that this server\'s IP address is not configured on Atlas?');
    } else {
      logger.error('Failed to connect to database', { error });
    }
    await Promise.delay(10000);
    return connectToDb(mongoDbName, mongoDbUrl, logger);
  }
}

export async function setupDb(mongoDbName: string, mongoDbUrl: string, shouldClearDatabase: boolean) {
  const logger = useLogger();
  const client = new MongoClient(mongoDbUrl);

  client.on('error', error => {
    logger.error('Database direct error', { error });
  });

  client.on('commandStarted', event => {
    logger.debug('Database command started', { event });
  });

  client.on('commandFailed', event => {
    logger.debug('Database command failed', { event });
  });

  client.on('commandSucceeded', event => {
    logger.debug('Database command succeeded', { event });
  });

  client.on('connectionClosed', event => {
    logger.debug('Database connection closed unexpectedly', { event });
  });

  client.on('close', () => {
    logger.debug('Database connection closed');
  });

  try {
    await connectToDb(mongoDbName, mongoDbUrl, logger);
    logger.info('Connected to database successfully.');
    const db = client.db(mongoDbName);
    if (shouldClearDatabase) await clearDatabase(db);
    const watchStream = new WatchStream(db, logger);

    const onClientDisconnected = () => {
      const { getData } = useSocketAPI();
      const clientLogger = useLogger();
      const watches = getData<Set<string>>('watches');
      if (watches == null) return;
      clientLogger.debug('Removing client database watches...', { watchCount: watches.size });
      watches.forEach(watchId => watchStream.removeWatch(watchId));
      clientLogger.debug('Database watches closed successfully.', { remainingWatches: watchStream.count });
    };

    Context.set<DbContextProps>('db', {
      db,
      onWatch: (watchId, collection, callback) => {
        const { client: socketClient, getData } = useSocketAPI();
        watchId = `${socketClient.id}-${collection.name}-${watchId}`; // add the client id and collection name to the watch id so that it is unique
        const clientLogger = useLogger();
        const watches = getData<Set<string>>('watches', () => new Set());
        watches.add(watchId);
        clientLogger.silly('Adding watch to database', { watchId, collectionName: collection.name });
        watchStream.addWatch(watchId, collection.name, callback);
      },
      removeWatch: watchStream.removeWatch,
    });

    return {
      onClientDisconnected,
    };
  } catch (error) {
    logger.error('An unexpected error has occurred with the database.', { error });
    await client.close();
    throw error;
  }
}