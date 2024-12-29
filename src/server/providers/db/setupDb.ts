import type { Logger } from '@anupheaus/common';
import type { Db } from 'mongodb';
import { MongoClient } from 'mongodb';
import { useLogger } from '../logger';
import { WatchStream } from './WatchStream';
import { Context } from '../../contexts';
import type { DbContextProps } from './DbContext';
import { useUserData } from '../userData';
import { useSocket } from '../socket';

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
  const { logger } = useLogger();
  const { getData, isDataAvailable } = useUserData();
  const { onClientConnected } = useSocket();
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
    const watchStream = new WatchStream(db);

    const registerWatchWithClient = (watchId: string) => {
      if (!isDataAvailable()) return;
      const watches = getData<Set<string>>('watches', () => new Set());
      watches.add(watchId);
    };

    onClientConnected(({ logger: clientLogger }) => () => {
      if (!isDataAvailable()) return;
      const watches = getData<Set<string>>('watches');
      if (watches == null) return;
      clientLogger.debug('Removing client database watches...', { watchCount: watches.size });
      watches.forEach(watchId => watchStream.removeWatch(watchId));
      clientLogger.debug('Database watches closed successfully.', { remainingWatches: watchStream.count });
    });

    Context.set<DbContextProps>('db', {
      db,
      onWatch: (watchId, collection, callback) => {
        registerWatchWithClient(watchId);
        watchStream.addWatch(watchId, collection.name, callback);
      },
      removeWatch: watchStream.removeWatch,
    });
  } catch (error) {
    logger.error('An unexpected error has occurred with the database.', { error });
    await client.close();
  }
}