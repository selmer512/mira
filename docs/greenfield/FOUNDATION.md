# Mira Greenfield Vertical Slice

## Current delivery

Mira now has a narrow production-shaped owner journey: one authenticated, server-paired device can request current Mira runtime status; deterministic routing requires fresh evidence; the response is grounded or explicitly limited; the complete causal envelope is validated, redacted, encrypted, hash-chained, and durably appended; low-priority retention maintenance verifies integrity before deleting anything; and the owner can read non-destructive trace health through an authenticated endpoint.

Actions, generic tool execution, server-model escalation, durable companion memory, and MiniCPM5 natural-language routing remain disabled.

## Repository state

- Repository: `selmer512/mira`
- Base branch: `develop`
- Base commit: `059d5b5fea878620160c61320c4cc4a8f7253426`
- Development branch: `greenfield/vertical-slice-foundation-20260710`
- Validated implementation commit: `13192c0d395b617d100816f53fd415496cc37fd3`
- Draft pull request: `#13`
- Target: Node.js 24+, npm 11.3+, TypeScript, Fastify, React/Vite, SQLite, and the existing Python bridge

## Status and evidence

| Requirement | Status | Evidence |
| --- | --- | --- |
| Architecture and contracts | DOCUMENTED | This document and `contracts.ts` |
| Deterministic policy and semantic validation | IMPLEMENTED | `policy.ts`, `validation.ts` |
| Authenticated owner/device boundary | IMPLEMENTED | `credential-identity.ts`, `runtime.ts` |
| Read-only current-status request path | IMPLEMENTED | `/api/v1/greenfield/request` |
| Fresh evidence and grounded response | IMPLEMENTED | `SystemStatusEvidenceProvider`, `SystemStatusResponseComposer` |
| Complete causal envelope | IMPLEMENTED | four linked spans and trace-backed operational states |
| Versioned trace migration | IMPLEMENTED | migration version 1 in `trace-migrations.ts` |
| Encrypted append-only persistence | IMPLEMENTED | `EncryptedSqliteTraceStore` |
| Per-owner integrity chain | IMPLEMENTED | record hash, predecessor hash, chain verification |
| Session redaction | IMPLEMENTED | deterministic redaction before encryption |
| Retention and physical purge engine | IMPLEMENTED | selective purge, expired purge, WAL truncation, vacuum |
| Content-free purge receipts | IMPLEMENTED | immutable receipt table |
| Fail-closed persistence | IMPLEMENTED | response is withheld when append fails |
| Integrity-gated retention maintenance | IMPLEMENTED | `TraceMaintenanceService` |
| Low-priority automatic scheduler | IMPLEMENTED | non-overlapping unref timer, optional startup sweep |
| Authenticated trace health | IMPLEMENTED | `/api/v1/greenfield/trace-health` |
| Core type-check and greenfield tests | TESTED | run `29116435407`: 9 files, 44 tests passed |
| Branch lint | TESTED | run `29116435406` |
| Production server build | TESTED | run `29116435406` |
| Agentic-loop unit regression | TESTED | 1 file, 3 tests passed |
| Current authenticated HTTP integration | TESTED | 1 file, 3 tests passed |
| Full repository lint | BLOCKED | one pre-existing unused `axios` import in `scripts/check.js` |
| Deployment acceptance | BLOCKED | no non-production or production deployment was observed |
| Key rotation and re-encryption | NOT YET STARTED | one active environment-backed master key |
| Owner-authorized selective purge UI/API | NOT YET STARTED | purge engine exists; no network mutation route |
| Event-type-specific retention | NOT YET STARTED | current slice emits owner-request traces only |
| MiniCPM5 provider | NOT YET STARTED | deterministic provider interface is active |
| Server-model escalation | NOT YET STARTED | contract fields only |
| Verified action runtime | NOT YET STARTED | action fields remain `null` |
| Durable companion memory and cross-store purge | NOT YET STARTED | memory candidate remains `null` |
| Client trace/health UI | NOT YET STARTED | HTTP contracts exist; no Aurora surface |

