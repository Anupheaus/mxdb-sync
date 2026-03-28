import { defineEvent } from '@anupheaus/socket-api/common';
import type { MXDBTokenRotatedPayload } from './models';

// ─── §4.4 Token rotation event (server → specific client) ────────────────────
/** Emitted by the server after rotating this client's auth token. */
export const mxdbTokenRotated = defineEvent<MXDBTokenRotatedPayload>('mxdbTokenRotated');
