# Stable Trace Keyring and Rotation Planning Setup

## Delivery status

This milestone removes the architectural setup blockers that previously prevented safe rotation planning. It adds stable owner lookup independent of trace encryption keys, a read-only multi-version keyring, immutable owner/key bindings, verified backup creation, exact non-destructive rotation plans, authenticated APIs, and an owner-visible planning interface.

It does **not** execute re-encryption. Every plan returns `execution_supported: false` and `ready_for_execution: false` until a separately reviewed journaled re-encryption executor and recovery protocol exist.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Stable owner lookup secret | IMPLEMENTED | `TraceReadKeyring` and migration v4 owner bindings |
| Multi-version read-only keyring | IMPLEMENTED | trace and operation-plan reads by registered fingerprint/version |
| Immutable owner/key bindings | IMPLEMENTED | migration v4 triggers and integrity hashes |
| Exact non-destructive rotation plan | IMPLEMENTED | `TraceRotationPlanner` |
| Backup creation and verification | IMPLEMENTED | `scripts/greenfield/create-trace-backup.js` |
| Persisted plan restart recovery | IMPLEMENTED | encrypted rotation-plan table and reopen tests |
| Authenticated planning API | IMPLEMENTED | `api/greenfield/trace-rotation.ts` |
| Owner planning UI | IMPLEMENTED | `trace-rotation-panel.js` |
| Re-encryption executor | NOT YET STARTED | deliberately unavailable |
| Production deployment acceptance | BLOCKED | no owner-controlled deployed environment observed |

## Security model

### Stable owner lookup

`MIRA_GREENFIELD_OWNER_LOOKUP_KEY` is a separate 32-byte secret used only to derive a stable keyed owner identifier across trace-key versions. It must not equal any trace encryption key.

The database stores only:

- the stable keyed owner identifier;
- registered key version and fingerprint;
- the owner identifier keyed by that version's encryption key;
- registration time and canonical metadata hash.

Raw owner IDs and key material are not stored in the binding table.

### Read-only keyring

`MIRA_GREENFIELD_TRACE_KEYRING_JSON` maps every readable key version to its base64-encoded 32-byte key. The active entry must exactly match `MIRA_GREENFIELD_TRACE_MASTER_KEY` and `MIRA_GREENFIELD_TRACE_KEY_VERSION`.

The keyring rejects:

- malformed JSON;
- invalid version identifiers;
- invalid key length;
- active-key mismatch;
- one key fingerprint under multiple versions;
- one version bound to different key material;
- corrupted key or owner-binding metadata.

The keyring opens existing traces and encrypted operation plans by registered key fingerprint. It does not write, rotate, retire, or delete keys.

### Rotation plans

A rotation plan is encrypted under the current owner key and immutable. It contains exact trace IDs, operation-plan IDs, record hashes, source versions, target version, backup evidence, storage calculations, interruption checkpoints, verification criteria, rollback limits, and deterministic blockers.

The public response always states that execution is unsupported. There is no execute route or UI control.

## Required configuration

Keep secrets in the deployment secret manager or protected local environment, never in source control.

```dotenv
MIRA_GREENFIELD_ENABLED=true
MIRA_GREENFIELD_TRACE_PERSISTENCE=true
MIRA_GREENFIELD_TRACE_OPERATIONS=true

MIRA_GREENFIELD_OWNER_ID=<owner-id>
MIRA_GREENFIELD_PAIRED_DEVICE_ID=<paired-device-id>
MIRA_HTTP_API_KEY=<owner-api-key>

MIRA_GREENFIELD_TRACE_DB_PATH=/absolute/path/to/traces.sqlite
MIRA_GREENFIELD_TRACE_MASTER_KEY=<active-base64-32-byte-key>
MIRA_GREENFIELD_TRACE_KEY_VERSION=v1
MIRA_GREENFIELD_OWNER_LOOKUP_KEY=<separate-base64-32-byte-secret>
MIRA_GREENFIELD_TRACE_KEYRING_JSON={"v1":"<active-key>","v2":"<registered-target-key>"}
MIRA_GREENFIELD_TRACE_BACKUP_PATH=/absolute/path/to/backups/traces.sqlite
MIRA_GREENFIELD_TRACE_ROTATION_PLAN_TTL_SECONDS=900
MIRA_GREENFIELD_TRACE_ROTATION_SPACE_MULTIPLIER=2.2

MIRA_GREENFIELD_PERMISSIONS=system.status.read,trace.operations.read,trace.rotation.plan
MIRA_GREENFIELD_PRIVACY_ZONES=private
```

Grant `trace.export` and `trace.purge` separately only when those owner operations are required.

Generate three independent values outside the repository:

```bash
openssl rand -base64 32  # active trace key
openssl rand -base64 32  # future registered target key
openssl rand -base64 32  # stable owner lookup secret
```

Never reuse one generated value for another role.

## Setup procedure

### 1. Preserve the current environment

Record the current commit, database path, active version, key fingerprint, enabled permissions, and service status. Do not print raw keys.

Back up the deployment configuration and confirm the owner controls its recovery location.

### 2. Configure stable lookup and the read keyring

Keep the existing active key as `v1` unless it already has another registered version. Add that exact key and the future target key to the JSON keyring.

Do not switch `MIRA_GREENFIELD_TRACE_MASTER_KEY` or the active version. This milestone prepares reads and plans only.

