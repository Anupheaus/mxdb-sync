
import { config } from 'dotenv';
config();
import { Logger } from '@anupheaus/common';
import { startServer } from '../../src/server';
import http from 'http';
import { configureViews } from './configureViews';
import { configureStaticFiles } from './configureStaticFiles';
import { collections } from '../common';
import { actions } from './configureActions';
import { privateKey } from './private-key';

const mongoDbName = process.env.MONGO_DB_NAME as string;
const mongoDbUrl = process.env.MONGO_DB_URI as string;
const newRelicApiKey = process.env.NEW_RELIC_LOGGING_API_KEY as string;
const port = 3010;

const loggerService = Logger.services.useNewRelic(newRelicApiKey);

Logger.registerListener({
  sendInterval: {
    seconds: 2,
  },
  maxEntries: 100,
  onTrigger: loggerService,
});

const logger = new Logger('MXDB-Sync');

async function start() {
  const server = http.createServer();
  const { app } = await startServer({
    name: 'mxdb-sync-test',
    logger,
    collections,
    actions,
    server,
    mongoDbName,
    mongoDbUrl,
    privateKey,
    clientLoggingService: () => loggerService,
  });
  configureStaticFiles(app);
  configureViews(app);
  logger.info(`Server listening on port ${port}...`);
  server.listen(port);
}

start();