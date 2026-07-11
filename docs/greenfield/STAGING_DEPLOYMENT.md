# Owner-Controlled Mira Staging Deployment

## Delivery status

| Requirement | Status | Evidence |
| --- | --- | --- |
| Provider-neutral staging architecture | IMPLEMENTED | user-scoped systemd service and atomic release scripts |
| GitHub deployment workflow | IMPLEMENTED | `.github/workflows/mira-staging-deploy.yml` |
| GitHub rollback workflow | IMPLEMENTED | `.github/workflows/mira-staging-rollback.yml` |
| Secret and host preflight | IMPLEMENTED | `scripts/deploy/staging-preflight.sh` |
| Authenticated deployment smoke evidence | IMPLEMENTED | `scripts/deploy/staging-smoke.sh` |
| Actual staging runner registration | BLOCKED | requires an owner-controlled machine and a short-lived GitHub registration token |
| First observed staging deployment | BLOCKED | workflow must be available on the default branch and the runner must be online |

This deployment target is intentionally owner-controlled. It does not send trace, memory, owner, device, or encryption secrets to a cloud deployment provider. The staging host stores those values in a local mode-600 environment file.

## Architecture

```text
GitHub-hosted validation job
  -> exact requested ref
  -> type-check, tests, lint, server build, client build, shell syntax
  -> protected GitHub environment approval
  -> owner-controlled self-hosted runner: linux, x64, mira-staging
  -> build new release beside current release
  -> user-scoped systemd service
  -> authenticated trace and memory smoke checks
  -> content-free evidence artifact
```

Runtime paths on the staging host:

```text
/home/mira-staging/.config/mira-staging/mira.env
/home/mira-staging/.config/systemd/user/mira-staging.service
/home/mira-staging/mira-deploy/current
/home/mira-staging/mira-deploy/releases/<commit-sha>
/home/mira-staging/mira-state/greenfield
/home/mira-staging/mira-state/backups
/home/mira-staging/mira-state/logs
/home/mira-staging/mira-state/deployment-evidence
```

The GitHub workflow never needs the owner encryption keys. It executes as the dedicated host user, and the Mira process reads its local protected environment file through systemd.

## Supported host baseline

- Owner-controlled Ubuntu 24.04 x64
- Node.js 24 or newer, installed system-wide
- npm 11 or newer
- `git`, `curl`, `rsync`, `python3`, `make`, and `g++`
- systemd with user lingering enabled
- At least enough storage for the current release, a complete new release, retained state, and three release generations

Do not register a shared workstation, a machine used for untrusted builds, or a runner that processes arbitrary external pull requests.

## 1. Prepare the host

Check out the reviewed branch on the target machine, then run once as root:

```bash
bash scripts/deploy/staging-host-bootstrap.sh /absolute/path/to/mira-checkout
```

The bootstrap:

1. verifies Ubuntu, Node, npm, compiler, systemd, and transfer prerequisites;
2. creates the dedicated `mira-staging` user when absent;
3. creates owner-only release and state directories;
4. installs the user-scoped systemd service definition;
5. copies the non-secret environment template only when no environment exists;
6. enables user lingering;
7. does not generate or print owner secrets;
8. does not register the GitHub runner automatically.

## 2. Configure host secrets

Edit as root or as `mira-staging`:

```text
/home/mira-staging/.config/mira-staging/mira.env
```

Keep mode `600` and ownership `mira-staging:mira-staging`.

Generate independent values outside source control:

```bash
openssl rand -hex 32      # HTTP API key
openssl rand -base64 32   # trace encryption key
openssl rand -base64 32   # stable owner lookup key
openssl rand -base64 32   # memory encryption key
```

The three 32-byte keys must be different. The active `v1` keyring entry must exactly match the trace master key.

Initial staging permissions deliberately omit `trace.purge` and `memory.purge`. Do not add either until disposable-data destructive acceptance is scheduled and `MIRA_STAGING_ALLOW_DESTRUCTIVE=true` is set deliberately.

Run the fail-closed preflight as the staging user:

```bash
sudo -iu mira-staging bash /absolute/path/to/mira-checkout/scripts/deploy/staging-preflight.sh
```

