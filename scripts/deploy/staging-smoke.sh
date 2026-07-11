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
  "$BASE_URL/api/v1/greenfield/trace-health?device_id=$(node -p 'encodeURIComponent(process.argv[1])' "$MIRA_GREENFIELD_PAIRED_DEVICE_ID")" \
  >"$health_file"

memory_status="$(curl --silent --show-error --max-time 10 \
  -o "$memory_file" -w '%{http_code}' \
  -H "X-API-Key: $MIRA_HTTP_API_KEY" \
  "$BASE_URL/api/v1/greenfield/memory/candidate?device_id=$(node -p 'encodeURIComponent(process.argv[1])' "$MIRA_GREENFIELD_PAIRED_DEVICE_ID")&candidate_id=deployment-readiness-probe")"
[[ "$memory_status" == '404' ]] || { printf 'staging-smoke: memory route returned HTTP %s\n' "$memory_status" >&2; exit 1; }

service_state="$(systemctl --user is-active "$SERVICE_NAME")"
[[ "$service_state" == 'active' ]] || { printf 'staging-smoke: service is not active\n' >&2; exit 1; }

mkdir -p "$(dirname "$EVIDENCE_FILE")"
node - "$info_file" "$health_file" "$memory_file" "$EVIDENCE_FILE" "${MIRA_DEPLOY_SHA:-unknown}" <<'NODE'
const fs = require('node:fs')
const [infoPath, healthPath, memoryPath, evidencePath, deploySha] = process.argv.slice(2)
const info = JSON.parse(fs.readFileSync(infoPath, 'utf8'))
const trace = JSON.parse(fs.readFileSync(healthPath, 'utf8'))
const memory = JSON.parse(fs.readFileSync(memoryPath, 'utf8'))

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

const health = trace.health
const evidence = {
  schema_version: 1,
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
  }
}
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 })
NODE

chmod 600 "$EVIDENCE_FILE"
printf 'staging-smoke: verified; evidence=%s\n' "$EVIDENCE_FILE"
