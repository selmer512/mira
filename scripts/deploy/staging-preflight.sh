#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-${MIRA_STAGING_ENV_FILE:-$HOME/.config/mira-staging/mira.env}}"
STATE_ROOT="${MIRA_STAGING_STATE_ROOT:-$HOME/mira-state}"

fail() {
  printf 'staging-preflight: %s\n' "$1" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is unavailable: $1"
}

for command_name in node npm curl rsync systemctl stat python3 make g++; do
  require_command "$command_name"
done

[[ -f "$ENV_FILE" ]] || fail "environment file does not exist: $ENV_FILE"

mode="$(stat -c '%a' "$ENV_FILE")"
other_digit="${mode: -1}"
group_digit="${mode: -2:1}"
[[ "$other_digit" == '0' ]] || fail 'environment file must not be readable or writable by other users'
(( 10#$group_digit <= 4 )) || fail 'environment file group permissions are too broad'

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

required_values=(
  MIRA_BIND_HOST
  MIRA_HTTP_API_KEY
  MIRA_GREENFIELD_OWNER_ID
  MIRA_GREENFIELD_PAIRED_DEVICE_ID
  MIRA_GREENFIELD_TRACE_DB_PATH
  MIRA_GREENFIELD_TRACE_MASTER_KEY
  MIRA_GREENFIELD_TRACE_KEY_VERSION
  MIRA_GREENFIELD_OWNER_LOOKUP_KEY
  MIRA_GREENFIELD_TRACE_KEYRING_JSON
  MIRA_GREENFIELD_TRACE_BACKUP_PATH
  MIRA_GREENFIELD_MEMORY_DB_PATH
  MIRA_GREENFIELD_MEMORY_MASTER_KEY
  MIRA_GREENFIELD_MEMORY_KEY_VERSION
)

for name in "${required_values[@]}"; do
  value="${!name:-}"
  [[ -n "$value" ]] || fail "$name is required"
  [[ "$value" != REPLACE_* ]] || fail "$name still contains a placeholder"
done

required_true=(
  MIRA_OVER_HTTP
  MIRA_GREENFIELD_ENABLED
  MIRA_GREENFIELD_TRACE_PERSISTENCE
  MIRA_GREENFIELD_TRACE_OPERATIONS
  MIRA_GREENFIELD_MEMORY
)
for name in "${required_true[@]}"; do
  [[ "${!name:-}" == 'true' ]] || fail "$name must be true for staging acceptance"
done

[[ "$MIRA_BIND_HOST" == '127.0.0.1' ]] || fail 'initial staging must bind to 127.0.0.1; add a reviewed VPN or proxy before wider exposure'
[[ "${#MIRA_HTTP_API_KEY}" -ge 32 ]] || fail 'MIRA_HTTP_API_KEY must contain at least 32 characters'
[[ "${MIRA_GREENFIELD_PRIVACY_ZONES:-}" == *private* ]] || fail 'the private privacy zone is required'

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
npm_major="$(npm --version | cut -d. -f1)"
(( node_major >= 24 )) || fail 'Node.js 24 or newer is required'
(( npm_major >= 11 )) || fail 'npm 11 or newer is required'

validate_key() {
  local name="$1"
  local value="${!name}"
  node -e '
    const value = process.argv[1]
    const decoded = Buffer.from(value, "base64")
    if (decoded.length !== 32) process.exit(1)
  ' "$value" || fail "$name must be a base64-encoded 32-byte key"
}

validate_key MIRA_GREENFIELD_TRACE_MASTER_KEY
validate_key MIRA_GREENFIELD_OWNER_LOOKUP_KEY
validate_key MIRA_GREENFIELD_MEMORY_MASTER_KEY

[[ "$MIRA_GREENFIELD_TRACE_MASTER_KEY" != "$MIRA_GREENFIELD_OWNER_LOOKUP_KEY" ]] || fail 'trace and owner lookup keys must be distinct'
[[ "$MIRA_GREENFIELD_TRACE_MASTER_KEY" != "$MIRA_GREENFIELD_MEMORY_MASTER_KEY" ]] || fail 'trace and memory keys must be distinct'
[[ "$MIRA_GREENFIELD_OWNER_LOOKUP_KEY" != "$MIRA_GREENFIELD_MEMORY_MASTER_KEY" ]] || fail 'owner lookup and memory keys must be distinct'

node -e '
  const keyring = JSON.parse(process.argv[1])
  const version = process.argv[2]
  const active = process.argv[3]
  if (!keyring || typeof keyring !== "object" || Array.isArray(keyring)) process.exit(1)
  if (keyring[version] !== active) process.exit(2)
  const fingerprints = Object.values(keyring).map((value) => {
    const key = Buffer.from(String(value), "base64")
    if (key.length !== 32) process.exit(3)
    return key.toString("hex")
  })
  if (new Set(fingerprints).size !== fingerprints.length) process.exit(4)
' "$MIRA_GREENFIELD_TRACE_KEYRING_JSON" "$MIRA_GREENFIELD_TRACE_KEY_VERSION" "$MIRA_GREENFIELD_TRACE_MASTER_KEY" || fail 'trace keyring is invalid or does not match the active key'

for path_name in MIRA_GREENFIELD_TRACE_DB_PATH MIRA_GREENFIELD_TRACE_BACKUP_PATH MIRA_GREENFIELD_MEMORY_DB_PATH; do
  path_value="${!path_name}"
  [[ "$path_value" == /* ]] || fail "$path_name must be absolute"
  case "$path_value" in
    "$STATE_ROOT"/*) ;;
    *) fail "$path_name must remain under $STATE_ROOT" ;;
  esac
done

permissions=",${MIRA_GREENFIELD_PERMISSIONS:-},"
for capability in system.status.read trace.operations.read memory.read; do
  [[ "$permissions" == *",$capability,"* ]] || fail "required capability is missing: $capability"
done

if [[ "${MIRA_STAGING_ALLOW_DESTRUCTIVE:-false}" != 'true' ]]; then
  for capability in trace.purge memory.purge; do
    [[ "$permissions" != *",$capability,"* ]] || fail "$capability is forbidden until destructive staging acceptance is explicitly enabled"
  done
fi

mkdir -p \
  "$STATE_ROOT/greenfield" \
  "$STATE_ROOT/backups" \
  "$STATE_ROOT/logs" \
  "$STATE_ROOT/legacy-memory"
chmod 700 "$STATE_ROOT" "$STATE_ROOT/greenfield" "$STATE_ROOT/backups" "$STATE_ROOT/logs" "$STATE_ROOT/legacy-memory"

printf 'staging-preflight: ready (node=%s npm=%s bind=%s environment=%s)\n' "$(node --version)" "$(npm --version)" "$MIRA_BIND_HOST" "$ENV_FILE"
