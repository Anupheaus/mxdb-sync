// Child process entrypoint: starts the MXDB sync server over HTTPS on a given port.
// Runs in its own process so we can "restart" by killing and respawning without
// hitting socket-api global handler registration conflicts.

require('ts-node/register/transpile-only');

const https = require('https');
const fs = require('fs');
const path = require('path');

const { Logger } = require('@anupheaus/common');
const { startServer } = require('../../src/server');
const { syncTestCollection } = require('./types');

const PORT = Number(process.env.SYNC_TEST_PORT || '0');
const MONGO_URI = process.env.SYNC_TEST_MONGO_URI;
const MONGO_DB_NAME = process.env.SYNC_TEST_MONGO_DB_NAME || 'mxdb-sync-test';

if (!MONGO_URI) {
  // eslint-disable-next-line no-console
  console.error('Missing env SYNC_TEST_MONGO_URI');
  process.exit(1);
}

function createIpcLogger(baseLogger, name) {
  const send = (level, args) => {
    const [message, ...rest] = args;
    const tsNano = process.hrtime.bigint();
    const tsIso = new Date().toISOString();
    if (typeof process.send === 'function') {
      process.send({
        type: 'server-log',
        logger: name,
        level,
        tsNano: tsNano.toString(),
        tsIso,
        message: String(message),
        args: rest,
      });
    }
  };

  const levels = new Set(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'log']);

  return new Proxy(baseLogger, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (String(prop) === 'createSubLogger' && typeof value === 'function') {
        return (...args) => {
          const sub = value.apply(target, args);
          const subName = args[0] != null ? String(args[0]) : 'sub';
          return createIpcLogger(sub, `${name}:${subName}`);
        };
      }
      if (typeof value === 'function' && levels.has(String(prop))) {
        return (...args) => {
          send(String(prop), args);
          return value.apply(target, args);
        };
      }
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

const baseLogger = new Logger('sync-test-server-child');
const logger = createIpcLogger(baseLogger, 'sync-test-server-child');

async function main() {
  const keyPath = path.join(__dirname, 'certs', 'localhost.key');
  const certPath = path.join(__dirname, 'certs', 'localhost.crt');
  const server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  });

  await startServer({
    name: 'sync-test',
    logger,
    collections: [syncTestCollection],
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

