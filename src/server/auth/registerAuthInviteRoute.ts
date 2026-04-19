import type Router from 'koa-router';
import type { ParameterizedContext } from 'koa';
import type { MXDBInitialRegistrationResponse, MXDBRegistrationPayload, MXDBUserDetails } from '../../common/models';
import { ApiError, is } from '@anupheaus/common';
import type { ServerDb } from '../providers/db/ServerDb';
import { AuthCollection } from './AuthCollection';
import type { ULID } from 'ulidx';
import { decodeTime, ulid } from 'ulidx';
import { withSecurity } from '@anupheaus/socket-api/server';

const INVITE_RATE_LIMIT = { maxRequests: 5, windowMs: 15 * 60 * 1000, message: 'Too many invite redemption attempts. Please wait before trying again.' };

function getRequestId(ctx: ParameterizedContext) {
  const requestId = ctx.query.requestId as string;
  if (!requestId) throw new ApiError({ message: 'Missing requestId' });
  return requestId;
}

async function findInviteByRequestId(authColl: AuthCollection, requestId: string) {
  const record = await authColl.findByRequestId(requestId);
  if (record == null) throw new ApiError({ message: 'Invite link not found.' });
  if (!record.isEnabled) throw new ApiError({ message: 'Invite link has already been used or disabled.' });
  return record;
}

function validateTTL(timestamp: ULID, inviteLinkTTLMs: number) {
  const createdAt = decodeTime(timestamp);
  if (Date.now() - createdAt > inviteLinkTTLMs) throw new ApiError({ message: 'Invite link has expired.' });
}

async function findInviteByRegistrationToken(authColl: AuthCollection, registrationToken: string) {
  const record = await authColl.findByRegistrationToken(registrationToken);
  if (record == null) throw new ApiError({ message: 'Invite link not found.' });
  if (!record.isEnabled) throw new ApiError({ message: 'Invite link has already been used or disabled.' });
  return record;
}

export function registerAuthInviteRoute(router: Router, name: string, db: ServerDb, inviteLinkTTLMs: number, onGetUserDetails: (userId: string) => Promise<MXDBUserDetails>) {
  const inviteSecurity = withSecurity({ rateLimit: INVITE_RATE_LIMIT });

  router.get(`/${name}/register`, inviteSecurity, async ctx => {
    const requestId = getRequestId(ctx);
    validateTTL(requestId, inviteLinkTTLMs);
    const authColl = new AuthCollection(db);
    const record = await findInviteByRequestId(authColl, requestId);
    await authColl.update(requestId, { isEnabled: false });
    const userDetails = await onGetUserDetails(record.userId);
    if (!userDetails) throw new ApiError({ message: 'User not found or not authorized to access this resource.' });
    const registrationToken = ulid();
    await authColl.update(requestId, { registrationToken, isEnabled: true });
    const response: MXDBInitialRegistrationResponse = { registrationToken, userDetails };
    ctx.body = response;
    ctx.status = 200;
  });

  router.post(`/${name}/register`, inviteSecurity, async ctx => {
    const payload = ctx.request.body as MXDBRegistrationPayload;
    if (!is.plainObject(payload)) throw new ApiError({ message: 'Invalid registration payload.' });
    const { registrationToken, deviceDetails, keyHash } = payload;
    if (is.empty(registrationToken)) throw new ApiError({ message: 'Missing registration token.' });
    if (is.empty(keyHash)) throw new ApiError({ message: 'Missing key hash.' });
    if (!is.plainObject(deviceDetails)) throw new ApiError({ message: 'Invalid device details.' });
    validateTTL(registrationToken, inviteLinkTTLMs);
    const authColl = new AuthCollection(db);
    const record = await findInviteByRegistrationToken(authColl, registrationToken);
    if (!record.isEnabled) throw new ApiError({ message: 'Invite link has already been used or disabled.' });
    const authenticationToken = ulid();
    await authColl.update(record.requestId, { keyHash, deviceDetails, pendingToken: authenticationToken });
    ctx.body = { token: authenticationToken };
    ctx.status = 200;
  });
}
