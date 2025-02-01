
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
const port = 3010;

const logger = new Logger('mxdb-sync');

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
  });
  configureStaticFiles(app);
  configureViews(app);
  logger.info(`Server listening on port ${port}...`);
  server.listen(port);
}

start();