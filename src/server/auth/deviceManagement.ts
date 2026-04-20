/**
 * Device management public server APIs.
 *
 * These are plain async functions (not socket actions). The app server calls
 * them e.g. from admin routes. They require a raw MongoDB `Db` instance
 * passed from `startServer()`.
 */

import type { WebAuthnAuthRecord } from '@anupheaus/socket-api/common/auth';
import { AuthCollection } from './AuthCollection';
import type { MXDBDeviceInfo } from '../../common/models';
import type { ServerDb } from '../providers';

/**
 * Returns all device records (authenticated or pending) for a user.
 */
export async function getDevices(db: ServerDb, userId: string): Promise<MXDBDeviceInfo[]> {
  const authColl = new AuthCollection(db);
  const records = await authColl.findByUserId(userId);
  return records.map((r: WebAuthnAuthRecord) => ({
    requestId: r.requestId,
    userId: r.userId,
    deviceDetails: r.deviceDetails,
    isEnabled: r.isEnabled,
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
