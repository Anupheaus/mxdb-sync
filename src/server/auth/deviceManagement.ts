/**
 * Device management public server APIs.
 *
 * These are plain async functions (not socket actions). The app server calls
 * them e.g. from admin routes. They require a raw MongoDB `Db` instance
 * passed from `startServer()`.
 */

import { ulid } from 'ulidx';
import { AuthCollection } from './AuthCollection';
import type { MXDBDeviceInfo } from '../../common/models';
import type { ServerDb } from '../providers';

/** Dev-only fixed keyHash used for bypass auth records. */
export const DEV_BYPASS_KEY_HASH = 'dev-bypass';

/**
 * Creates an invitation link for the given userId.
 * Stores a new `mxdb_authentication` record with `requestId` (ULID) and `userId`.
 * The returned URL is for the app to distribute (email, WhatsApp, etc.).
 */
export async function createInviteLink(db: ServerDb, userId: string, domain: string, _socketName: string): Promise<string> {
  const requestId = ulid();
  const authColl = new AuthCollection(db);
  await authColl.create({
    requestId,
    userId,
    isEnabled: true,
    // createdAt: Date.now(),
  });
  // Point at the SPA root with requestId as a query param. The client-side invite hook
  // (useMXDBInvite) will detect the param and make the fetch to /{socketName}/register internally.
  return `https://${domain}/?requestId=${requestId}`;
}

/**
 * Returns all device records (authenticated or pending) for a user.
 */
export async function getDevices(db: ServerDb, userId: string): Promise<MXDBDeviceInfo[]> {
  const authColl = new AuthCollection(db);
  const records = await authColl.findByUserId(userId);
  return records.map(r => ({
    requestId: r.requestId,
    userId: r.userId,
    deviceDetails: r.deviceDetails,
    isEnabled: r.isEnabled,
    // createdAt: r.createdAt,
    lastConnectedAt: r.lastConnectedAt,
  }));
}

/**
 * Enable a previously disabled device so its token is accepted on the next connection.
 */
export async function enableDevice(db: ServerDb, requestId: string): Promise<void> {
  const authColl = new AuthCollection(db);
  await authColl.update(requestId, { isEnabled: true });
}

/**
 * Disable a device so its token is rejected on the next connection attempt.
 * The user must re-authenticate via a new invite link or admin re-enable.
 */
export async function disableDevice(db: ServerDb, requestId: string): Promise<void> {
  const authColl = new AuthCollection(db);
  await authColl.update(requestId, { isEnabled: false });
}

/**
 * Dev-only: creates (or replaces) a bypass auth record for the given userId with a
 * fresh token. Uses a deterministic requestId so repeated calls replace the same record.
 * The keyHash is a fixed sentinel value — not derived from WebAuthn.
 *
 * NOT for use in production. Guard all call sites with `process.env.NODE_ENV !== 'production'`.
 */
export async function createDevToken(db: ServerDb, userId: string): Promise<{ token: string; keyHash: string }> {
  const token = ulid();
  const authColl = new AuthCollection(db);
  await authColl.upsert({
    requestId: `dev-bypass-${userId}`,
    userId,
    keyHash: DEV_BYPASS_KEY_HASH,
    currentToken: token,
    isEnabled: true,
    deviceDetails: { type: 'dev-bypass', createdAt: Date.now() },
  });
  return { token, keyHash: DEV_BYPASS_KEY_HASH };
}
