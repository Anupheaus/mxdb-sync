// src/client/auth/deriveKey.ts
const PRF_SALT = new TextEncoder().encode('mxdb-sqlite-encryption-key-v1');

/**
 * Derives a 32-byte AES-GCM key from a WebAuthn PRF output via HKDF-SHA-256.
 * The salt matches the original deriveEncryptionKey.ts so existing databases remain readable.
 */
export async function deriveKey(prfOutput: ArrayBuffer): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey('raw', prfOutput, 'HKDF', false, ['deriveBits']);
  const keyBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: PRF_SALT, info: new Uint8Array(0) },
    baseKey,
    256,
  );
  return new Uint8Array(keyBits);
}
