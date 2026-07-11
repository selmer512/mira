#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:?usage: staging-host-bootstrap.sh <repository-checkout>}"
STAGING_USER="${MIRA_STAGING_USER:-mira-staging}"

fail() {
  printf 'staging-bootstrap: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -u)" -eq 0 ]] || fail 'run this one-time bootstrap as root'
[[ -d "$SOURCE_DIR" ]] || fail "repository checkout does not exist: $SOURCE_DIR"
[[ -f "$SOURCE_DIR/deploy/staging/mira-staging.service" ]] || fail 'staging service template is missing'
[[ -f "$SOURCE_DIR/deploy/staging/mira.env.example" ]] || fail 'staging environment template is missing'

# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == 'ubuntu' && "${VERSION_ID:-}" == '24.04' ]] || fail 'the supported staging baseline is Ubuntu 24.04'

for command_name in node npm git curl rsync systemctl loginctl python3 make g++; do
  command -v "$command_name" >/dev/null 2>&1 || fail "install the required host command before continuing: $command_name"
done

node_major="$(node -p "Number(process.versions.node.split('.')[0])")"
npm_major="$(npm --version | cut -d. -f1)"
(( node_major >= 24 )) || fail 'install system-wide Node.js 24 or newer before continuing'
(( npm_major >= 11 )) || fail 'install system-wide npm 11 or newer before continuing'

if ! id "$STAGING_USER" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash "$STAGING_USER"
fi

STAGING_HOME="$(getent passwd "$STAGING_USER" | cut -d: -f6)"
[[ -n "$STAGING_HOME" ]] || fail 'could not resolve the staging user home directory'

install -d -m 700 -o "$STAGING_USER" -g "$STAGING_USER" \
  "$STAGING_HOME/.config/mira-staging" \
  "$STAGING_HOME/.config/systemd/user" \
  "$STAGING_HOME/.local/bin" \
  "$STAGING_HOME/mira-deploy/releases" \
  "$STAGING_HOME/mira-state/greenfield" \
  "$STAGING_HOME/mira-state/backups" \
  "$STAGING_HOME/mira-state/logs" \
  "$STAGING_HOME/mira-state/legacy-memory" \
  "$STAGING_HOME/mira-state/deployment-evidence"

install -m 600 -o "$STAGING_USER" -g "$STAGING_USER" \
  "$SOURCE_DIR/deploy/staging/mira-staging.service" \
  "$STAGING_HOME/.config/systemd/user/mira-staging.service"

if [[ ! -f "$STAGING_HOME/.config/mira-staging/mira.env" ]]; then
  install -m 600 -o "$STAGING_USER" -g "$STAGING_USER" \
    "$SOURCE_DIR/deploy/staging/mira.env.example" \
    "$STAGING_HOME/.config/mira-staging/mira.env"
fi

ln -sfn "$(command -v node)" "$STAGING_HOME/.local/bin/mira-staging-node"
chown -h "$STAGING_USER:$STAGING_USER" "$STAGING_HOME/.local/bin/mira-staging-node"

loginctl enable-linger "$STAGING_USER"

printf '%s\n' \
  'staging-bootstrap: host baseline prepared' \
  "staging-bootstrap: user=$STAGING_USER" \
  "staging-bootstrap: home=$STAGING_HOME" \
  "staging-bootstrap: next=replace placeholders in $STAGING_HOME/.config/mira-staging/mira.env" \
  'staging-bootstrap: next=register a repository self-hosted runner as this user with labels linux,x64,mira-staging' \
  'staging-bootstrap: no owner secret or GitHub runner token was generated or printed'