No raw secret is printed by the preflight.

## 3. Register the GitHub self-hosted runner

In the repository UI:

1. Open **Settings -> Actions -> Runners**.
2. Choose **New self-hosted runner**.
3. Select **Linux** and **x64**.
4. Run GitHub's generated download and configuration commands as `mira-staging`, not root.
5. Configure the runner for this repository only.
6. Add the custom label `mira-staging` while retaining `self-hosted`, `linux`, and `x64`.
7. Install the runner as a service using GitHub's generated service command.
8. Confirm the runner reports **Idle** before dispatching a deployment.

The registration token is short-lived and must not be pasted into source control, issues, logs, or this chat.

## 4. Create the protected GitHub environment

Create a repository environment named exactly:

```text
mira-staging
```

Recommended protection:

- required reviewer: the owner;
- prevent self-review when another trusted reviewer is available;
- restrict deployment branches to `develop` and explicitly reviewed release branches;
- no cloud or owner data secrets are required in GitHub for this design;
- retain deployment history.

The workflows reference this exact environment name.

## 5. Make the workflow dispatchable

GitHub manual workflows must be available from the repository's default-branch workflow set. Merge the reviewed deployment files to `develop` before attempting the first manual dispatch.

Do not mark the larger feature PR merge-ready solely to expose deployment workflows. A deployment-only PR may be split if review policy requires a smaller change set.

## 6. Deploy an exact ref

Open **Actions -> Mira staging deployment -> Run workflow** and supply an exact reviewed commit SHA.

The workflow:

1. validates that exact ref on a GitHub-hosted Ubuntu 24.04 runner;
2. runs server type-check, all greenfield tests, repository lint, both production builds, and deployment shell syntax;
3. waits for the `mira-staging` environment approval;
4. builds a new release on the owner host while the previous release remains active;
5. switches the `current` symlink only after the build completes;
6. restarts the user-scoped service;
7. verifies `/api/v1/info`;
8. verifies authenticated owner trace health and hash-chain integrity;
9. probes the authenticated memory route without exporting owner content;
10. uploads only redacted deployment evidence.

If systemd start or authenticated smoke verification fails, the script restores the previous release automatically.

## 7. Inspect deployment evidence

The host retains evidence at:

```text
/home/mira-staging/mira-state/deployment-evidence/<commit-sha>.json
```

GitHub receives a copy containing only:

- deployed commit SHA;
- observation timestamp;
- service active state;
- version and lightweight routing mode;
- disabled LLM/STT/TTS staging flags;
- trace-chain validity and non-secret counts;
- authenticated memory route probe result.

The evidence must not contain API keys, raw owner/device identifiers, memory content, trace envelopes, ciphertext, or encryption keys.

## 8. Roll back

Open **Actions -> Mira staging rollback -> Run workflow** and supply a retained release SHA.

Rollback changes only the release symlink, restarts the service, and repeats authenticated smoke verification. If the requested target fails, the originally active release is restored.

Disabling all greenfield owner operations remains available through:

```dotenv
MIRA_GREENFIELD_TRACE_OPERATIONS=false
MIRA_GREENFIELD_MEMORY=false
```

A code rollback is not authorization to delete databases, backups, traces, memory, receipts, key metadata, or keys required to read retained records.

## Security boundaries

- Never run pull-request code from untrusted contributors on the staging runner.
- Require environment approval for every deployment and rollback.
- Review workflow changes before approving a deployment from the same commit.
- Keep the runner repository-scoped.
- Keep the host environment file mode 600.
- Do not upload systemd journals automatically; logs may contain operational context.
- Do not expose staging directly to the public Internet during initial acceptance.
- Place remote access behind an owner-controlled VPN or authenticated reverse proxy in a separate reviewed milestone.
- Preserve backups and all readable key versions before any future rotation execution.

## Remaining acceptance

After the runner is connected, the first deployment must collect observed evidence for:

- migration startup on retained state;
- repeated restart recovery;
- backup creation and isolated restoration;
- browser keyboard, focus, and secret-clearing behavior;
- raw database and WAL inspection;
- foreground latency and repeated reliability;
- offline and degraded behavior;
- disposable exact-scope purge only under a separate critical approval exercise.
