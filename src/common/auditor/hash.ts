import type { Record as MXDBRecord } from '@anupheaus/common';

// ─── Deterministic JSON + hashing helpers ─────────────────────────────────────

function fnv64Hex(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xc4ccd795;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c; h1 = (Math.imul(h1, 0x01000193) >>> 0);
    h2 ^= c; h2 = (Math.imul(h2, 0x01000193) >>> 0);
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/** §2.3 Deterministic JSON: keys sorted, no whitespace, undefined omitted. */
export function deterministicJson(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(v => v === undefined ? 'null' : deterministicJson(v)).join(',') + ']';
  }
  const keys = Object.keys(value as object).sort();
  const pairs = keys
    .map(k => {
      const v = (value as Record<string, unknown>)[k];
      if (v === undefined) return null;
      return JSON.stringify(k) + ':' + deterministicJson(v);
    })
    .filter((p): p is string => p !== null);
  return '{' + pairs.join(',') + '}';
}

export function contentHash(obj: unknown): string {
  return fnv64Hex(deterministicJson(obj));
}

/** §2.3 Record hash: SHA-256 of deterministic JSON, truncated to 16 hex chars. */
export async function hashRecord(record: MXDBRecord): Promise<string> {
  const json = deterministicJson(record);

  // Browser / WebCrypto path
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const encoded = new TextEncoder().encode(json);
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
    const hex = Array.from(new Uint8Array(hashBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    return hex.slice(0, 16);
  }

  // Node.js path
  // Prevent webpack from trying to bundle Node's 'crypto' into the browser build.
  const { createHash } = await import(/* webpackIgnore: true */ 'crypto');
  return createHash('sha256').update(json).digest('hex').slice(0, 16);
}