## Implemented owner journey

```text
Authenticated HTTP credential
  -> constant-time transport verification
  -> independent credential and paired-device identity resolution
  -> origin event and root trace span
  -> deterministic capability route
  -> current runtime-status evidence
  -> freshness, permission, privacy, and trace validation
  -> grounded answer or explicit inability-to-confirm limitation
  -> session-reference redaction
  -> AES-256-GCM encryption with per-owner HKDF key
  -> append-only SQLite record and predecessor hash
  -> persistence receipt
  -> owner response
```

Supported capability:

```text
system.status.read
```

The caller cannot define owner identity, trust, permissions, privacy zones, routing, evidence, retention, encryption, purge policy, action, or memory. Undeclared body fields are removed, and authoritative values are created by deterministic server components.

## HTTP contracts

### Current status request

```http
POST /api/v1/greenfield/request
X-API-Key: <configured key>
Content-Type: application/json
```

```json
{
  "device_id": "<configured paired device>",
  "capability": "system.status.read",
  "input": "Report the current Mira system status."
}
```

A successful response contains:

- grounded `answer`
- validated causal `envelope`
- source `evidence_payloads`
- non-secret `trace_persistence` receipt

The request fails closed if durable trace persistence is unavailable.

### Trace health

```http
GET /api/v1/greenfield/trace-health?device_id=<configured paired device>
X-API-Key: <configured key>
```

The response contains only owner-scoped operational metadata:

- chain validity and issue
- trace count
- purge-receipt count
- applied migration versions
- observation time

The endpoint cannot export, modify, or purge trace content.

## Trace storage design

The trace database is separate from Mira's existing memory database. Default path:

```text
core/data/greenfield/traces.sqlite
```

Migration version 1 creates:

- `greenfield_trace_schema_migrations`
- `greenfield_trace_records`
- `greenfield_trace_purge_receipts`
- owner/time, origin, and retention indexes
- update-blocking trace trigger
- update- and delete-blocking purge-receipt triggers

### Confidentiality

- AES-256-GCM authenticated encryption
- 32-byte environment-backed master key
- HKDF-SHA256 per-owner data key
- HMAC owner/device identifiers outside ciphertext
- session references redacted before encryption
- raw credential never enters the envelope or store
- restrictive directory/file modes where supported

### Integrity

Each record hash covers authenticated metadata, IV, authentication tag, and ciphertext. Each owner record links to its predecessor. Integrity verification fails on altered records or unexplained gaps.

### Purge

The deterministic store can physically delete selected or expired records. It uses secure-delete mode, truncates the WAL, vacuums the database, and appends an immutable receipt containing hashes and counts rather than trace content or trace IDs. No public mutation route is mounted.

## Retention maintenance

`TraceMaintenanceService`:

1. verifies the configured owner's chain;
2. blocks all retention deletion if the chain is invalid;
3. records counts and receipt totals;
4. physically purges expired records;
5. re-verifies the chain afterward;
6. returns a structured maintenance report.

The scheduler is non-overlapping, uses an unreferenced timer, and defaults to a 60-minute interval. Foreground request processing is not made dependent on a background run already in progress.

## Configuration

```dotenv
MIRA_OVER_HTTP=true
MIRA_HTTP_API_KEY=<generated-secret>

MIRA_GREENFIELD_ENABLED=true
MIRA_GREENFIELD_OWNER_ID=<stable-owner-id>
MIRA_GREENFIELD_PAIRED_DEVICE_ID=<stable-device-id>
MIRA_GREENFIELD_PERMISSIONS=system.status.read
MIRA_GREENFIELD_PRIVACY_ZONES=private

MIRA_GREENFIELD_TRACE_PERSISTENCE=true
MIRA_GREENFIELD_TRACE_DB_PATH=<optional path>
MIRA_GREENFIELD_TRACE_MASTER_KEY=<base64 32-byte key>
MIRA_GREENFIELD_TRACE_RETENTION_DAYS=30
MIRA_GREENFIELD_TRACE_MAINTENANCE_INTERVAL_MINUTES=60
MIRA_GREENFIELD_TRACE_MAINTENANCE_ON_STARTUP=true
```

