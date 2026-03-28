# Unified `{name}_sync` companion: `AuditOf` everywhere

> **Archive:** Target data model notes; may not match every current code path. For integration, see [docs/README.md](../README.md).

This document captures the target model (agreed direction). Implementation is not necessarily complete in code yet.

## Goals

- **One companion store per logical collection:** `{collectionName}_sync` only — no `{name}_audit` (or legacy dirty-only tables).
- **One logical record type in that store:** `AuditOf<RecordType>` keyed by live record `id`, linking to the live row when it exists.
- **Two behaviours**, selected by `disableAudit` (or a renamed `syncStrategy`):
  - **Full audit** — rich history on the client; server keeps full history with attribution.
  - **Sync-only (LWW)** — minimal `AuditOf` on the client; server keeps a **compressed** history with attribution and delete snapshots.

---

## Client — sync-only (`disableAudit === true`)

| State | `AuditOf` shape |
| ----- | ---------------- |
| Clean / server-aligned | `entries` **empty** (see note below on naming). No pending change. |
| Locally modified | Exactly **one** `Updated` entry: `ops: []`, entry `id` = new **ULID** (timestamp + ordering). Materialised payload is **not** in the audit; the **live row** is authoritative. |
| Locally deleted (server not yet informed) | At most **one** non-branch entry: replace/add a **`Deleted`** entry (same “single pending entry” rule). Live row absent; sync uses **`removedIds`**. |

**Sync upload:** For dirty upserts, send the **full live record** plus the `AuditOf` carrying that single `Updated` entry; the entry ULID is the client’s version / timestamp for LWW. For deletes, include record id in **`removedIds`** (and the `AuditOf` reflects deleted state locally).

**Replay note:** `replayHistory` with only `[Updated, ops: []]` does not reconstruct the record without a **base record** from the live table. Sync-only mode must always treat **live + audit** together: materialise using live row as `baseRecord` when replaying thin audits.

**Validation:** `isAudit(value, fullAudit)` is mode-aware (see `src/common/auditor/api.ts`).

**Entry metadata:** Entry **timestamps** are derived from each entry’s ULID (`decodeTime(id)`). The **record id** for every entry is `AuditOf.id` — entries do not repeat `recordId`. There is no `AuditOf.version` or client materialisation **hash** on the audit document; sync divergence uses structural replay + deep equality (see server `syncAction`).

---

## Client — full audit (`disableAudit !== true`)

- Unchanged from current behaviour: branching, merges, op-based `Updated` entries, etc.

---

## Server — `_sync` collection contents

All documents are **`AuditOf`-shaped** (same record `id` as live document). Entries are **server-side enriched**:

- **`userId`** on **every** stored entry (who performed the change on the server).
- **`Deleted` entries (server-only shape):** extend the normal deleted entry with a **`record` snapshot** — full copy of the live record at delete time (for recovery and audit).

### Server entry types (conceptual)

- **Common:** `ServerAuditEntry = ClientAuditEntry & { userId: string }` (for types that exist on both sides).
- **Deleted (server):** `ServerAuditDeletedEntry extends AuditDeletedEntry & { userId: string; record: RecordType }` — **only** in server `_sync` / persistence; **strip `record` (and optionally `userId`)** if ever serialising to the client, depending on product rules.

### Server — sync-only collection (`disableAudit === true`)

Compressed history per record id:

- A **`Created`** entry (initial server materialisation).
- At most **one** active **`Updated`** entry representing current server-known state (replace/upsert semantics on each sync, not an append-only log).
- If deleted: a **`Deleted`** entry **with full `record` snapshot**, with `userId`.

### Server — full audit (`disableAudit !== true`)

- Append / merge semantics as today, but every persisted entry includes **`userId`**.
- **`Deleted`** entries include the **full deleted record** snapshot as above.

---

## Invariants

1. **One companion collection:** `{name}_sync` only; live data stays in `{name}` / `{name}_live` on the client.
2. **Sync-only client:** at most **one** “pending” non-`Branched` entry (`Updated` with empty `ops` or `Deleted`) before sync ack; ULID on that entry is the LWW clock.
3. **Server sync-only:** bounded small number of entries per id (`Created` + current `Updated` + optional `Deleted` with snapshot).
4. **Full audit server:** unbounded entry list (subject to future pruning policy).

---

## Open design choices (when implementing)

- **After successful sync (sync-only client):** collapse to empty `entries` again vs keep a `Branched` anchor ULID — must match push / subscription `auditEntryId` contract.
- **Whether `userId` is ever sent to the client** on full-audit pulls (privacy vs debugging).
- **Mongo `_id`** for `AuditOf` documents: continue using record id as `_id` (current server pattern).

---

## Does this make sense?

**Yes.** It gives a single wire/storage envelope (`AuditOf`), uses ULID entry ids you already rely on for ordering, and uses `removedIds` for delete sync without forcing the server to parse every tombstone from the batch body. Server-only extensions (`userId`, snapshot on delete) keep client models small while meeting server audit needs.

The main implementation work is: **`AuditOf.entries` everywhere, relax or split validation for empty sync-only audits, ensure replay always pairs thin audits with live rows, replace `_audit` + dirty `_sync` SQLite DDL with one `_sync` schema, and branch server persist layer for compressed vs full audit trails.**
