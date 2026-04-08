import { fork, type ChildProcess } from 'child_process';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { MXDBCollection } from '../../../src/common';
import { E2E_MONGO_DB_NAME, E2E_SERVER_PROCESS_ENV } from './mongoConstants';
/** Default wait between server child exit and respawn (port / TIME_WAIT). */
const SERVER_RESTART_WAIT_MS = 1000;

let memoryServer: MongoMemoryReplSet | null = null;
let currentPort = 0;
let serverChild: ChildProcess | null = null;

type ServerLogCallback = (stream: 'stdout' | 'stderr', line: string) => void;
let serverLogCallback: ServerLogCallback | null = null;

function lifecycleLog(event: string, detail?: Record<string, unknown>) {
  if (!serverLogCallback) return;
  serverLogCallback('stdout', JSON.stringify({ type: 'lifecycle', event, detail, ts: new Date().toISOString() }));
}

export function setServerLogCallback(callback: ServerLogCallback | null) {
  serverLogCallback = callback;
}

export interface ServerInstance {
  port: number;
  stop(): Promise<void>;
}

/**
 * Start MongoDB Memory Server (replica set) and return its URI.
 * Change streams require a replica set, so we use MongoMemoryReplSet.
 */
export async function startMongo(): Promise<{ getUri: () => string; stop: () => Promise<void> }> {
  if (memoryServer == null) {
    memoryServer = await MongoMemoryReplSet.create({
      replSet: { count: 1 },
    });
  }
  return {
    getUri: () => memoryServer!.getUri(),
    stop: async () => {
      if (memoryServer != null) {
        await memoryServer.stop();
        memoryServer = null;
      }
    },
  };
}

/**
 * Start the MXDB sync server (HTTP + socket) on the given port. Uses existing Mongo Memory Server.
 */
export async function startServerInstance(
  port: number,
  mongoUri: string,
  _collectionsList: MXDBCollection[],
): Promise<ServerInstance> {
  if (serverChild != null) throw new Error('Server child already running');

  lifecycleLog('startServerInstance.spawn', { requestedPort: port });
  const child = fork(require.resolve('./serverProcess.cjs'), {
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: {
      ...process.env,
      [E2E_SERVER_PROCESS_ENV.PORT]: String(port),
      [E2E_SERVER_PROCESS_ENV.MONGO_URI]: mongoUri,
      [E2E_SERVER_PROCESS_ENV.MONGO_DB_NAME]: E2E_MONGO_DB_NAME,
    },
  });
  serverChild = child;
  lifecycleLog('startServerInstance.spawned', { pid: child.pid });

  if (child.stdout) {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      if (!serverLogCallback) return;
      String(chunk)
        .split(/\r?\n/u)
        .filter(line => line.length > 0)
        .forEach(line => serverLogCallback?.('stdout', line));
    });
  }
  if (child.stderr) {
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      if (!serverLogCallback) return;
      String(chunk)
        .split(/\r?\n/u)
        .filter(line => line.length > 0)
        .forEach(line => serverLogCallback?.('stderr', line));
    });
  }

  const actualPort = await new Promise<number>((resolve, reject) => {
    lifecycleLog('startServerInstance.waitReady.start', { timeoutMs: 20_000 });
    const timeout = setTimeout(() => {
      lifecycleLog('startServerInstance.waitReady.timeout', { timeoutMs: 20_000 });
      reject(new Error('Timed out waiting for server child ready'));
    }, 20_000);
    child.on('message', (msg: any) => {
      if (msg && msg.type === 'ready') {
        clearTimeout(timeout);
        lifecycleLog('startServerInstance.waitReady.ready', { port: msg.port });
        resolve(Number(msg.port));
        return;
      }
      if (msg && msg.type === 'server-log' && serverLogCallback) {
        // Forward structured server log message to the test run logger.
        // We serialise the payload so the logger API stays (stream, line).
        const line = JSON.stringify(msg);
        serverLogCallback('stdout', line);
      }
    });
    child.on('exit', code => {
      clearTimeout(timeout);
      lifecycleLog('startServerInstance.exitEarly', { code });
      reject(new Error(`Server child exited early (code ${code})`));
    });
    child.on('error', err => {
      clearTimeout(timeout);
      lifecycleLog('startServerInstance.error', { message: String((err as any)?.message ?? err) });
      reject(err);
    });
  });

  currentPort = actualPort;
  lifecycleLog('startServerInstance.ready', { actualPort });

  return {
    get port() {
      return currentPort;
    },
    async stop() {
      if (serverChild != null) {
        const proc = serverChild;
        serverChild = null;
        lifecycleLog('stopServerInstance.begin', { pid: proc.pid });
        await new Promise<void>((resolve, reject) => {
          const forceMs = 15_000;
          const t = setTimeout(() => {
            reject(new Error(`Server child pid ${proc.pid} did not exit within ${forceMs}ms`));
          }, forceMs);
          proc.once('exit', (code, signal) => {
            clearTimeout(t);
            lifecycleLog('stopServerInstance.exited', { code, signal });
            resolve();
          });
          proc.kill('SIGTERM');
        });
        lifecycleLog('stopServerInstance.done');
      }
    },
  };
}

export interface LifecycleState {
  mongoUri: string;
  port: number;
  stopServer(): Promise<void>;
  restartServer(): Promise<ServerInstance>;
}

/**
 * Start Mongo (if not already) and the HTTP/socket server. Returns state with restart capability.
 */
export async function startLifecycle(
  port: number,
  collectionsList: MXDBCollection[],
): Promise<LifecycleState> {
  lifecycleLog('startLifecycle.begin', { port });
  const mongo = await startMongo();
  const mongoUri = mongo.getUri();
  lifecycleLog('startLifecycle.mongoReady', { mongoUri });
  let instance = await startServerInstance(port, mongoUri, collectionsList);
  const portUsed = instance.port;
  lifecycleLog('startLifecycle.serverReady', { portUsed });

  async function stopServer() {
    lifecycleLog('lifecycle.stopServer.begin');
    await instance.stop();
    lifecycleLog('lifecycle.stopServer.done');
  }

  async function restartServer(): Promise<ServerInstance> {
    lifecycleLog('lifecycle.restart.begin');
    await instance.stop(); // awaits child `exit` (see ServerInstance.stop)
    lifecycleLog('lifecycle.restart.afterExit');
    await new Promise<void>(r => setTimeout(r, SERVER_RESTART_WAIT_MS));
    lifecycleLog('lifecycle.restart.postExitDelay', { waitMs: SERVER_RESTART_WAIT_MS });
    instance = await startServerInstance(portUsed, mongoUri, collectionsList);
    lifecycleLog('lifecycle.restart.ready', { portUsed: instance.port });
    return instance;
  }

  return {
    mongoUri,
    port: portUsed,
    stopServer,
    restartServer,
  };
}

/**
 * Stop the HTTP server and optionally the Mongo Memory Server. Call at end of test.
 */
export async function stopLifecycle(stopMongo = true): Promise<void> {
  if (serverChild != null) {
    const child = serverChild;
    serverChild = null;
    await new Promise<void>((resolve, reject) => {
      const forceMs = 15_000;
      const t = setTimeout(() => {
        reject(new Error(`Server child did not exit within ${forceMs}ms`));
      }, forceMs);
      child.once('exit', () => {
        clearTimeout(t);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
  if (stopMongo) {
    const mongo = await startMongo();
    await mongo.stop();
  }
}
