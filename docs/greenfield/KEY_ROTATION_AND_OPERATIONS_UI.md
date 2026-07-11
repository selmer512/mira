# Trace Key Rotation Readiness and Owner Operations UI

## Delivery status

This milestone adds explicit encryption-key version metadata, a non-destructive owner-scoped rotation-readiness scanner, and a usable web interface for the previously implemented trace export and selective physical purge lifecycle.

It does **not** rotate keys, decrypt and re-encrypt records, restore backups, or introduce a generic action executor. The scanner reports those missing deterministic capabilities as blockers and always returns `rotation_supported: false`.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Append-only key-version registry | IMPLEMENTED | migration v3 and immutable SQLite triggers |
| One-to-one key version and key fingerprint binding | IMPLEMENTED | deterministic key registry checks |
| Existing trace key fingerprint mapping | IMPLEMENTED | owner-scoped catalog joins trace records to the registry |
| Non-destructive readiness scanner | IMPLEMENTED | `TraceOperationsDashboardService` |
| Owner/device/session authentication | IMPLEMENTED | existing credential and paired-device identity boundary |
| Read-only dashboard permission | IMPLEMENTED | `trace.operations.read` |
| Trace catalog | IMPLEMENTED | owner-scoped, metadata-only, maximum 200 current records |
| Plan and receipt history | IMPLEMENTED | owner-scoped, maximum 50 recent plans |
| Current chain and migration evidence | IMPLEMENTED | trace-chain verification and schema ledger |
| Owner operations web panel | IMPLEMENTED | `trace-operations-panel.js` and SCSS |
| Exact plan review and expiry display | IMPLEMENTED | server plan data and client model |
| Irreversible-purge acknowledgement | IMPLEMENTED | explicit owner checkbox before approval |
| Receipt-backed success display | IMPLEMENTED | execution and verification receipt fields |
| Production client build enforcement | IMPLEMENTED | regression workflow `build:app` gate |
| Server type-check and focused tests | TESTED | core workflow `29133780077` |
| Server and client production builds | TESTED | regression workflow `29133780072` |
| Deployment and browser acceptance | BLOCKED | no owner-controlled deployed environment observed |
| Actual key rotation and re-encryption | NOT YET STARTED | scanner explicitly blocks rotation |

## Governing boundary

Key and trace policy remain deterministic. Models do not select key versions, approve a rotation, decide which records are re-encrypted, override owner scope, or declare a rotation successful.

The current scanner answers only:

1. Which configured key version maps to the active trace-key fingerprint?
2. Does the append-only key metadata verify?
3. Is the owner trace chain valid?
4. Which owner traces use the active, unknown, or foreign key fingerprint?
5. Are active, approved-but-unexecuted, or unreadable operation plans present?
6. Which deterministic capabilities are still missing before rotation could be authorized?

It never mutates trace ciphertext, operation ciphertext, key material, or retention state.

## Migration v3

Migration version 3 adds:

- `greenfield_trace_key_versions`;
- unique `key_version` primary key;
- unique `encryption_key_id` fingerprint;
- fixed `aes-256-gcm` algorithm identifier;
- registration timestamp;
- canonical metadata hash;
- key-fingerprint lookup index;
- update-blocking trigger;
- delete-blocking trigger.

A key version is a stable lowercase identifier matching `^[a-z0-9][a-z0-9._-]{0,63}$`.

The registry enforces both directions:

- one version cannot be reused for different key material;
- one key fingerprint cannot be relabeled with another version.

The active fingerprint remains the existing `sha256(masterKey).slice(0, 16)` identifier. Migration v3 adds explicit metadata without changing existing trace authenticated data, ciphertext, record hashes, or operation plan encryption.

## Deterministic migration ordering

The production dashboard wrapper initializes schemas only when an authenticated dashboard request reaches the runtime:

1. trace schema v1;
2. operation schema v2;
3. key metadata schema v3.

No migration executes at module import. Disabled deployments remain disabled, and an empty owner-controlled database receives the required prerequisite schemas before the first readiness read.

## Readiness blockers

The report always includes these blockers until their implementations and acceptance evidence exist:

- `rotation.stable_owner_lookup_not_implemented`;
- `rotation.multi_key_keyring_not_implemented`;
- `rotation.reencryption_executor_not_implemented`;
- `rotation.backup_restore_not_verified`.

Additional observed blockers include:

