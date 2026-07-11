# Owner-Authorized Trace Export and Selective Purge

## Delivery status

This document records Mira's first intentionally actionable greenfield capability. It is limited to the authenticated owner exporting selected causal traces or physically purging an exact selected trace scope. It is not a generic action executor and it does not enable companion memory, server-model escalation, MiniCPM5, or arbitrary tool execution.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Exact immutable operation plan | IMPLEMENTED | `trace-operation-store.ts` |
| Owner/device/session-bound approval | IMPLEMENTED | encrypted plan metadata and immutable approval table |
| One-time approval challenge | IMPLEMENTED | challenge returned once; only SHA-256 hash persisted |
| Encrypted plan scope | IMPLEMENTED | AES-256-GCM per-owner operation key |
| Exact trace export | IMPLEMENTED | `TraceOwnerOperationService.executeExport()` |
| Selective physical purge | IMPLEMENTED | `TraceOwnerOperationService.executePurge()` |
| Independent post-action verification | IMPLEMENTED | `TraceOwnerOperationVerifier` |
| Causal operation events | IMPLEMENTED | append-only plan/approval/execution/verification/receipt event chain |
| Owner-visible immutable receipt | IMPLEMENTED | `greenfield_trace_operation_receipts` |
| Crash/lost-response purge reconciliation | IMPLEMENTED | exact matching underlying purge receipt recovery |
| Migration v2 | IMPLEMENTED | `trace-operation-migrations.ts` |
| Authenticated HTTP routes | IMPLEMENTED | `api/greenfield/trace-operations.ts` |
| Server type-check and focused tests | TESTED | GitHub Actions core run `29128209463` |
| Production build and regressions | TESTED | GitHub Actions regression run `29128209457` |
| Deployment and restart acceptance | BLOCKED | no deployed environment or restart evidence observed |

## Authority boundary

Models do not approve, execute, or verify these operations. The deterministic operation service decides whether the authenticated identity may plan, approve, and execute. The execution scope is fixed before approval and cannot be expanded afterward.

A production operation requires all of the following:

1. `MIRA_GREENFIELD_ENABLED=true`.
2. `MIRA_GREENFIELD_TRACE_PERSISTENCE=true`.
3. `MIRA_GREENFIELD_TRACE_OPERATIONS=true`.
4. A valid API credential at transport and identity boundaries.
5. The configured paired device.
6. The `private` privacy zone.
7. `trace.export` or `trace.purge` permission for the requested operation.
8. A valid owner trace hash chain at plan creation.
9. An unexpired immutable plan containing the exact trace IDs and record hashes.
10. A matching one-time approval challenge and an immutable `approved` decision.
11. Successful execution followed by independent deterministic verification.
12. A persisted immutable operation receipt.

## Operation lifecycle

```text
Authenticated owner request
  -> identity and permission evaluation
  -> owner trace-chain verification
  -> exact trace and record-hash resolution
  -> encrypted immutable plan
  -> one-time approval challenge
  -> owner decision bound to owner/device/session/scope/expiry
  -> export or physical purge executor
  -> independent verifier
  -> immutable receipt
  -> owner response
```

Each stage also appends a causal operation event. Events link to their predecessor by event ID and hash and are immutable in SQLite.

## Migration v2

Migration version 2 adds:

- `greenfield_trace_operation_plans`
- `greenfield_trace_operation_approvals`
- `greenfield_trace_operation_receipts`
- `greenfield_trace_operation_events`
- owner/time and expiry indexes
- update- and delete-blocking triggers for every operation table

The migration uses the existing greenfield migration ledger and the same dedicated trace database. It does not modify Mira's existing memory schema.

## Confidentiality and integrity

Plan plaintext contains owner ID, device ID, session reference, exact trace IDs, exact record hashes, and the reason code. This payload is encrypted with AES-256-GCM using an HKDF-derived per-owner operation key.

Only keyed owner/device/session identifiers and operational security metadata remain outside ciphertext. The approval token is returned once and never persisted; only its SHA-256 hash is stored. All responses carrying an approval challenge or export bundle use `Cache-Control: no-store`.

Plan, approval, receipt, and causal event hashes are recomputed when records are read. Any mismatch fails closed.

## Export behavior

Export is classified as high risk. The executor reads only the planned owner-bound trace IDs and requires their current record hashes to match the immutable plan. The export bundle includes the persisted redacted envelopes, record hashes, retention deadlines, plan/action/trace IDs, owner ID, scope hash, export time, and a deterministic bundle hash.

The independent verifier checks:

- exact trace-ID set;
- exact record-hash set;
- current owner trace-chain validity;
- exact bundle content;
- bundle hash.

A verified export can be replayed only while the exact source records remain available and reconstruct to the original output hash.

## Purge behavior

Purge is classified as critical and is irreversible. The service verifies the owner chain immediately before execution. It then physically deletes only the planned trace IDs through the existing secure-delete purge engine. WAL truncation and vacuum remain part of the underlying purge path.

The independent verifier checks:

- the content-free purge receipt scope hash;
- exact reason code;
- exact record count;
- exact purged record hashes;
- physical absence of every selected trace;
- validity of the remaining owner hash chain.

