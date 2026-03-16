// Preload for sync integration tests.
// socket-api client hardcodes wss://, and we use a self-signed cert in tests.
// Patch tls.connect before ws/socket.io-client are loaded so they inherit rejectUnauthorized=false.
const tls = require('tls');
const originalConnect = tls.connect;

tls.connect = function patchedConnect(...args) {
  const last = args[args.length - 1];
  if (last && typeof last === 'object' && !Array.isArray(last)) {
    if (last.rejectUnauthorized === undefined) last.rejectUnauthorized = false;
  }
  return originalConnect.apply(this, args);
};

// Prevent unhandled rejections from socket.io-client when the server intentionally restarts.
// socket.io-client rejects outstanding acks with "socket has been disconnected" during disconnect;
// for this test we treat it as expected noise and rely on our run logs + integrity assertions.
try {
  const path = require('path');
  const clientMain = require.resolve('socket.io-client');
  const socketPath = path.join(path.dirname(clientMain), 'socket.js');
  // Require by absolute path to bypass package "exports" restrictions.
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const socketModule = require(socketPath);
  const Socket = socketModule && (socketModule.Socket || socketModule.default || socketModule);
  if (Socket && Socket.prototype && typeof Socket.prototype._clearAcks === 'function') {
    // Replace with a safe version that clears without rejecting outstanding ack promises.
    Socket.prototype._clearAcks = function patchedClearAcks() {
      if (this && typeof this === 'object') {
        // socket.io-client uses both `acks` and `_acks` across versions.
        if (this.acks && typeof this.acks === 'object') this.acks = {};
        if (this._acks && typeof this._acks === 'object') this._acks = {};
      }
    };
  }
} catch (_) {
  // ignore if module path changes
}

