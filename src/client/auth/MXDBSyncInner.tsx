import { createComponent, useLogger } from '@anupheaus/react-ui';
import type { ReactNode, MutableRefObject } from 'react';
import { useState, useEffect, useRef } from 'react';
import { useAuthentication } from '@anupheaus/socket-api/client';
import { DbsProvider } from '../providers/dbs';
import { ClientToServerSyncProvider, ClientToServerProvider } from '../providers/client-to-server';
import { ServerToClientProvider } from '../providers/server-to-client';
import { deriveKey } from './deriveKey';
import type { MXDBCollection, MXDBError } from '../../common';
import type { MXDBUserDetails } from '../../common/models';

interface Props {
  appName: string;
  collections: MXDBCollection[];
  onPrfRef: MutableRefObject<((userId: string, prfOutput: ArrayBuffer) => void) | undefined>;
  onError?(error: MXDBError): void;
  onDeviceDisabled?(): void;
  onSignedIn?(user: MXDBUserDetails): void;
  onSignedOut?(): void;
  children?: ReactNode;
}

export const MXDBSyncInner = createComponent('MXDBSyncInner', ({
  appName,
  collections,
  onPrfRef,
  onError,
  onSignedIn,
  onSignedOut,
  children,
}: Props) => {
  const logger = useLogger('MXDBSyncInner');
  const { user, signIn } = useAuthentication<MXDBUserDetails>();
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | undefined>();
  const [dbName, setDbName] = useState<string | undefined>();
  const channelRef = useRef<BroadcastChannel | null>(null);
  const prevUserRef = useRef<MXDBUserDetails | undefined>(undefined);
  const reauthInProgressRef = useRef(false);

  // Dev bypass (non-production only)
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    const devJson = typeof localStorage !== 'undefined'
      ? localStorage.getItem(`mxdb:dev-auth:${appName}`)
      : null;
    if (devJson == null) return;
    try {
      const { userId } = JSON.parse(devJson) as { userId: string };
      logger.info('[dev] dev bypass auth');
      localStorage.removeItem(`mxdb:dev-auth:${appName}`);
      setDbName(userId);
      setEncryptionKey(new Uint8Array(32).fill(0xde));
    } catch {
      localStorage.removeItem(`mxdb:dev-auth:${appName}`);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // BroadcastChannel: cross-tab sign-out
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`mxdb-auth-${appName}`);
    channelRef.current = channel;
    channel.onmessage = ({ data }: MessageEvent<{ type: string }>) => {
      if (data?.type === 'signed-out') {
        setEncryptionKey(undefined);
        setDbName(undefined);
      }
    };
    return () => { channel.close(); channelRef.current = null; };
  }, [appName]);

  // Wire onPrf handler into the ref MXDBSync holds
  useEffect(() => {
    onPrfRef.current = async (userId: string, prfOutput: ArrayBuffer) => {
      try {
        const key = await deriveKey(prfOutput);
        setEncryptionKey(key);
        setDbName(userId);
        reauthInProgressRef.current = false;
      } catch (err) {
        reauthInProgressRef.current = false;
        onError?.({
          code: 'ENCRYPTION_FAILED',
          message: err instanceof Error ? err.message : 'Key derivation failed',
          severity: 'fatal',
          originalError: err,
        });
      }
    };
    return () => { onPrfRef.current = undefined; };
  }, [onPrfRef, onError]);

  // React to user state changes
  useEffect(() => {
    const prev = prevUserRef.current;
    prevUserRef.current = user;

    if (user == null && prev != null) {
      setEncryptionKey(undefined);
      setDbName(undefined);
      channelRef.current?.postMessage({ type: 'signed-out' });
      onSignedOut?.();
      return;
    }

    if (user != null && prev == null) {
      onSignedIn?.(user);
    }

    if (user != null && encryptionKey == null && !reauthInProgressRef.current) {
      reauthInProgressRef.current = true;
      signIn().catch((err: unknown) => {
        reauthInProgressRef.current = false;
        onError?.({
          code: 'AUTH_REJECTED',
          message: err instanceof Error ? err.message : 'WebAuthn reauth failed',
          severity: 'fatal',
          originalError: err,
        });
      });
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (encryptionKey == null || dbName == null) {
    return <>{children}</>;
  }

  return (
    <DbsProvider name={dbName} encryptionKey={encryptionKey} collections={collections} logger={logger}>
      <ClientToServerSyncProvider collections={collections} onError={onError}>
        <ClientToServerProvider />
        <ServerToClientProvider />
        {children}
      </ClientToServerSyncProvider>
    </DbsProvider>
  );
});
