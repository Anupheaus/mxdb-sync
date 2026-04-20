export function setupBrowserTools(appName: string) {
  // Setup some tools we can use in the browser
  const tools: Record<string, unknown> = {
    async listDatabases() {
      const getDirectory = globalThis.navigator?.storage?.getDirectory?.bind(globalThis.navigator?.storage) as undefined | (() => Promise<FileSystemDirectoryHandle>);
      if (typeof getDirectory !== 'function') {
        throw new Error('OPFS is not available in this environment (navigator.storage.getDirectory missing).');
      }

      const root = await getDirectory();

      const results: string[] = [];

      const isSqliteFileName = (name: string) => {
        const lower = name.toLowerCase();
        if (lower.endsWith('.enc')) return true; // mxdb encrypted DB blob
        if (lower.endsWith('.sqlite3') || lower.endsWith('.sqlite') || lower.endsWith('.db')) return true;
        if (lower.endsWith('.sqlite3-wal') || lower.endsWith('.sqlite3-shm')) return true;
        if (lower.endsWith('.sqlite-wal') || lower.endsWith('.sqlite-shm')) return true;
        if (lower.endsWith('.db-wal') || lower.endsWith('.db-shm')) return true;
        return false;
      };

      const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        for await (const [name, handle] of (dir as any).entries()) {
          const path = prefix ? `${prefix}/${name}` : name;
          if (handle.kind === 'directory') {
            await walk(handle as FileSystemDirectoryHandle, path);
            continue;
          }
          if (handle.kind === 'file' && isSqliteFileName(name)) {
            results.push(path);
          }
        }
      };

      await walk(root, '');
      results.sort((a, b) => a.localeCompare(b));
      return results;
    },
  };

  // Dev-only auth bypass tools — eliminated entirely in production builds
  if (process.env.NODE_ENV !== 'production') {
    tools['setDevAuth'] = async (userId: string) => {
      const res = await fetch(`/${appName}/dev/signin`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (!res.ok) throw new Error(`Dev auth failed: ${res.status}`);
      localStorage.setItem(`mxdb:dev-auth:${appName}`, JSON.stringify({ userId }));
      window.location.reload();
    };
    tools['clearDevAuth'] = () => {
      localStorage.removeItem(`mxdb:dev-auth:${appName}`);
      window.location.reload();
    };
  }

  (window as any).mxdb = tools;
}