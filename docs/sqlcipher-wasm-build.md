# SQLCipher WASM Build for mxdb-sync

This document describes how to build **SQLCipher Community Edition** as WebAssembly for use in the browser with OPFS storage. SQLCipher provides file-level encryption; indexes and queries work normally since decryption is transparent to the engine.

## Prerequisites

- **Linux** (Debian/Ubuntu recommended; WSL2 works)
- **Emscripten SDK** 3.1.61+
- **WABT** 1.36+ (for `wasm-strip`)
- **GNU Make**, **curl**, **sed**, **tclsh**, **unzip**, **openssl**

## SQLCipher vs. Official SQLite WASM

- **SQLCipher** is a fork of SQLite with encryption built in. It uses `sqlite3_key()` / `PRAGMA key` to set the encryption key.
- **License:** SQLCipher Community Edition is BSD-licensed and free for commercial use. Include the required copyright notice: "Copyright (c) 2008-2024, ZETETIC, LLC".
- **No pre-built WASM:** You must compile SQLCipher to WASM yourself. No npm package provides a ready-made SQLCipher+OPFS build for browsers.

## Build Approaches

### Option A: Adapt SQLite’s Official WASM Build

The official [SQLite WASM build](https://sqlite.org/wasm/doc/trunk/building.md) uses `ext/wasm` and expects `sqlite3.c` from the same source tree. To use SQLCipher:

1. **Clone SQLCipher** (not SQLite):
   ```bash
   git clone https://github.com/sqlcipher/sqlcipher
   cd sqlcipher
   ```

2. **Obtain SQLite’s `ext/wasm` directory** from a matching SQLite version. SQLCipher is based on SQLite; check SQLCipher’s base version and fetch the corresponding `ext/wasm` from [SQLite’s source](https://sqlite.org/src).

3. **Copy `ext/wasm`** into the SQLCipher tree (or build from a combined tree).

4. **Substitute the amalgamation:** SQLCipher’s build produces `sqlite3.c` and `sqlite3.h`. Use those instead of SQLite’s when building WASM:
   ```bash
   ./configure --enable-tempstore=yes CFLAGS="-DSQLITE_HAS_CODEC" LDFLAGS="-lcrypto"
   make sqlite3.c
   # Copy ext/wasm from SQLite, then:
   cd ext/wasm
   make  # or make TARGET (e.g. release, o2)
   ```

5. **Caveat:** `sqlite3-wasm.c` in `ext/wasm` relies on SQLite internals. SQLCipher’s amalgamation may differ. If the build fails or behaves incorrectly, you may need to patch `sqlite3-wasm.c` or the Makefile to align with SQLCipher’s structure.

### Option B: wa-sqlite + SQLCipher Amalgamation

[wa-sqlite](https://github.com/rhashimoto/wa-sqlite) supports custom C code and amalgamation overrides via [sqwab](https://github.com/rhashimoto/sqwab):

1. Use **sqwab** to configure a custom build.
2. Point the build at SQLCipher’s `sqlite3.c` and `sqlite3.h` instead of vanilla SQLite.
3. Ensure OpenSSL/libtomcrypt (or SQLCipher’s crypto backend) is linked. SQLCipher typically uses OpenSSL; Emscripten can compile OpenSSL to WASM.

This requires familiarity with wa-sqlite’s build and may need Makefile changes for the crypto dependency.

### Option C: Custom Emscripten Build

1. Clone SQLCipher and build its amalgamation.
2. Create a minimal Emscripten build that:
   - Compiles `sqlite3.c` (SQLCipher) + a small C shim for WASM exports.
   - Links with a WASM build of OpenSSL (or uses SQLCipher’s bundled crypto).
3. Implement or port a JavaScript VFS for OPFS (e.g. based on [sqlite3-vfs-opfs](https://sqlite.org/wasm/doc/trunk/persistence.md)).
4. Expose `sqlite3_key` and other SQLCipher APIs to JavaScript.

This is the most work but gives full control.

## Encryption Key Handling

- The encryption key must be provided when opening the database (`sqlite3_key` or `PRAGMA key`).
- **Derivation:** Prefer deriving the key from a user secret (e.g. password) via PBKDF2 using the Web Crypto API, then passing the raw key to SQLCipher.
- **Storage:** Never store the key in plaintext. Keep it in memory only for the duration of the session.
- **Browser limitation:** Keys in JS can be inspected; encryption protects data at rest (e.g. on disk, in backups), not against a fully compromised client.

## OPFS and Workers

- OPFS `createSyncAccessHandle()` is available only in **Web Workers** (not the main thread).
- All SQLite/OPFS access (reads and writes) must run in a worker.
- Requires response headers: `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`.

## Recommended First Step

Start with **Option A** using a SQLite version close to SQLCipher’s base. If `ext/wasm` fails to build or run correctly with SQLCipher’s amalgamation, move to **Option B** (wa-sqlite + sqwab) or **Option C** (fully custom build).

## Output Artifacts

A successful build should produce:

- `sqlite3.wasm` – the SQLCipher WASM binary
- `sqlite3.js` (and/or `sqlite3.mjs`) – JS glue for loading WASM and exposing the API
- OPFS VFS enabled (if using the official build’s OPFS support)

These are then integrated into the mxdb-sync client’s Db layer, replacing IndexedDB with SQLite+OPFS+SQLCipher as described in §4.3 of the design document.
