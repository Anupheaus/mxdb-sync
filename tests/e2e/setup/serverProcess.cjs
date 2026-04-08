// Child process entrypoint: starts the MXDB sync server over HTTPS on a given port.
// Runs in its own process so we can "restart" by killing and respawning without
// hitting socket-api global handler registration conflicts.

require('ts-node/register/transpile-only');
require('tsconfig-paths/register');

const https = require('https');
const fs = require('fs');
const path = require('path');

const { Logger } = require('@anupheaus/common');
const { startServer } = require('../../../src/server');
const { e2eTestCollection } = require('./types');
const {
  E2E_MONGO_DB_NAME,
  E2E_SERVER_PROCESS_ENV,
  E2E_SOCKET_API_NAME,
} = require('./mongoConstants');

const PORT = Number(process.env[E2E_SERVER_PROCESS_ENV.PORT] || '0');
const MONGO_URI = process.env[E2E_SERVER_PROCESS_ENV.MONGO_URI];
const MONGO_DB_NAME = process.env[E2E_SERVER_PROCESS_ENV.MONGO_DB_NAME] || E2E_MONGO_DB_NAME;

if (!MONGO_URI) {
  // eslint-disable-next-line no-console
  console.error(`Missing env ${E2E_SERVER_PROCESS_ENV.MONGO_URI}`);
  process.exit(1);
}

// Force all Logger instances in this process to log at silly level (0) regardless of env vars,
// then forward every entry to the test worker via IPC so they appear in the e2e run log file.
Object.defineProperty(Logger.prototype, 'getMinLevel', {
  value: () => 0,
  writable: true,
  configurable: true,
});

Logger.registerListener({
  maxEntries: 1,
  onTrigger(entries) {
    if (typeof process.send !== 'function') return;
    for (const entry of entries) {
      const { getLevelAsString } = require('@anupheaus/common').Logger;
      process.send({
        type: 'server-log',
        logger: entry.names.join(' > '),
        level: getLevelAsString(entry.level),
        tsNano: process.hrtime.bigint().toString(),
        tsIso: entry.timestamp.toISO(),
        message: entry.message,
        args: entry.meta != null ? [entry.meta] : [],
      });
    }
  },
});

const logger = new Logger('mxdb-e2e-server');

async function main() {
  const keyPath = path.join(__dirname, 'certs', 'localhost.key');
  const certPath = path.join(__dirname, 'certs', 'localhost.crt');
  const server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  });

  await startServer({
    name: E2E_SOCKET_API_NAME,
    logger,
    collections: [e2eTestCollection],
    server,
    mongoDbName: MONGO_DB_NAME,
    mongoDbUrl: MONGO_URI,
  });

  await new Promise((resolve, reject) => {
    server.listen(PORT, () => resolve());
    server.once('error', reject);
  });

  const addr = server.address();
  const actualPort = addr && typeof addr === 'object' ? addr.port : PORT;
  if (process.send) process.send({ type: 'ready', port: actualPort });

  const shutdown = () => {
    server.close(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
