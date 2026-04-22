# Manual test app (`test/`)

A manually-run browser + server app for exploratory development and WebAuthn auth testing. Not part of the automated test suite and not run by `pnpm test:all`.

## Overview

`test/server/start.ts` starts a local MXDB-sync server. `test/client/` is a Vite-bundled React app that mounts `<MXDBSync>`, provides a basic CRUD UI for the `addresses` and `products` test collections, and exposes connection/sync status components. Used to test WebAuthn invite-link flows and UI integration against a real local server.

## Contents

### Server (`test/server/`)
- `start.ts` — entry point; calls `startServer` with test collections and extensions
- `configureAuth.ts` — sets up the invite-link route and dev auth bypass
- `configureActions.ts` — registers test-specific socket actions
- `configureExtensions.ts` — `extendCollection` calls for test collections
- `configureStaticFiles.ts` / `configureViews.ts` — Koa middleware for static assets and Pug views

### Client (`test/client/`)
- `App.tsx` / `index.tsx` — root React app wrapped in `<MXDBSync>`
- `Addresses.tsx` / `Address.tsx` / `AddressDialog.tsx` — CRUD UI for the addresses collection
- `Registration.tsx` — WebAuthn device registration flow
- `ConnectionTest.tsx` / `SyncStatus.tsx` / `ClientId.tsx` — connection and sync status indicators

### Shared (`test/common/`)
- `collections/addresses.ts`, `collections/products.ts` — collection definitions shared between test client and server
- `actions.ts` — test-only socket action descriptors

## Ambiguities and gotchas

- **Not automated** — requires a human to start it and click through flows.
- **TLS** — uses the self-signed cert from `tests/e2e/setup/certs/`. Browsers show a security warning on first use.

## Related

- [../tests/AGENTS.md](../tests/AGENTS.md) — automated e2e tests
