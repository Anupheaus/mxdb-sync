/**
 * §4.4 / §7.4 — Device management public server APIs.
 *
 * These are plain async functions (not socket actions). The app server calls
 * them e.g. from admin routes. They require a raw MongoDB `Db` instance
 * passed from `startServer()`.
 */

import { ulid } from 'ulidx';
import { AuthCollection } from './AuthCollection';
import type { MXDBDeviceInfo } from '../../common/models';
import type { ServerDb } from '../providers';

/**
 * Creates an invitation link for the given userId.
 * Stores a new `mxdb_authentication` record with `requestId` (ULID) and `userId`.
 * The returned URL is for the app to distribute (email, WhatsApp, etc.).
 */
export async function createInviteLink(db: ServerDb, userId: string, domain: string, socketName: string): Promise<string> {
  const requestId = ulid();
  const authColl = new AuthCollection(db);
  await authColl.create({
    requestId,
    userId,
    isEnabled: true,
    // createdAt: Date.now(),
  });
  // Point at the REST invite endpoint (registerAuthInviteRoute). A bare `/?requestId=` would hit
  // the host app’s SPA / catch-all (e.g. koa-pug index) and return HTML instead of JSON.
  const path = `/${encodeURIComponent(socketName)}/register?requestId=${requestId}`;
  return `https://${domain}${path}`;
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