### 3. Start with operation routes disabled

```dotenv
MIRA_GREENFIELD_TRACE_OPERATIONS=false
```

Start Mira once and verify legacy interaction and current trace health. Then stop Mira before creating the first backup.

### 4. Create a verified SQLite snapshot

```bash
MIRA_GREENFIELD_TRACE_DB_PATH=/absolute/path/to/traces.sqlite \
MIRA_GREENFIELD_TRACE_BACKUP_PATH=/absolute/path/to/backups/traces.sqlite \
npx tsx scripts/greenfield/create-trace-backup.js
```

The utility:

1. rejects a missing live database or identical live/backup paths;
2. refuses to replace an existing backup by default;
3. checkpoints and truncates the WAL;
4. creates a compact snapshot with `VACUUM INTO`;
5. runs `PRAGMA integrity_check`;
6. compares migration versions and protected record counts;
7. atomically renames the verified temporary snapshot;
8. applies restrictive filesystem permissions where supported;
9. emits content-free evidence only.

To replace a backup intentionally after preserving the old copy:

```bash
MIRA_GREENFIELD_TRACE_BACKUP_REPLACE=true \
MIRA_GREENFIELD_TRACE_DB_PATH=/absolute/path/to/traces.sqlite \
MIRA_GREENFIELD_TRACE_BACKUP_PATH=/absolute/path/to/backups/traces.sqlite \
npx tsx scripts/greenfield/create-trace-backup.js
```

### 5. Enable read and planning permissions

```dotenv
MIRA_GREENFIELD_TRACE_OPERATIONS=true
MIRA_GREENFIELD_PERMISSIONS=system.status.read,trace.operations.read,trace.rotation.plan
```

Restart Mira. The first authenticated dashboard or planning read applies migrations in order and registers stable owner/key bindings.

Expected migration versions are `[1, 2, 3, 4]`.

### 6. Verify the dashboard

Open **Trace operations** and confirm:

- owner trace-chain validity;
- all expected key versions and fingerprints;
- zero unreadable traces or operation plans;
- no stable-owner or keyring blocker;
- correct owner-isolated trace and receipt inventory.

### 7. Create a non-destructive rotation plan

Open **Rotation plan**, enter the paired device, API key, and registered non-active target version, then create the plan.

Verify:

- exact trace and operation-plan counts;
- exact trace IDs and record hashes;
- source and target versions;
- verified backup evidence;
- required and available storage;
- interruption checkpoints;
- post-rotation verification criteria;
- rollback limits;
- `execution_supported: false`;
- `ready_for_execution: false`;
- blocker `rotation.reencryption_executor_not_implemented`.

No trace ciphertext, active key, permission, or owner identity is changed by this action.

### 8. Restart recovery acceptance

Restart Mira without changing any key configuration. Read the persisted rotation plan by owner and plan ID and confirm its public plan hash and exact scope match the original response.

Repeat the dashboard read and confirm all protected records remain readable across every registered version.

## API contracts

### Create a plan

```http
POST /api/v1/greenfield/trace-rotation/plan
X-API-Key: <owner-api-key>
Content-Type: application/json
```

```json
{
  "device_id": "<paired-device-id>",
  "target_key_version": "v2"
}
```

### Read a persisted plan

```http
GET /api/v1/greenfield/trace-rotation/plan?device_id=<paired-device-id>&rotation_plan_id=<plan-id>
X-API-Key: <owner-api-key>
```

Both responses use `Cache-Control: no-store` and independently re-verify the API credential and paired device.

## Validation commands

```bash
npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build --workspace aurora
npx tsc --noEmit --project tsconfig.json
npm run test:greenfield
npx eslint \
  'app/src/js/*.{ts,js}' \
  'scripts/**/*.{ts,js}' \
  'server/src/**/*.{ts,js}' \
  --ignore-pattern .gitignore
npm run build:server
npm run build:app
npm run test:agentic-loop:unit
npm run test:over-http
```

## Deployment acceptance still required

The following remain **BLOCKED** until observed in an owner-controlled non-production deployment:

- migration `[1, 2, 3, 4]` against a real retained database;
- stable binding after repeated service restarts;
- owner isolation with multiple real owner/device sessions;
- browser keyboard, focus, secret-clearing, and forced-colors behavior;
- backup creation while the deployed service lifecycle is controlled;
- backup restoration into an isolated recovery instance;
- foreground latency under keyring/dashboard reads;
- database and WAL inspection for raw owner IDs and keys;
- interrupted future rotation execution, because execution is not implemented.

## Rollback

Disable all operation and rotation planning routes:

```dotenv
MIRA_GREENFIELD_TRACE_OPERATIONS=false
```

Restart Mira and verify the dashboard, export/purge routes, and rotation-plan routes fail closed while legacy interaction and trace health remain available.

Preserve:

- migrations and key-version registry;
- stable owner/key bindings;
- encrypted rotation plans;
- trace and operation records;
- owner-approved backups;
- every key still required to read retained data.

Code rollback is not authorization to delete owner records or retire a key. Actual key retirement remains **NOT YET STARTED**.

## Next milestone

Implement a journaled, resumable, copy-on-write re-encryption executor behind a separate critical approval boundary. It must verify each rewritten record, preserve the complete causal chain, retain source-key recovery until restart acceptance, and independently verify backup restoration before any key retirement can be planned.
