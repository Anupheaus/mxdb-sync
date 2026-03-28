/**
 * §4.3 — Derive a 256-bit AES-GCM encryption key from a WebAuthn credential
 * via the PRF extension.
 *
 * Returns `undefined` in environments where the Web Authentication API is
 * unavailable (Node.js, test runners, browsers without WebAuthn/PRF support),
 * so callers can gracefully fall back to an unencrypted SQLite store.
 *
 * The returned raw bytes are passed to the SQLite worker (via postMessage),
 * which imports them as a non-extractable CryptoKey internally. Keeping the
 * bytes rather than a CryptoKey object makes them serialisable for transfer.
 */

export const PRF_SALT = new TextEncoder().encode('mxdb-sqlite-encryption-key-v1');

/**
 * HKDF-derives 32 raw key bytes from a WebAuthn PRF output buffer.
 * Exported so the registration path (`credentials.create`) can use the same
 * derivation as the login path (`credentials.get`) without a second tap.
 */
export async function deriveKeyFromPrfOutput(prfOutput: ArrayBuffer): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveBits']);
  const keyBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: PRF_SALT, info: new Uint8Array(0) },
    baseKey,
    256,
  );
  return new Uint8Array(keyBits);
}

/**
 * Derive a 256-bit key from an existing WebAuthn credential using the PRF
 * extension.
 *
 * @param credentialId - Raw credential ID bytes as returned by `navigator.credentials.create()`.
 * @returns 32 raw key bytes, or `undefined` if PRF is unavailable.
 */
export async function deriveEncryptionKey(credentialId: Uint8Array): Promise<Uint8Array | undefined> {
  if (typeof navigator === 'undefined' || typeof navigator.credentials === 'undefined') {
    return undefined;
  }

  try {
    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id: credentialId }],
        extensions: {
          prf: { eval: { first: PRF_SALT } },
        } as any,
      },
    } as CredentialRequestOptions) as PublicKeyCredential | null;

    if (assertion == null) return undefined;

    const ext = (assertion.getClientExtensionResults() as any)?.prf;
    const prfOutput: ArrayBuffer | undefined = ext?.results?.first;
    if (prfOutput == null) return undefined;

    return deriveKeyFromPrfOutput(prfOutput);
  } catch {
    // WebAuthn not supported, user cancelled, or PRF extension unavailable
    return undefined;
  }
}
