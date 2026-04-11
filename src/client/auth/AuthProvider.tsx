// src/client/auth/AuthProvider.tsx
/**
 * Owns the authentication lifecycle:
 *  - On mount: reads default IDB entry → WebAuthn PRF assertion → encryptionKey
 *  - Authenticated: renders DbsProvider → TokenProvider → children
 *  - Unauthenticated: renders children directly
 *  - signOut(): clears encryptionKey (unmounts everything below), preserves IDB
 *  - register(url): full invite flow, stores pendingAuth for TokenProvider
 */
import { createComponent, useLogger } from '@anupheaus/react-ui';
import type { ReactNode } from 'react';
import { useState, useEffect, useCallback, useContext, useMemo, useRef } from 'react';
import { ulid } from 'ulidx';
import { AuthContext } from './AuthContext';
import type { RegisterOptions } from './AuthContext';
import { IndexedDbContext } from './IndexedDbContext';
import { deriveEncryptionKey, deriveKeyFromPrfOutput, PRF_SALT } from './deriveEncryptionKey';
import { DbsProvider } from '../providers/dbs';
import { TokenProvider } from './TokenProvider';
import type { MXDBCollection, MXDBError } from '../../common';
import type { MXDBUserDetails, MXDBInitialRegistrationResponse } from '../../common/models';

// ─── Registration helpers (module-level, no React) ───────────────────────────

function extractRequestId(url: string): string | undefined {
  try { return new URL(url).searchParams.get('requestId') ?? undefined; }
  catch { return undefined; }
}

function generateDbName(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeKeyHash(keyBytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(keyBytes).buffer);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function collectDeviceDetails(): Record<string, unknown> {
  const details: Record<string, unknown> = {};
  if (typeof navigator !== 'undefined') {
    details.userAgent = navigator.userAgent;
    details.language = navigator.language;
    if ('platform' in navigator) details.platform = (navigator as any).platform;
    if ('vendor' in navigator) details.vendor = (navigator as any).vendor;
  }
  if (typeof screen !== 'undefined') {
    details.screenWidth = screen.width;
    details.screenHeight = screen.height;
    details.colorDepth = screen.colorDepth;
  }
  return details;
}

async function createWebAuthnCredential(
  userDetails: MXDBUserDetails,
  appName: string | undefined,
): Promise<{ credentialId: Uint8Array; prfOutput: ArrayBuffer }> {
  if (typeof navigator === 'undefined' || navigator.credentials == null)
    throw new Error('WebAuthn not supported.');
  const hostname = typeof window !== 'undefined' ? window.location.hostname : 'app';
  const rpName = appName ?? (typeof document !== 'undefined' && document.title ? document.title : hostname);
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: rpName },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: userDetails.name,
        displayName: userDetails.displayName ?? userDetails.name,
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      timeout: 60_000,
      attestation: 'none',
      extensions: { prf: { eval: { first: PRF_SALT } } } as any,
    },
  }) as PublicKeyCredential | null;
  if (credential == null) throw new Error('WebAuthn credential creation returned no credential.');
  const credentialId = new Uint8Array(credential.rawId);
  const prfOutput = (credential.getClientExtensionResults() as any)?.prf?.results?.first as ArrayBuffer | undefined;
  if (prfOutput == null) throw new Error('PRF output not supported.');
  return { credentialId, prfOutput };
}

async function fetchInitialRegistration(
  name: string,
  requestId: string,
): Promise<MXDBInitialRegistrationResponse> {
  const response = await fetch(`/${name}/register?requestId=${requestId}`, { method: 'GET' });
  const result = await response.json();
  if (typeof result !== 'object' || result == null) throw new Error('Invalid response from server.');
  if (typeof result.registrationToken !== 'string') throw new Error('Missing registration token.');
  if (typeof result.userDetails !== 'object') throw new Error('Missing user details.');
  return result as MXDBInitialRegistrationResponse;
}

