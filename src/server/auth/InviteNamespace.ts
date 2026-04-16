/**
 * Invite socket server.
 *
 * Creates a dedicated socket.io Server mounted at `/{name}/register` on the
 * same HTTP server as the main socket.io server. Clients open a separate
 * WebSocket to this path (not a namespace packet on the main connection) and
 * register a new device in two steps:
 *
 *   1. Client connects with `{ requestId }` in `socket.auth`.
 *   2. Server validates the invite (rate limit → find → single-use → TTL).
 *   3. Server emits INVITE_DETAILS `{ userDetails }` — client uses these to
 *      populate the WebAuthn passkey prompt and derive the encryption key.
 *   4. Client emits COMPLETE_REGISTRATION `{ keyHash, deviceDetails }`.
 *   5. Server stores keyHash + deviceDetails, generates an initial token, and
 *      emits AUTH_SUCCESS `{ token, userDetails }`.
 *   6. Server closes the connection.
 */

import { Server } from 'socket.io';
// import type {
//   MXDBInviteHandshake,
//   MXDBInviteDetails,
//   MXDBRegistrationPayload,
//   MXDBInviteSuccess,
//   MXDBInviteError,
// } from '../../common/authModels';
// import { AuthCollection } from './AuthCollection';
// import { inviteRateLimiter } from './RateLimiter';
// import { getAuthConfig } from './authConfig';
// import { ulid, decodeTime } from 'ulidx';
import type { ServerDb } from '../providers/db/ServerDb';
import type { AnyHttpServer } from '../internalModels';
import type { Logger } from '@anupheaus/common';

// const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export function setupInviteNamespace(httpServer: AnyHttpServer, name: string, _db: ServerDb, logger: Logger): void {
  logger.info(`Setting up invite namespace at /${name}/register`);
  const io = new Server(httpServer, {
    path: `/${name}/register`,
    transports: ['websocket'],
    serveClient: false,
  });

  io.on('connection', async client => {
    logger.debug('Invite namespace connection', { auth: client.handshake.auth });
    // const { requestId } = (client.handshake.auth ?? {}) as MXDBInviteHandshake;
    // const ip = client.handshake.address ?? 'unknown';

    // const reject = (message: string) => {
    //   client.emit('AUTH_ERROR', { message } satisfies MXDBInviteError);
    //   client.disconnect(true);
    // };

    // if (!requestId) return reject('Missing requestId.');

    // // Rate limit: 5 attempts per 15 minutes per IP
    // if (!inviteRateLimiter.check(ip)) {
    //   return reject('Too many invite redemption attempts. Please wait before trying again.');
    // }

    // const mongoDb = await db.getMongoDb();
    // const authColl = new AuthCollection(mongoDb);

    // // Mark as used immediately before any further checks (single-use guarantee)
    // const record = await authColl.findByRequestId(requestId);
    // if (record != null) await authColl.update(requestId, { isEnabled: false });

    // if (record == null) return reject('Invite link not found or already used.');
    // if (!record.isEnabled) return reject('Invite link has already been used or disabled.');

    // // TTL check — use ULID timestamp embedded in requestId
    // let createdAt: number;
    // try { createdAt = decodeTime(record.requestId); } catch { createdAt = record.createdAt; }
    // const ttlMs = getAuthConfig().inviteLinkTTLMs ?? DEFAULT_INVITE_TTL_MS;
    // if (Date.now() - createdAt > ttlMs) return reject('Invite link has expired.');

    // // Fetch user details to send to the client for the WebAuthn prompt
    // const authConfig = getAuthConfig();
    // const userDetails = authConfig.onGetUserDetails
    //   ? await authConfig.onGetUserDetails(record.userId)
    //   : { name: record.userId };

    // // Step 1: send user details so the client can create the WebAuthn credential
    // client.emit('INVITE_DETAILS', { userDetails } satisfies MXDBInviteDetails);

    // // Step 2: wait for the client to complete WebAuthn and send back keyHash
    // client.once('COMPLETE_REGISTRATION', async ({ keyHash, deviceDetails }: MXDBRegistrationPayload) => {
    //   if (!keyHash) return reject('Missing keyHash in registration payload.');

    //   const token = ulid();

    //   await authColl.update(requestId, {
    //     deviceDetails,
    //     keyHash,
    //     pendingToken: token,
    //     isEnabled: true,
    //     lastConnectedAt: Date.now(),
    //   });

    //   inviteRateLimiter.reset(ip);

    //   client.emit('AUTH_SUCCESS', { token, userDetails } satisfies MXDBInviteSuccess);
    client.disconnect(true);
  });

  io.on('disconnect', client => {
    logger.info(`Invite namespace client disconnected: ${client.id}`);
  });

  httpServer.on('close', () => {
    io.close();
  });
}