- key-version reuse with different key material;
- key material reused under another version;
- registry metadata integrity failure;
- invalid owner trace chain;
- unregistered trace key fingerprints;
- foreign trace key fingerprints;
- operation plans unreadable with the active key;
- active unexpired operation plans.

Warnings include an empty trace inventory and a catalog truncated at the owner-visible limit.

A `ready` data state would mean only that the observed inventory is internally consistent. It would not make rotation executable because `rotation_supported` remains `false` until a separate deterministic keyring, plan, executor, verifier, recovery path, and owner approval flow are implemented.

## Authenticated dashboard API

```http
GET /api/v1/greenfield/trace-operations/dashboard?device_id=<paired-device>
X-API-Key: <configured credential>
```

The route:

- is mounted behind the existing API-key pre-handler;
- independently re-verifies the credential at the identity boundary;
- requires the paired device;
- requires `trace.operations.read`;
- requires access to the `private` privacy zone;
- ignores any client attempt to assert owner identity;
- returns `Cache-Control: no-store`;
- returns keyed owner and device references rather than raw identifiers.

Fastify strips undeclared query fields before identity and dashboard access. The server still resolves owner authority exclusively from configured identity state.

## Dashboard response

The response contains:

- observation time;
- readiness status and `rotation_supported: false`;
- active key version, fingerprint, algorithm, registration time, and metadata-integrity result;
- current owner trace-chain result;
- total and cataloged trace counts;
- active, unknown, and foreign key inventory;
- active-plan, approved-unexecuted, unreadable-plan, and verified-receipt counts;
- deterministic blockers and warnings;
- applied migration versions;
- owner-scoped trace metadata;
- owner-scoped recent plan, approval, and immutable receipt evidence.

The trace catalog exposes trace IDs, event type, timestamps, privacy class, record hash, retention deadline, key fingerprint, and registered key version. It does not expose decrypted trace envelopes.

Recent plans expose exact trace IDs only after successful owner-bound decryption with the active key. A plan that cannot be decrypted is represented as unavailable metadata and becomes a rotation blocker rather than being silently omitted.

## Owner web interface

The existing web app now mounts a `Trace operations` control in the top container. The panel provides:

1. Paired-device and API-key entry.
2. Current key-readiness evidence.
3. Current owner trace catalog and exact selection count.
4. Export or purge plan creation.
5. Stable reason-code validation.
6. Immutable plan review with exact scope hash, trace IDs, expiry, risk, rollback support, and verification criteria.
7. Separate approve/reject and execute steps.
8. Explicit irreversible-purge acknowledgement.
9. Receipt-backed execution and verification status.
10. Verified export download only after successful independent verification.
11. Recent owner plan and receipt history.

The interface does not claim success from HTTP completion alone. It displays success only from a receipt whose execution and verification statuses both succeeded.

## Client secret handling

The web panel:

- keeps the API key only in JavaScript memory;
- clears the API-key input and in-memory value when the panel closes;
- keeps the one-time approval token only in memory;
- clears the token immediately after an immutable decision;
- does not use `localStorage` or `sessionStorage`;
- does not write secrets to the DOM, URL, or console;
- sends no-store requests and receives no-store operation responses;
- inserts server-derived text with `textContent` rather than HTML interpolation.

A browser refresh intentionally loses credentials and an unused one-time approval token.

## Accessibility and truthful state

The panel includes:

- dialog semantics and an accessible title;
- keyboard close with Escape;
- focus return to the launch control;
- live status messages;
- textual risk and status labels in addition to color;
- responsive layouts;
- reduced-motion handling;
- forced-colors borders;
- explicit plan expiry countdown and expired state;
- separate approval and execution controls.

Purge language states that deletion cannot be undone and that backup restoration is not implemented.

## Configuration

```dotenv
MIRA_GREENFIELD_ENABLED=true
MIRA_GREENFIELD_TRACE_PERSISTENCE=true
MIRA_GREENFIELD_TRACE_OPERATIONS=true
MIRA_GREENFIELD_TRACE_MASTER_KEY=<base64-encoded-32-byte-key>
MIRA_GREENFIELD_TRACE_KEY_VERSION=v1
MIRA_GREENFIELD_PERMISSIONS=system.status.read,trace.operations.read
MIRA_GREENFIELD_PRIVACY_ZONES=private
```

Add `trace.export` only for an owner allowed to create exports. Add `trace.purge` separately and only after non-production export and purge acceptance.

Never change `MIRA_GREENFIELD_TRACE_KEY_VERSION` while retaining the same key, and never replace key material while reusing a registered version. The scanner reports either condition as a blocker; it does not repair it.