async function fetchCompleteRegistration(
  name: string,
  registrationToken: string,
  keyHash: string,
  deviceDetails: unknown,
): Promise<string> {
  const response = await fetch(`/${name}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registrationToken, keyHash, deviceDetails }),
  });
  const result = await response.json();
  if (typeof result !== 'object' || result == null) throw new Error('Invalid response from server.');
  if (typeof result.token !== 'string') throw new Error('Missing token.');
  return result.token as string;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  appName: string;
  host?: string;
  collections: MXDBCollection[];
  onError?(error: MXDBError): void;
  children?: ReactNode;
}

export const AuthProvider = createComponent('AuthProvider', ({
  appName,
  host,
  collections,
  onError,
  children,
}: Props) => {
  const logger = useLogger('Auth');
  const dbsLogger = useLogger('Dbs');
  const { getDefault, saveEntry } = useContext(IndexedDbContext);
  const [encryptionKey, setEncryptionKey] = useState<Uint8Array | undefined>();
  const [dbName, setDbName] = useState<string | undefined>();
  const [pendingAuth, setPendingAuth] = useState<{ token: string; keyHash: string } | undefined>();
  const [loaded, setLoaded] = useState(false);
  const channelRef = useRef<BroadcastChannel | null>(null);

  // ── Bootstrap: read IDB → WebAuthn → derive key ──────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const entry = await getDefault();
        if (entry != null) {
          logger.info('IDB entry found, deriving encryption key via WebAuthn');
          const key = await deriveEncryptionKey(entry.credentialId);
          setDbName(entry.dbName);
          setEncryptionKey(key);
        }
      } catch (err) {
        logger.error('Failed to derive encryption key', { error: err });
        onError?.({
          code: 'ENCRYPTION_FAILED',
          message: err instanceof Error ? err.message : 'Failed to derive encryption key',
          severity: 'fatal',
          originalError: err,
        });
      } finally {
        setLoaded(true);
      }
    })();
  }, []);

  // ── BroadcastChannel: cross-tab sign-out ─────────────────────────────────
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`mxdb-auth-${appName}`);
    channelRef.current = channel;
    channel.onmessage = ({ data }: MessageEvent<{ type: string }>) => {
      if (data?.type === 'signed-out') {
        setEncryptionKey(undefined);
        setDbName(undefined);
        setPendingAuth(undefined);
      }
    };
    return () => { channel.close(); channelRef.current = null; };
  }, [appName]);

  // ── signOut: clear in-memory key only — IDB entry (isDefault) preserved ──
  // On page reload, the bootstrap will find the IDB entry and re-derive the key
  // via WebAuthn automatically. signOut only ends the current session.
  const signOut = useCallback(() => {
    setEncryptionKey(undefined);
    setDbName(undefined);
    setPendingAuth(undefined);
    channelRef.current?.postMessage({ type: 'signed-out' });
  }, []);

  // ── register: full invite flow ────────────────────────────────────────────
  const register = useCallback(async (
    url: string,
    _options?: RegisterOptions,
  ): Promise<{ userDetails: MXDBUserDetails }> => {
    const requestId = extractRequestId(url);
    if (requestId == null) throw new Error('Invalid invite URL: missing requestId parameter.');

    const { userDetails, registrationToken } = await fetchInitialRegistration(appName, requestId);
    const newDbName = generateDbName();
    const { credentialId, prfOutput } = await createWebAuthnCredential(userDetails, undefined);
    const encKey = await deriveKeyFromPrfOutput(prfOutput);
    const keyHash = await computeKeyHash(encKey);
    const deviceDetails = collectDeviceDetails();
    const token = await fetchCompleteRegistration(appName, registrationToken, keyHash, deviceDetails);

    await saveEntry({ id: ulid(), credentialId, dbName: newDbName, isDefault: true });

    setDbName(newDbName);
    setEncryptionKey(encKey);
    setPendingAuth({ token, keyHash });

    return { userDetails };
  }, [appName, saveEntry]);

  const authContext = useMemo(() => ({
    isAuthenticated: encryptionKey != null,
    signOut,
    register,
  }), [encryptionKey, signOut, register]);

  if (!loaded) return null;

  return (
    <AuthContext.Provider value={authContext}>
      {encryptionKey != null && dbName != null ? (
        <DbsProvider name={dbName} encryptionKey={encryptionKey} collections={collections} logger={dbsLogger}>
          <TokenProvider
            appName={appName}
            host={host}
            collections={collections}
            onError={onError}
            initialAuth={pendingAuth}
          >
            {children}
          </TokenProvider>
        </DbsProvider>
      ) : children}
    </AuthContext.Provider>
  );
});
