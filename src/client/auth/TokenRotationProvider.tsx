/**
 * §4.4 — Token rotation listener (client side).
 *
 * The server generates a new `pendingToken` on each connection and emits
 * `mxdbTokenRotated`. The client stores this token in IDB + SQLite (via
 * `setToken`) ready for the next connection. The current session continues
 * using the connection token — no socket reconnect is triggered.
 */

import { createComponent } from '@anupheaus/react-ui';
import { useContext } from 'react';
import { useEvent } from '@anupheaus/socket-api/client';
import { mxdbTokenRotated } from '../../common';
import { AuthTokenContext } from './AuthTokenContext';

export const TokenRotationProvider = createComponent('TokenRotationProvider', () => {
  const { setToken } = useContext(AuthTokenContext);
  const onTokenRotated = useEvent(mxdbTokenRotated);

  onTokenRotated(async ({ newToken }) => {
    // Store the pending token for the next connection — do not reconnect now.
    await setToken(newToken);
  });

  return null;
});