Generate a development key with:

```bash
openssl rand -base64 32
```

Do not commit or log the key. Environment-backed identity and key management are first-slice adapters, not final pairing, session, revocation, rotation, HSM, or recovery systems.

## Observed validation

### Core workflow

GitHub Actions run `29116435407`, commit `13192c0d395b617d100816f53fd415496cc37fd3`:

```bash
npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build --workspace aurora
npx tsc --noEmit --project tsconfig.json
npm run test:greenfield
```

Observed results:

- server TypeScript type-check: TESTED
- 9 greenfield test files: TESTED
- 44 greenfield tests: TESTED
- migration idempotence: TESTED
- encryption, redaction, append, read, and at-rest plaintext absence: TESTED
- hash-chain verification and unexplained-gap detection: TESTED
- duplicate rejection and owner isolation: TESTED
- physical selective and retention purge: TESTED
- immutable purge receipts: TESTED
- fail-closed persistence: TESTED
- maintenance health and integrity-gated deletion: TESTED
- authenticated and cross-owner-isolated health route: TESTED

### Regression workflow

GitHub Actions run `29116435406`, same commit:

- branch-specific lint: TESTED
- production server build: TESTED
- agentic-loop unit: TESTED — 1 file, 3 tests
- authenticated HTTP integration: TESTED — 1 file, 3 tests
- repository lint baseline captured: BLOCKED by one unrelated unused import in `scripts/check.js`

The current HTTP test covers the real Fastify schema and API-key pre-handler for `/api/v1/utterance`; only deterministic NLU output is mocked.

## Deployment plan

1. Resolve or explicitly accept the remaining repository lint baseline.
2. Review the draft PR and unresolved review threads.
3. Back up the intended trace directory.
4. Store the API and trace keys in protected secret storage.
5. Start with both greenfield flags disabled and verify legacy startup.
6. Enable trace persistence and confirm migration version 1.
7. Configure a non-production owner, paired device, permission, privacy zone, retention, and maintenance interval.
8. Enable the request path.
9. Exercise successful request, health, missing/incorrect key, unpaired device, evidence failure, storage failure, malformed key, chain corruption, expired purge, and restart paths.
10. Verify database/WAL files contain no owner, device, credential, session, request, or envelope plaintext.
11. Verify maintenance is non-overlapping and does not impair foreground latency.
12. Attach deployment evidence before changing any status to VERIFIED IN DEPLOYMENT.

## Rollback

1. Set `MIRA_GREENFIELD_ENABLED=false` for immediate request-path rollback.
2. Stop the process to stop maintenance timers.
3. Preserve the trace database and key according to owner-approved retention. Code rollback is not authorization to delete owner data.
4. Revert the branch commits.
5. Restart and verify legacy HTTP and socket behavior.
6. Execute deterministic purge only through an owner-authorized workflow when that workflow exists.

The migration is isolated from the existing memory database. No existing memory schema is modified.

## Known limitations and risks

- Deployment and restart behavior have not been observed outside CI.
- One environment-configured owner/device and one long-lived HTTP credential are supported.
- Key rotation, re-encryption, signed checkpoints, backup/restore, replica convergence, and disaster recovery are not implemented.
- Automatic maintenance currently uses one global retention duration for owner-request traces.
- There is no owner-facing export or destructive purge approval workflow.
- The deterministic router does not invoke MiniCPM5-1B.
- No Aurora UI renders trace states, receipts, or health.
- Server reasoning, verified action execution, and durable companion memory remain disabled.
- Runtime evidence covers Mira process/provider status only.

## Next milestone

Implement a deterministic owner authorization workflow for trace export and selective purge, including scoped plans, expiry, approval binding, independent post-action verification, and owner-visible receipts. Then add key-rotation preparation and the trace/health UI. MiniCPM5, server escalation, generic actions, and companion memory remain disabled until their acceptance evidence exists.
