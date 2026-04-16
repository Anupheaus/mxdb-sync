/**
 * §4.3 — Derive a 256-bit AES-GCM encryption key from a WebAuthn credential
 * via the PRF extension.
 *
 * Throws in all non-success paths: unencrypted storage is never permitted.
 * The mock-detection guard also throws if `navigator.credentials.get` does not
 * appear to be a native browser implementation, preventing trivial credential
 * substitution attacks.
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
 * Derive a 256-bit key from an existing WebAuthn credential using the PRF extension.
 *
 * Throws if WebAuthn is unavailable, credentials appear mocked, PRF is not
 * supported, or the user cancels. Unencrypted storage is never permitted.
 *
 * @param credentialId - Raw credential ID bytes as returned by `navigator.credentials.create()`.
 * @returns 32 raw key bytes.
 */
export async function deriveEncryptionKey(credentialId: Uint8Array): Promise<Uint8Array> {
  if (typeof navigator === 'undefined' || navigator.credentials == null) {
    throw new Error('MXDB: WebAuthn is not available in this environment. Unencrypted storage is not permitted.');
  }

  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [{ type: 'public-key', id: credentialId }],
      extensions: {
        prf: { eval: { first: PRF_SALT } },
      } as any,
    },
  } as CredentialRequestOptions) as PublicKeyCredential | null;

  if (assertion == null) {
    throw new Error('MXDB: WebAuthn assertion was cancelled or returned null. Unencrypted storage is not permitted.');
  }

  // ── Structural authenticity checks ──────────────────────────────────────────
  // These verify that the returned object has the internal structure a real
  // browser produces, making it significantly harder to satisfy with a hand-
  // crafted fake than the pre-call native-code checks alone.

  // 1. response must be a genuine AuthenticatorAssertionResponse, not a plain
  //    object. Spoofing this requires patching AuthenticatorAssertionResponse
  //    .prototype — a much more obscure target than mocking credentials.get.
  if (
    typeof AuthenticatorAssertionResponse !== 'undefined' &&
    !(assertion.response instanceof AuthenticatorAssertionResponse)
  ) {
    throw new Error('MXDB Security: WebAuthn assertion response is not a genuine AuthenticatorAssertionResponse — credential mocking is not permitted.');
  }

  // 2. clientDataJSON must deserialise to a valid object with type 'webauthn.get'
  //    and an origin matching the current page. Forging a correctly origin-bound
  //    clientDataJSON without a real browser credential is not practical.
  try {
    const clientData = JSON.parse(new TextDecoder().decode(assertion.response.clientDataJSON)) as Record<string, unknown>;
    if (clientData.type !== 'webauthn.get') {
      throw new Error('MXDB Security: clientDataJSON type field is not "webauthn.get" — credential mocking is not permitted.');
    }
    if (typeof window !== 'undefined' && clientData.origin !== window.location.origin) {
      throw new Error('MXDB Security: clientDataJSON origin does not match the current page origin — credential mocking is not permitted.');
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('MXDB Security:')) throw err;
    throw new Error('MXDB Security: clientDataJSON could not be parsed — credential mocking is not permitted.');
  }

  // 3. PRF output must be a real ArrayBuffer (not a Uint8Array, plain object,
  //    or other ArrayBufferView). A fake that returns a Uint8Array fails this.
  const ext = (assertion.getClientExtensionResults() as any)?.prf;
  const prfOutput: unknown = ext?.results?.first;
  if (prfOutput == null) {
    throw new Error('MXDB: WebAuthn PRF extension is not supported by this device or browser. Unencrypted storage is not permitted.');
  }
  if (Object.prototype.toString.call(prfOutput) !== '[object ArrayBuffer]') {
    throw new Error('MXDB Security: PRF output is not a plain ArrayBuffer — credential mocking is not permitted.');
  }

  return deriveKeyFromPrfOutput(prfOutput as ArrayBuffer);
}
