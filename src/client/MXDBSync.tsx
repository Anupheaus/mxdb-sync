import { createComponent } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useRef } from 'react';
import type { Logger } from '@anupheaus/common';
import { LoggerProvider } from '@anupheaus/react-ui';
import { SocketAPI } from '@anupheaus/socket-api/client';
import { ConflictResolutionContext } from './providers';
import { MXDBSyncInner } from './auth/MXDBSyncInner';
import { setupBrowserTools } from './utils/setupBrowserTools';
import type { MXDBCollection, MXDBError } from '../common';
import type { MXDBUserDetails } from '../common/models';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  collections: MXDBCollection[];
  onDeviceDisabled?(): void;
  onSignedIn?(user: MXDBUserDetails): void;
  onSignedOut?(): void;
  onError?(error: MXDBError): void;
  onConflictResolution?(message: string): Promise<boolean>;
  children?: ReactNode;
}

export const MXDBSync = createComponent('MXDBSync', ({
  host,
  name,
  logger,
  collections,
  onDeviceDisabled,
  onSignedIn,
  onSignedOut,
  onError,
  onConflictResolution,
  children,
}: Props) => {
  if (host != null) {
    const protocol = host.match(/^([a-z][a-z0-9+\-.]*:\/\/)/i)?.[1]?.toLowerCase();
    if (protocol != null && protocol !== 'wss://') {
      throw new Error(`MXDBSync: connection to "${host}" uses an insecure protocol. Only wss:// is allowed.`);
    }
  }

  useEffect(() => { setupBrowserTools(name); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const conflictResolutionContext = useMemo(() => ({ onConflictResolution }), [onConflictResolution]);

  const onPrfRef = useRef<((userId: string, prfOutput: ArrayBuffer) => void) | undefined>(undefined);

  return (
    <LoggerProvider logger={logger} loggerName="MXDB-Sync">
      <ConflictResolutionContext.Provider value={conflictResolutionContext}>
        <SocketAPI
          name={name}
          host={host}
          onPrf={(userId, prfOutput) => onPrfRef.current?.(userId, prfOutput)}
          onDeviceDisabled={onDeviceDisabled}
          onSignedIn={onSignedIn ? (user) => onSignedIn(user as MXDBUserDetails) : undefined}
          onSignedOut={onSignedOut}
        >
          <MXDBSyncInner
            appName={name}
            collections={collections}
            onPrfRef={onPrfRef}
            onError={onError}
            onSignedIn={onSignedIn}
            onSignedOut={onSignedOut}
          >
            {children}
          </MXDBSyncInner>
        </SocketAPI>
      </ConflictResolutionContext.Provider>
    </LoggerProvider>
  );
});
