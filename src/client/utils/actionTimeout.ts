export const ACTION_TIMEOUT_MS = 5_000;

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });
  // Attach a no-op .catch() to the original promise so that if Promise.race
  // picks the timeout rejection and the underlying promise later rejects (e.g.
  // socket.io _clearAcks firing after transport close), it doesn't surface as
  // an unhandled promise rejection.
  promise.catch(() => { /* swallowed — timeout already rejected */ });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout != null) clearTimeout(timeout);
  }) as Promise<T>;
}

