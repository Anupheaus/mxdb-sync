import type { Logger } from '@anupheaus/common';
import net from 'net';
import { execFileSync } from 'child_process';

export interface WaitForBindablePortOptions {
  maxAttempts?: number;
  intervalMs?: number;
}

function canBindPort(p: number, logger: Logger): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer();
    const done = (ok: boolean) => {
      probe.removeAllListeners();
      resolve(ok);
    };
    probe.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') done(false);
      else {
        logger.warn(`Port ${p} probe error (${err.code ?? err.message}) — treating as in use`);
        done(false);
      }
    });
    probe.listen(p, () => {
      probe.close(() => done(true));
    });
  });
}

function killListenersOnPortWin32(p: number, logger: Logger) {
  let out: string;
  try {
    out = execFileSync('cmd.exe', ['/c', 'netstat -ano'], { encoding: 'utf8' });
  } catch {
    return;
  }
  const portToken = `:${p}`;
  const pids = new Set<number>();
  for (const line of out.split(/\r?\n/)) {
    if (!/LISTENING/i.test(line)) continue;
    const idx = line.indexOf(portToken);
    if (idx < 0) continue;
    const afterPort = line[idx + portToken.length];
    if (afterPort != null && afterPort !== ' ' && afterPort !== '\t') continue;
    const parts = line.trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const pid = Number.parseInt(last, 10);
    if (Number.isFinite(pid) && pid > 0 && pid !== process.pid) pids.add(pid);
  }
  for (const pid of pids) {
    try {
      execFileSync('taskkill', ['/F', '/PID', String(pid)], { stdio: 'ignore' });
      logger.info(`Killed PID ${pid} (was listening on port ${p})`);
    } catch { /* already gone */ }
  }
}

function killListenersOnPortUnix(p: number) {
  try {
    execFileSync('sh', ['-c', `lsof -ti :${p} | xargs -r kill -9`], { stdio: 'ignore' });
  } catch { /* ignore */ }
}

function killListenersOnPort(p: number, logger: Logger) {
  if (process.platform === 'win32') killListenersOnPortWin32(p, logger);
  else killListenersOnPortUnix(p);
}

/**
 * Until this process can `listen()` on `port`, optionally kills processes that are listening.
 * Uses a real TCP bind probe (same ground truth as `http.Server.listen`).
 */
export async function waitForBindablePort(
  port: number,
  logger: Logger,
  options?: WaitForBindablePortOptions,
): Promise<void> {
  const maxAttempts = options?.maxAttempts ?? 15;
  const intervalMs = options?.intervalMs ?? 300;

  logger.info(`Current PID: ${process.pid} — waiting until port ${port} can be bound...`);
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await canBindPort(port, logger)) {
      logger.info(`Port ${port} is bindable (attempt ${attempt})`);
      return;
    }
    logger.info(`Port ${port} not bindable (attempt ${attempt}/${maxAttempts}) — killing listeners...`);
    killListenersOnPort(port, logger);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new globalThis.Error(
    `Port ${port} still not bindable after ${maxAttempts} attempts — stop the other process or pick another port.`,
  );
}