## Observed tests

Core workflow `29133780077` executed:

```bash
npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm run build --workspace aurora
npx tsc --noEmit --project tsconfig.json
npm run test:greenfield
```

Observed:

- full server TypeScript type-check: TESTED;
- 14 greenfield test files: TESTED;
- 73 greenfield tests: TESTED;
- migration v3 registration and immutability: TESTED;
- key/version reuse conflicts: TESTED;
- owner trace isolation: TESTED;
- active-plan blocker: TESTED;
- dashboard credential and paired-device checks: TESTED;
- no-store dashboard response: TESTED;
- Fastify undeclared-query stripping: TESTED;
- exact expiry and plan-review client model: TESTED;
- irreversible purge presentation: TESTED;
- reason-code validation: TESTED;
- receipt-backed evidence display: TESTED.

Regression workflow `29133780072` observed:

- touched greenfield server and owner-UI lint: TESTED;
- production server build: TESTED;
- production Vite client build: TESTED;
- agentic-loop unit suite: TESTED — 3 tests;
- authenticated HTTP integration: TESTED — 3 tests.

Repository-wide lint remains BLOCKED by the pre-existing unused `axios` import in `scripts/check.js`.

## Deployment procedure

Deployment remains BLOCKED until the following are observed in a non-production owner-controlled environment:

1. Back up the trace database and prove it can be opened with the current key.
2. Deploy with trace operations disabled.
3. Start Mira and confirm migration versions `[1, 2, 3]`.
4. Confirm legacy status, trace health, and retention behavior.
5. Configure `trace.operations.read` and `MIRA_GREENFIELD_TRACE_KEY_VERSION=v1`.
6. Enable trace operations without granting export or purge.
7. Open the web panel and authenticate with the paired device.
8. Confirm the catalog contains only the authenticated owner's traces.
9. Confirm the scanner shows rotation unsupported and lists all missing capabilities.
10. Restart and confirm the key registration timestamp and mapping remain stable.
11. Confirm changing the key while retaining `v1` produces a deterministic conflict.
12. Grant export, exercise exact plan/approval/execution/verification, and download the verified bundle.
13. Confirm browser refresh clears credentials and approval tokens.
14. Grant purge only for disposable traces and verify the irreversible acknowledgement.
15. Measure foreground interaction latency while the dashboard reads trace and operation metadata.
16. Inspect the database and WAL for absence of raw owner, device, session, API-key, and approval-token plaintext outside encrypted records.
17. Test keyboard operation, reduced motion, forced colors, narrow viewport, and screen-reader labels.

## Rollback

Immediate UI and operation rollback:

```dotenv
MIRA_GREENFIELD_TRACE_OPERATIONS=false
```

Restart Mira and verify:

- dashboard, planning, approval, and execution routes fail closed;
- legacy interaction remains available;
- migration v3 key metadata remains preserved;
- trace and operation audit records remain preserved;
- no owner data is deleted by code rollback.

Revert the UI and route commits only after disabling the feature. Do not drop `greenfield_trace_key_versions`; it is append-only audit and provenance metadata. Do not rename a registered key version during rollback.

A completed purge cannot be rolled back. Actual key rotation and re-encryption are not present, so there is no rotated ciphertext to reverse in this milestone.

## Risks and remaining work

| Requirement | Status |
| --- | --- |
| Non-production browser and restart acceptance | BLOCKED |
| Backup readability and restore acceptance | BLOCKED |
| Repository-wide lint | BLOCKED |
| Stable owner lookup independent of active key | NOT YET STARTED |
| Multi-version keyring | NOT YET STARTED |
| Owner-authorized rotation plan | NOT YET STARTED |
| Trace and operation re-encryption executor | NOT YET STARTED |
| Independent rotation verifier | NOT YET STARTED |
| Rotation interruption recovery | NOT YET STARTED |
| Signed export archive | NOT YET STARTED |
| Owner-authorized backup restoration | NOT YET STARTED |
| Event-type retention matrix | NOT YET STARTED |
| Generic verified action connectors | NOT YET STARTED |
| Durable companion memory and cross-store purge | NOT YET STARTED |

## Next milestone

Implement stable owner lookup metadata and a multi-version, read-only keyring capable of opening records by registered key version. Then add a non-destructive rotation plan that computes exact trace and operation scope, required storage headroom, backup prerequisites, interruption checkpoints, verification criteria, and rollback limits without executing re-encryption.
