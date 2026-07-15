#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-${MIRA_STAGING_ENV_FILE:-$HOME/.config/mira-staging/mira.env}}"
EVIDENCE_FILE="${2:-${MIRA_STAGING_EVIDENCE_FILE:-$HOME/mira-state/deployment-evidence/latest.json}}"
SERVICE_NAME="${MIRA_STAGING_SERVICE_NAME:-mira-staging.service}"

[[ -f "$ENV_FILE" ]] || { printf 'staging-smoke: missing environment file\n' >&2; exit 1; }
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

BASE_URL="${MIRA_STAGING_BASE_URL:-http://127.0.0.1:${MIRA_PORT:-1337}}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

info_file="$TMP_DIR/info.json"
health_file="$TMP_DIR/trace-health.json"
memory_file="$TMP_DIR/memory-probe.json"
harness_card_file="$TMP_DIR/harness-card.json"
harness_create_file="$TMP_DIR/harness-create.json"
harness_task_file="$TMP_DIR/harness-task.json"
harness_payload_file="$TMP_DIR/harness-payload.json"
encoded_device="$(node -p 'encodeURIComponent(process.argv[1])' "$MIRA_GREENFIELD_PAIRED_DEVICE_ID")"

for _ in $(seq 1 60); do
  if curl --silent --show-error --fail --max-time 5 \
    "$BASE_URL/api/v1/info" >"$info_file"; then
    break
  fi
  sleep 2
done

[[ -s "$info_file" ]] || { printf 'staging-smoke: info endpoint did not become ready\n' >&2; exit 1; }

curl --silent --show-error --fail --max-time 10 \
  -H "X-API-Key: $MIRA_HTTP_API_KEY" \
  "$BASE_URL/api/v1/greenfield/trace-health?device_id=$encoded_device" \
  >"$health_file"

memory_status="$(curl --silent --show-error --max-time 10 \
  -o "$memory_file" -w '%{http_code}' \
  -H "X-API-Key: $MIRA_HTTP_API_KEY" \
  "$BASE_URL/api/v1/greenfield/memory/candidate?device_id=$encoded_device&candidate_id=deployment-readiness-probe")"
[[ "$memory_status" == '404' ]] || { printf 'staging-smoke: memory route returned HTTP %s\n' "$memory_status" >&2; exit 1; }

curl --silent --show-error --fail --max-time 10 \
  -H "X-API-Key: $MIRA_HTTP_API_KEY" \
  "$BASE_URL/api/v1/harness/card?device_id=$encoded_device" \
  >"$harness_card_file"

node - "$MIRA_GREENFIELD_PAIRED_DEVICE_ID" "${MIRA_DEPLOY_SHA:-unknown}" "$harness_payload_file" <<'NODE'
const fs = require('node:fs')
const [deviceId, deploySha, outputPath] = process.argv.slice(2)
const stableRef = deploySha.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 128) || 'unknown'
fs.writeFileSync(
  outputPath,
  JSON.stringify({
    device_id: deviceId,
    context_id: `deployment:${stableRef}`,
    idempotency_key: `deployment:${stableRef}:system-status`,
    capability_id: 'system.status.read',
    input: 'Report current Mira system status for deployment verification.',
    metadata: { purpose: 'content-free-deployment-verification' }
  })
)
NODE

curl --silent --show-error --fail --max-time 15 \
  -X POST \
  -H "X-API-Key: $MIRA_HTTP_API_KEY" \
  -H 'Content-Type: application/json' \
  --data-binary "@$harness_payload_file" \
  "$BASE_URL/api/v1/harness/tasks" \
  >"$harness_create_file"

harness_task_id="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).task.task_id' "$harness_create_file")"
[[ -n "$harness_task_id" ]] || { printf 'staging-smoke: harness did not return a task ID\n' >&2; exit 1; }
encoded_task_id="$(node -p 'encodeURIComponent(process.argv[1])' "$harness_task_id")"

for _ in $(seq 1 60); do
  curl --silent --show-error --fail --max-time 10 \
    -H "X-API-Key: $MIRA_HTTP_API_KEY" \
    "$BASE_URL/api/v1/harness/tasks/$encoded_task_id?device_id=$encoded_device" \
    >"$harness_task_file"
  harness_state="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).task.state' "$harness_task_file")"
  case "$harness_state" in
    completed) break ;;
    failed|canceled|rejected)
      printf 'staging-smoke: harness task ended in %s\n' "$harness_state" >&2
      exit 1
      ;;
  esac
  sleep 1
