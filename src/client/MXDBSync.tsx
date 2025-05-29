import { createComponent, LoggerProvider } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { SyncProvider, DbsProvider, ClientToServerProvider, ServerToClientProvider } from './providers';
import type { MXDBCollection, UnauthorisedOperationDetails } from '../common';
import { SocketAPI } from '@anupheaus/socket-api/client';
import type { Logger } from '@anupheaus/common';

interface Props {
  host?: string;
  name: string;
  logger?: Logger;
  collections: MXDBCollection[];
  onInvalidToken?(): Promise<void>;
  onUnauthorisedOperation?(): Promise<UnauthorisedOperationDetails>;
  children?: ReactNode;
}

export const MXDBSync = createComponent('MXDBSync', ({
  host,
  name,
  logger,
  collections,
  children,
}: Props) => {
  return (
    <LoggerProvider logger={logger} loggerName="MXDB-Sync">
      <SocketAPI host={host} name={name}>
        <DbsProvider name={name} collections={collections}>
          <SyncProvider>
            <ClientToServerProvider />
            <ServerToClientProvider />
            {children}
          </SyncProvider>
        </DbsProvider>
      </SocketAPI>
    </LoggerProvider>
  );
});
