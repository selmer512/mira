#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${1:?usage: staging-deploy.sh <source-directory> <release-sha>}"
RELEASE_SHA="${2:?usage: staging-deploy.sh <source-directory> <release-sha>}"
DEPLOY_ROOT="${MIRA_STAGING_DEPLOY_ROOT:-$HOME/mira-deploy}"
STATE_ROOT="${MIRA_STAGING_STATE_ROOT:-$HOME/mira-state}"
ENV_FILE="${MIRA_STAGING_ENV_FILE:-$HOME/.config/mira-staging/mira.env}"
SERVICE_NAME="${MIRA_STAGING_SERVICE_NAME:-mira-staging.service}"
RELEASE_ROOT="$DEPLOY_ROOT/releases"
RELEASE_DIR="$RELEASE_ROOT/$RELEASE_SHA"
BUILD_DIR="$RELEASE_ROOT/.building-$RELEASE_SHA"
CURRENT_LINK="$DEPLOY_ROOT/current"
EVIDENCE_FILE="$STATE_ROOT/deployment-evidence/$RELEASE_SHA.json"

fail() {
  printf 'staging-deploy: %s\n' "$1" >&2
  exit 1
}

[[ "$(id -u)" -ne 0 ]] || fail 'run the deployment as the dedicated mira-staging user, not root'
[[ -d "$SOURCE_DIR" ]] || fail "source directory does not exist: $SOURCE_DIR"
[[ "$RELEASE_SHA" =~ ^[a-f0-9]{7,64}$ ]] || fail 'release SHA is invalid'

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=$XDG_RUNTIME_DIR/bus}"

bash "$SOURCE_DIR/scripts/deploy/staging-preflight.sh" "$ENV_FILE"

mkdir -p "$RELEASE_ROOT" "$STATE_ROOT/deployment-evidence" "$HOME/.config/systemd/user" "$HOME/.local/bin"
chmod 700 "$DEPLOY_ROOT" "$RELEASE_ROOT" "$STATE_ROOT" "$STATE_ROOT/deployment-evidence" "$HOME/.config/mira-staging"
ln -sfn "$(command -v node)" "$HOME/.local/bin/mira-staging-node"

previous_release=''
if [[ -L "$CURRENT_LINK" ]]; then
  previous_release="$(readlink -f "$CURRENT_LINK")"
fi

rollback_previous() {
  if [[ -n "$previous_release" && -d "$previous_release" ]]; then
    temporary_link="$DEPLOY_ROOT/.rollback-current-$$"
    ln -s "$previous_release" "$temporary_link"
    mv -Tf "$temporary_link" "$CURRENT_LINK"
    systemctl --user restart "$SERVICE_NAME" || true
    printf 'staging-deploy: restored previous release %s\n' "$previous_release" >&2
  else
    systemctl --user stop "$SERVICE_NAME" || true
    printf 'staging-deploy: no previous release existed; service stopped\n' >&2
  fi
}

rm -rf "$BUILD_DIR"
mkdir -p "$BUILD_DIR"

rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'app/dist/' \
  --exclude 'server/dist/' \
  --exclude 'logs/' \
  --exclude 'core/memory/' \
  "$SOURCE_DIR/" "$BUILD_DIR/"

cd "$BUILD_DIR"
HUSKY=0 npm install --ignore-scripts --legacy-peer-deps --no-audit --no-fund
npm rebuild better-sqlite3 --foreground-scripts
npm run build --workspace aurora
npm run build:app
npm run build:server

rm -rf "$BUILD_DIR/logs" "$BUILD_DIR/core/memory"
ln -s "$STATE_ROOT/logs" "$BUILD_DIR/logs"
ln -s "$STATE_ROOT/legacy-memory" "$BUILD_DIR/core/memory"
mkdir -p "$BUILD_DIR/server/dist/tmp"
chmod 700 "$BUILD_DIR/server/dist/tmp"

rm -rf "$RELEASE_DIR"
mv "$BUILD_DIR" "$RELEASE_DIR"
cp "$RELEASE_DIR/deploy/staging/mira-staging.service" "$HOME/.config/systemd/user/$SERVICE_NAME"
chmod 600 "$HOME/.config/systemd/user/$SERVICE_NAME"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME" >/dev/null

temporary_link="$DEPLOY_ROOT/.next-current-$$"
ln -s "$RELEASE_DIR" "$temporary_link"
mv -Tf "$temporary_link" "$CURRENT_LINK"

if ! systemctl --user restart "$SERVICE_NAME"; then
  rollback_previous
  fail 'systemd could not start the new release'
fi

if ! MIRA_DEPLOY_SHA="$RELEASE_SHA" \
  MIRA_STAGING_EVIDENCE_FILE="$EVIDENCE_FILE" \
  bash "$RELEASE_DIR/scripts/deploy/staging-smoke.sh" "$ENV_FILE" "$EVIDENCE_FILE"; then
  rollback_previous
  fail 'authenticated smoke verification failed; previous release restored'
fi

mapfile -t old_releases < <(
  find "$RELEASE_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr \
    | awk 'NR > 3 { sub(/^[^ ]+ /, ""); print }'
)
for old_release in "${old_releases[@]}"; do
  [[ "$old_release" != "$RELEASE_DIR" ]] || continue
  [[ "$old_release" != "$previous_release" ]] || continue
  rm -rf "$old_release"
done

printf 'staging-deploy: deployed %s; evidence=%s\n' "$RELEASE_SHA" "$EVIDENCE_FILE"