done
[[ "${harness_state:-}" == 'completed' ]] || { printf 'staging-smoke: harness task did not complete\n' >&2; exit 1; }

service_state="$(systemctl --user is-active "$SERVICE_NAME")"
[[ "$service_state" == 'active' ]] || { printf 'staging-smoke: service is not active\n' >&2; exit 1; }

mkdir -p "$(dirname "$EVIDENCE_FILE")"
node - \
  "$info_file" \
  "$health_file" \
  "$memory_file" \
  "$harness_card_file" \
  "$harness_task_file" \
  "$EVIDENCE_FILE" \
  "${MIRA_DEPLOY_SHA:-unknown}" <<'NODE'
const fs = require('node:fs')
const [
  infoPath,
  healthPath,
  memoryPath,
  harnessCardPath,
  harnessTaskPath,
  evidencePath,
  deploySha
] = process.argv.slice(2)
const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
const trace = JSON.parse(fs.readFileSync(healthPath, 'utf8'))
const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'))
const harnessCard = JSON.parse(fs.readFileSync(harnessCardPath, 'utf8'))
const harnessTask = JSON.parse(fs.readFileSync(harnessTaskPath, 'utf8'))

if (info.success !== true || info.status !== 200) {
  throw new Error('info endpoint did not report success')
}
if (info.routingMode !== 'agent' || info.llm?.enabled !== false) {
  throw new Error('staging is not using the expected lightweight routing configuration')
}
if (trace.success !== true || trace.health?.chain?.valid !== true) {
  throw new Error('trace health or owner chain is not valid')
}
if (memory.code !== 'memory.candidate_not_found') {
  throw new Error('memory route did not produce the expected owner-scoped probe result')
}
const capability = harnessCard.card?.capabilities?.find(
  (item) => item.capability_id === 'system.status.read'
)
if (harnessCard.success !== true || !capability) {
  throw new Error('harness card does not expose the owner-authorized status capability')
}
if (harnessTask.success !== true || harnessTask.task?.state !== 'completed') {
  throw new Error('harness status task did not complete successfully')
}
const events = harnessTask.events || []
if (events.length === 0) {
  throw new Error('harness task did not persist lifecycle events')
}
if (!events.every((event, index) => event.sequence === index + 1)) {
  throw new Error('harness event sequence is not contiguous')
}
if (!events.every((event) => event.otel?.trace_id === harnessTask.task.trace_id)) {
  throw new Error('harness lifecycle events do not share task trace identity')
}
const artifactKinds = [...new Set((harnessTask.task.artifacts || []).map((item) => item.kind))].sort()
if (!artifactKinds.includes('evidence') || !artifactKinds.includes('answer')) {
  throw new Error('harness task did not produce grounded evidence and answer artifacts')
}

const health = trace.health
const evidence = {
  schema_version: 2,
  deployment_sha: deploySha,
  observed_at: new Date().toISOString(),
  service_active: true,
  http: {
    info_success: true,
    version: info.version,
    routing_mode: info.routingMode,
    llm_enabled: info.llm.enabled,
    stt_enabled: info.stt?.enabled,
    tts_enabled: info.tts?.enabled
  },
  trace: {
    chain_valid: health.chain.valid,
    trace_count: health.traceCount ?? null,
    purge_receipt_count: health.purgeReceiptCount ?? null,
    migration_versions: health.migrationVersions ?? health.appliedMigrationVersions ?? null
  },
  memory: {
    route_authenticated: true,
    owner_scope_probe: 'not_found_as_expected'
  },
  harness: {
    card_authenticated: true,
    protocol_version: harnessCard.card.protocol_version,
    status_capability_available: true,
    task_completed: true,
    lifecycle_event_count: events.length,
    lifecycle_sequence_contiguous: true,
    causal_trace_present: Boolean(harnessTask.task.trace_id),
    artifact_kinds: artifactKinds,
    encrypted_journal_expected: true
  }
}
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
NODE

chmod 600 "$EVIDENCE_FILE"
printf 'staging-smoke: verified; evidence=%s\n' "$EVIDENCE_FILE"
