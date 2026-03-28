import { useContext } from 'react';
import { AuthTokenContext } from '../auth/AuthTokenContext';
import { PRF_SALT, deriveKeyFromPrfOutput } from '../auth/deriveEncryptionKey';
import type { MXDBUserDetails, MXDBInitialRegistrationResponse } from '../../common/models';
import type { MXDBAuthEntry } from '../auth/IndexedDbAuthStore';
import { is } from '@anupheaus/common';
import { useBound } from '@anupheaus/react-ui';
import { ulid } from 'ulidx';

export interface UseMXDBInviteOptions {
  deviceDetails?: unknown;
  appName?: string;
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

function extractRequestId(url: string): string | undefined {
  try {
    return new URL(url).searchParams.get('requestId') ?? undefined;
  } catch {
    return undefined;
  }
}

function generateDbName(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

async function computeKeyHash(keyBytes: Uint8Array): Promise<string> {
  const buf = new Uint8Array(keyBytes).buffer;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

interface CredentialResult {
  credentialId: Uint8Array;
  prfOutput: ArrayBuffer;
}

async function createWebAuthnCredential(userDetails: MXDBUserDetails, appName: string | undefined): Promise<CredentialResult> {
  if (typeof navigator === 'undefined' || navigator.credentials == null) throw new Error('WebAuthn not supported.');
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

async function initialRegistration(
  name: string,
  requestId: string,
): Promise<MXDBInitialRegistrationResponse> {
  const response = await fetch(`/${name}/register?requestId=${requestId}`, { method: 'GET' });
  const result = await response.json();
  if (!is.plainObject(result)) throw new Error('Invalid response from server.');
  if (!is.string(result.registrationToken)) throw new Error('Missing registration token.');
  if (!is.plainObject(result.userDetails)) throw new Error('Missing user details.');
  return result;
}

async function completeRegistration(name: string, registrationToken: string, keyHash: string, deviceDetails: unknown): Promise<string> {
  const response = await fetch(`/${name}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ registrationToken, keyHash, deviceDetails }),
  });
  const result = await response.json();
  if (!is.plainObject(result)) throw new Error('Invalid response from server.');
  if (!is.string(result.token)) throw new Error('Missing token.');
  return result.token;
}

export function useMXDBInvite() {
  const { name, saveEntry } = useContext(AuthTokenContext);

  const handleInviteUrl = useBound(async (
    url: string,
    options?: UseMXDBInviteOptions,
  ): Promise<{ userDetails: MXDBUserDetails; } | undefined> => {
    const requestId = extractRequestId(url);
    if (requestId == null) throw new Error('Invalid invite URL: missing requestId parameter.');
    const { userDetails, registrationToken } = await initialRegistration(name, requestId);
    const dbName = generateDbName();
    const { credentialId, prfOutput } = await createWebAuthnCredential(userDetails, options?.appName);
    const encryptionKey = await deriveKeyFromPrfOutput(prfOutput);
    const keyHash = await computeKeyHash(encryptionKey);
    const deviceDetails = collectDeviceDetails();
    const token = await completeRegistration(name, registrationToken, keyHash, deviceDetails);

    const entry: MXDBAuthEntry = {
      id: ulid(),
      credentialId,
      dbName,
      token,
      keyHash,
      isDefault: true,
    };
    await saveEntry(entry, encryptionKey);

    return { userDetails };
  });

  return handleInviteUrl;
}