If deletion committed but the response or operation receipt was lost, a retry searches for an exact matching underlying purge receipt and completes verification and operation receipt persistence without deleting a broader scope.

## HTTP contracts

### Plan

```http
POST /api/v1/greenfield/trace-operations/plan
X-API-Key: <configured credential>
Content-Type: application/json
```

```json
{
  "device_id": "<paired-device>",
  "operation": "export",
  "trace_ids": ["<trace-id>"],
  "reason_code": "owner_requested_export"
}
```

`operation` is `export` or `purge`. The scope is limited to 1-100 unique trace IDs. A supplied reason code must be a stable lowercase identifier matching `^[a-z0-9][a-z0-9._-]{0,127}$`.

A successful response returns the immutable public plan and a one-time `approval_token`. The token must be treated as a secret and must not be logged or persisted by clients.

### Approve or reject

```http
POST /api/v1/greenfield/trace-operations/approve
```

```json
{
  "device_id": "<paired-device>",
  "plan_id": "<plan-id>",
  "approval_token": "<one-time-token>",
  "decision": "approved"
}
```

Only one immutable approval decision may be stored for a plan.

### Execute

```http
POST /api/v1/greenfield/trace-operations/execute
```

```json
{
  "device_id": "<paired-device>",
  "plan_id": "<plan-id>"
}
```

A successful response returns a verified immutable receipt. Export also returns the verified bundle. Purge returns `export_bundle: null` and references the underlying purge receipt.

## Configuration

```dotenv
MIRA_GREENFIELD_ENABLED=true
MIRA_GREENFIELD_TRACE_PERSISTENCE=true
MIRA_GREENFIELD_TRACE_OPERATIONS=true
MIRA_GREENFIELD_PERMISSIONS=system.status.read,trace.export,trace.purge
MIRA_GREENFIELD_PRIVACY_ZONES=private
MIRA_GREENFIELD_TRACE_OPERATION_TTL_SECONDS=300
```

The TTL accepts 60-1800 seconds and defaults to 300. Operations remain disabled by default.

## Test evidence

Core validation:

```bash
npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build --workspace aurora
npx tsc --noEmit --project tsconfig.json
npm run test:greenfield
```

Observed in run `29128209463`:

- full server TypeScript type-check: TESTED;
- 11 greenfield files: TESTED;
- 58 greenfield tests: TESTED;
- migration v2, encrypted scope, at-rest secrecy, one-time challenge, exact export, exact purge, independent verification, causal event chain, replay, lost-response reconciliation, rejection, permission, identity/session, expiry, input schema, and credential re-verification: TESTED.

Regression validation observed in run `29128209457`:

- branch-specific lint: TESTED;
- production server build: TESTED;
- agentic-loop unit suite: TESTED;
- current authenticated HTTP integration: TESTED.

Repository-wide lint remains BLOCKED by the pre-existing unused `axios` import in `scripts/check.js`.

## Deployment procedure

Deploy only to a non-production owner-controlled environment first.

1. Back up the trace database and verify the backup is readable with the current key.
2. Deploy with `MIRA_GREENFIELD_TRACE_OPERATIONS=false`.
3. Start Mira and verify migrations `[1, 2]`, existing status requests, trace health, and retention maintenance.
4. Configure only `trace.export`; keep `trace.purge` absent.
5. Enable trace operations and execute a one-trace export. Verify no-store headers, exact bundle hashes, immutable receipt, and causal events.
6. Restart and verify plan/approval/receipt reads and export replay.
7. Add `trace.purge` only after export acceptance.
8. Create disposable traces, plan one exact purge, approve, execute, and verify only the planned trace is absent.
9. Repeat with an interrupted response and verify reconciliation does not broaden the deletion scope.
10. Inspect the database and WAL for absence of raw owner/device/session IDs, approval tokens, reason codes, trace IDs, and exported envelopes outside encrypted trace storage.
11. Measure foreground request latency while maintenance and operation reads occur.

## Rollback

Immediate action rollback:

```dotenv
MIRA_GREENFIELD_TRACE_OPERATIONS=false
```

Then restart Mira and verify all operation endpoints fail closed while read-only status and trace health continue to work.

Do not delete migration v2 tables, plans, approvals, receipts, or events during a code rollback. They are owner records and audit evidence. Preserve the database and key according to owner-approved retention. A previously completed purge cannot be undone; restoration from backup is a separate owner-authorized recovery action and is not implemented in this slice.

## Remaining work

| Requirement | Status |
| --- | --- |
| Deployment, restart, and interruption acceptance | BLOCKED |
| Repository-wide lint | BLOCKED |
| Signed export archives and external destination connectors | NOT YET STARTED |
| Backup restore and owner-authorized recovery workflow | NOT YET STARTED |
| Key rotation and re-encryption | NOT YET STARTED |
| Trace/approval/receipt UI | NOT YET STARTED |
| Event-type retention matrix | NOT YET STARTED |
| Generic verified action connector | NOT YET STARTED |
| Durable companion memory and cross-store purge | NOT YET STARTED |

## Next milestone

Add key-version metadata and a non-destructive rotation readiness scanner, then implement an owner-visible trace operations UI that displays exact scope, expiry, risk, verification criteria, receipt evidence, and irreversible-purge warnings without exposing secrets.
