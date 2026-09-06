#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$ROOT_DIR/frontend"
LOCK_FILE="$FRONTEND_DIR/package-lock.json"
NODE_MODULES="$FRONTEND_DIR/node_modules"
HOST_SYSTEM="$(uname -s)"

if [[ "$HOST_SYSTEM" == "Darwin" ]]; then
  DEPENDENCY_ROOT="$FRONTEND_DIR/.express-derm-deps.nosync"
  ACTIVE_NODE_MODULES="$DEPENDENCY_ROOT/node_modules"
  EXPECTED_LINK=".express-derm-deps.nosync/node_modules"
else
  DEPENDENCY_ROOT="$FRONTEND_DIR"
  ACTIVE_NODE_MODULES="$NODE_MODULES"
  EXPECTED_LINK=""
fi
STAMP_FILE="$ACTIVE_NODE_MODULES/.express-derm-package-lock.cksum"

if ! command -v npm >/dev/null 2>&1; then
  printf 'npm is required to prepare the frontend dependencies.\n' >&2
  exit 1
fi

if [[ ! -f "$LOCK_FILE" ]]; then
  printf 'Frontend lock file is missing: %s\n' "$LOCK_FILE" >&2
  exit 1
fi

lock_signature="$(cksum "$LOCK_FILE")"
install_required=false
install_reason=""

if [[ ! -x "$ACTIVE_NODE_MODULES/.bin/vite" ]]; then
  install_required=true
  install_reason="dependencies are missing"
elif [[ ! -f "$STAMP_FILE" ]] || [[ "$(<"$STAMP_FILE")" != "$lock_signature" ]]; then
  install_required=true
  install_reason="package-lock.json changed"
elif [[ "$HOST_SYSTEM" == "Darwin" ]] && \
  [[ -n "$(find "$ACTIVE_NODE_MODULES" -flags +dataless -print -quit 2>/dev/null)" ]]; then
  install_required=true
  install_reason="macOS offloaded dependency files"
fi

if [[ "$install_required" == true ]]; then
  printf 'Preparing frontend dependencies (%s)...\n' "$install_reason"
  if [[ "$HOST_SYSTEM" == "Darwin" ]]; then
    mkdir -p "$DEPENDENCY_ROOT"
    cp "$FRONTEND_DIR/package.json" "$LOCK_FILE" "$DEPENDENCY_ROOT/"
  fi
  (
    cd "$DEPENDENCY_ROOT"
    npm ci --prefer-offline --no-audit --no-fund
  )
  lock_signature="$(cksum "$LOCK_FILE")"
  printf '%s\n' "$lock_signature" >"$STAMP_FILE"
fi

if [[ "$HOST_SYSTEM" == "Darwin" ]]; then
  current_link=""
  if [[ -L "$NODE_MODULES" ]]; then
    current_link="$(readlink "$NODE_MODULES")"
  fi
  if [[ "$current_link" != "$EXPECTED_LINK" ]]; then
    if [[ -e "$NODE_MODULES" || -L "$NODE_MODULES" ]]; then
      rm -rf "$NODE_MODULES"
    fi
    ln -s "$EXPECTED_LINK" "$NODE_MODULES"
  fi
fi

if [[ ! -x "$NODE_MODULES/.bin/vite" ]]; then
  printf 'Frontend dependency preparation did not produce Vite.\n' >&2
  exit 1
fi
