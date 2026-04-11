import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import type { MXDBCollection, MXDBError, UnauthorisedOperationDetails } from '../common';
import type { Logger } from '@anupheaus/common';
import { useEffect, useMemo } from 'react';
import { LoggerProvider } from '@anupheaus/react-ui';
import { IndexedDbProvider } from './auth/IndexedDbProvider';
import { AuthProvider } from './auth/AuthProvider';
import { ConflictResolutionContext } from './providers';
import { setupBrowserTools } from './utils/setupBrowserTools';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  collections: MXDBCollection[];
  onInvalidToken?(): Promise<void>;
  onUnauthorisedOperation?(): Promise<UnauthorisedOperationDetails>;
  onError?(error: MXDBError): void;
  onConflictResolution?(message: string): Promise<boolean>;
  children?: ReactNode;
}

export const MXDBSync = createComponent('MXDBSync', ({
  host,
  name,
  logger,
  collections,
  onError,
  onConflictResolution,
  children,
}: Props) => {
  if (host != null) {
    const protocol = host.match(/^([a-z][a-z0-9+\-.]*:\/\/)/i)?.[1]?.toLowerCase();
    if (protocol != null && protocol !== 'wss://') {
      throw new Error(`MXDBSync: connection to "${host}" uses an insecure protocol. Only wss:// is allowed (§4.7).`);
    }
  }

  useEffect(() => { setupBrowserTools(); }, []);

  const conflictResolutionContext = useMemo(() => ({ onConflictResolution }), [onConflictResolution]);

  return (
    <LoggerProvider logger={logger} loggerName="MXDB-Sync">
      <ConflictResolutionContext.Provider value={conflictResolutionContext}>
        <IndexedDbProvider appName={name}>
          <AuthProvider appName={name} host={host} collections={collections} onError={onError}>
            {children}
          </AuthProvider>
        </IndexedDbProvider>
      </ConflictResolutionContext.Provider>
    </LoggerProvider>
  );
});
