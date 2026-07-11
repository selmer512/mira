#!/usr/bin/env bash
set -euo pipefail

TARGET_SHA="${1:?usage: staging-rollback.sh <release-sha>}"
DEPLOY_ROOT="${MIRA_STAGING_DEPLOY_ROOT:-$HOME/mira-deploy}"
STATE_ROOT="${MIRA_STAGING_STATE_ROOT:-$HOME/mira-state}"
ENV_FILE="${MIRA_STAGING_ENV_FILE:-$HOME/.config/mira-staging/mira.env}"
SERVICE_NAME="${MIRA_STAGING_SERVICE_NAME:-mira-staging.service}"
TARGET_RELEASE="$DEPLOY_ROOT/releases/$TARGET_SHA"
CURRENT_LINK="$DEPLOY_ROOT/current"
EVIDENCE_FILE="$STATE_ROOT/deployment-evidence/rollback-$TARGET_SHA-$(date -u +%Y%m%dT%H%M%SZ).json"

fail() {
  printf 'staging-rollback: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -u)" -ne 0 ]] || fail 'run rollback as the dedicated mira-staging user, not root'
[[ "$TARGET_SHA" =~ ^[a-f0-9]{7,64}$ ]] || fail 'target SHA is invalid'
[[ -d "$TARGET_RELEASE" ]] || fail "target release is unavailable: $TARGET_RELEASE"
[[ -f "$TARGET_RELEASE/server/dist/index.js" ]] || fail 'target release does not contain a built server'
[[ -f "$TARGET_RELEASE/app/dist/index.html" ]] || fail 'target release does not contain a built client'

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

bash "$TARGET_RELEASE/scripts/deploy/staging-preflight.sh" "$ENV_FILE"

original_release=''
if [[ -L "$CURRENT_LINK" ]]; then
  original_release="$(readlink -f "$CURRENT_LINK")"
fi

restore_original() {
  if [[ -n "$original_release" && -d "$original_release" ]]; then
    restore_link="$DEPLOY_ROOT/.restore-current-$$"
    ln -s "$original_release" "$restore_link"
    mv -Tf "$restore_link" "$CURRENT_LINK"
    systemctl --user restart "$SERVICE_NAME" || true
  fi
}

next_link="$DEPLOY_ROOT/.rollback-current-$$"
ln -s "$TARGET_RELEASE" "$next_link"
mv -Tf "$next_link" "$CURRENT_LINK"

if ! systemctl --user restart "$SERVICE_NAME"; then
  restore_original
  fail 'target release could not start; original release restored'
fi

if ! MIRA_DEPLOY_SHA="$TARGET_SHA" \
  MIRA_STAGING_EVIDENCE_FILE="$EVIDENCE_FILE" \
  bash "$TARGET_RELEASE/scripts/deploy/staging-smoke.sh" "$ENV_FILE" "$EVIDENCE_FILE"; then
  restore_original
  fail 'rollback target failed authenticated smoke verification; original release restored'
fi

printf 'staging-rollback: active release=%s evidence=%s\n' "$TARGET_SHA" "$EVIDENCE_FILE"
