# Trace Rotation Setup Acceptance Evidence

## Final tested head

- Repository: `selmer512/mira`
- Branch: `greenfield/vertical-slice-foundation-20260710`
- Tested commit: `26dfb6fc292d44adaa02f724eb225a6ade97b492`
- Core workflow: `29135527025`
- Regression workflow: `29135527086`

## Requirement status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Stable owner lookup independent of trace keys | TESTED | migration v4 and keyring integration tests |
| Read-only multi-version keyring | TESTED | cross-version trace reads and key mismatch rejection |
| Immutable owner/key bindings | TESTED | metadata verification and SQL mutation rejection |
| Exact non-destructive rotation plans | TESTED | encrypted exact scope, target version, blockers, checkpoints, and rollback tests |
| Verified backup setup utility | TESTED | atomic snapshot, integrity/count verification, unsafe-path and overwrite rejection |
| Persisted-plan restart recovery | TESTED | close/reopen and exact plan-hash/scope verification |
| Authenticated planning API | TESTED | credential, device, schema, owner scope, no-store, and not-found tests |
| Owner rotation planning UI model | TESTED | exact scope, capacity, backup, blocker, and non-executable-plan tests |
| Repository-wide lint | TESTED | enforced regression gate completed with zero errors |
| Production server build | TESTED | regression workflow |
| Production Vite client build | TESTED | regression workflow |
| Production deployment acceptance | BLOCKED | no owner-controlled deployed environment was available |
| Journaled re-encryption executor | NOT YET STARTED | no record-rewrite route or UI control exists |

## Core workflow results

Run `29135527025` completed successfully on the tested commit.

Observed:

- Node.js 24 setup: TESTED
- Aurora declarations: TESTED
- Complete server TypeScript type-check: TESTED
- Greenfield test files: TESTED — 18 passed
- Greenfield tests: TESTED — 94 passed

The suite includes stable owner bindings, migration v4, multi-key reads, key/version conflict rejection, exact rotation scope, backup evidence, storage prerequisites, restart recovery, owner isolation, authenticated routes, UI presentation, backup creation, and immutable schema behavior.

## Regression workflow results

Run `29135527086` completed successfully on the tested commit.

Observed:

- Touched greenfield server and owner UI lint: TESTED
- Repository-wide lint: TESTED
- Production server build: TESTED
- Production Vite client build: TESTED
- Agentic-loop unit suite: TESTED — 3 passed
- Authenticated HTTP integration suite: TESTED — 3 passed

## Deployment boundary

Deployment remains BLOCKED until an owner-controlled non-production environment demonstrates:

- migration versions `[1, 2, 3, 4]` against retained owner data;
- stable binding and multi-key reads after repeated service restarts;
- owner isolation across real sessions and devices;
- browser focus, keyboard, forced-colors, and in-memory secret-clearing behavior;
- backup creation during a controlled service lifecycle;
- restoration of the backup into an isolated recovery instance;
- foreground latency under keyring and dashboard reads;
- database and WAL inspection for raw owner identifiers and key material.

Actual re-encryption remains NOT YET STARTED. The planning API and UI always report `execution_supported: false` and expose no execution control.

## Rollback

Set:

```dotenv
MIRA_GREENFIELD_TRACE_OPERATIONS=false
```

Restart Mira and verify dashboard, export, purge, and rotation-plan routes fail closed while legacy interaction and trace health remain available.

Preserve migration records, key-version metadata, stable owner/key bindings, encrypted plans, trace and operation records, owner-approved backups, and every key required to read retained data. Code rollback is not authorization to delete owner records or retire a key.
