#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_DIR_RAW="${EXPRESS_DERM_PYTHON_ENV_DIR:-$ROOT_DIR/.runtime/python}"
BOOTSTRAP_PYTHON_RAW="${EXPRESS_DERM_BOOTSTRAP_PYTHON:-python3}"
TARGET_PYTHON_RAW="${EXPRESS_DERM_TARGET_PYTHON:-$ENV_DIR_RAW/bin/python}"
PIP_INSTALL_FLAGS_RAW="${EXPRESS_DERM_PIP_INSTALL_FLAGS:---disable-pip-version-check}"

resolve_project_path() {
  local value="$1"
  if [[ "$value" = /* ]]; then
    printf '%s\n' "$value"
  else
    printf '%s\n' "$ROOT_DIR/$value"
  fi
}

resolve_command() {
  local value="$1"
  if [[ "$value" == */* ]]; then
    resolve_project_path "$value"
  else
    command -v "$value" 2>/dev/null || true
  fi
}

ENV_DIR="$(resolve_project_path "$ENV_DIR_RAW")"
MANAGED_PYTHON="$ENV_DIR/bin/python"
TARGET_PYTHON="$(resolve_command "$TARGET_PYTHON_RAW")"
BOOTSTRAP_PYTHON="$(resolve_command "$BOOTSTRAP_PYTHON_RAW")"

if [[ -z "$BOOTSTRAP_PYTHON" || ! -x "$BOOTSTRAP_PYTHON" ]]; then
  printf 'Python 3.11 or newer is required to prepare the application.\n' >&2
  exit 1
fi

managed_environment=false
if [[ "$TARGET_PYTHON" == "$MANAGED_PYTHON" ]]; then
  managed_environment=true
fi

if [[ ! -x "$TARGET_PYTHON" ]]; then
  if [[ "$managed_environment" != true ]]; then
    printf 'Configured Python interpreter is not executable: %s\n' "$TARGET_PYTHON_RAW" >&2
    exit 1
  fi

  printf 'Creating the managed Python environment...\n'
  mkdir -p "$(dirname "$ENV_DIR")"
  if ! "$BOOTSTRAP_PYTHON" -m venv "$ENV_DIR"; then
    printf 'Could not create the managed Python environment.\n' >&2
    printf 'On Debian or Ubuntu install support with: sudo apt install python3-venv\n' >&2
    printf 'Then run make start again.\n' >&2
    exit 1
  fi
fi

if ! "$TARGET_PYTHON" -c 'import sys; raise SystemExit(sys.version_info < (3, 11))'; then
  printf 'Express-Derm requires Python 3.11 or newer: %s\n' "$TARGET_PYTHON" >&2
  exit 1
fi

REQUIREMENT_FILES=(
  requirements.txt
  backend/requirements.txt
  backend/requirements-dev.txt
  backend/requirements-ai.txt
)

for requirement_file in "${REQUIREMENT_FILES[@]}"; do
  if [[ ! -f "$ROOT_DIR/$requirement_file" ]]; then
    printf 'Python requirements file is missing: %s\n' "$requirement_file" >&2
    exit 1
  fi
done

requirements_signature="$({
  cd "$ROOT_DIR"
  "$TARGET_PYTHON" - "${REQUIREMENT_FILES[@]}" <<'PY'
import hashlib
from pathlib import Path
import sys

digest = hashlib.sha256()
for filename in sys.argv[1:]:
    digest.update(filename.encode("utf-8"))
    digest.update(b"\0")
    digest.update(Path(filename).read_bytes())
    digest.update(b"\0")
print(digest.hexdigest())
PY
})"

install_required=true
MARKER_FILE="$ENV_DIR/.express-derm-requirements.sha256"
if [[ "$managed_environment" == true && -f "$MARKER_FILE" ]]; then
  installed_signature="$(<"$MARKER_FILE")"
  if [[ "$installed_signature" == "$requirements_signature" ]] && \
    "$TARGET_PYTHON" -c 'import alembic, cv2, fastapi, numpy, onnxruntime, sqlalchemy, uvicorn' >/dev/null 2>&1; then
    install_required=false
  fi
fi

if [[ "$install_required" == true ]]; then
  printf 'Preparing Python dependencies from requirements.txt...\n'
  read -r -a pip_install_flags <<<"$PIP_INSTALL_FLAGS_RAW"
  "$TARGET_PYTHON" -m pip install "${pip_install_flags[@]}" -r "$ROOT_DIR/requirements.txt"
  if [[ "$managed_environment" == true ]]; then
    printf '%s\n' "$requirements_signature" >"$MARKER_FILE"
  fi
else
  printf 'Python dependencies are ready.\n'
fi

if ! "$TARGET_PYTHON" -c 'import alembic, cv2, fastapi, numpy, onnxruntime, sqlalchemy, uvicorn' >/dev/null 2>&1; then
  printf 'Python dependency verification failed after installation.\n' >&2
  printf 'Do not use sudo pip or --break-system-packages.\n' >&2
  exit 1
fi
