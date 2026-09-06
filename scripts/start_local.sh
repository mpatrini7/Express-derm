#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${1:-}" == "--no-ai" ]]; then
  shift
  export EXPRESS_DERM_AI_ENABLED=false
fi
if [[ "${1:-}" == "--research-ai" ]]; then
  shift
  export EXPRESS_DERM_AI_ENABLED=true
  export EXPRESS_DERM_AI_ALLOW_UNVALIDATED_MODEL=true
  export EXPRESS_DERM_AI_BACKEND=onnxruntime
fi
if [[ "$#" -gt 0 ]]; then
  printf 'Usage: %s [--no-ai] [--research-ai]\n' "$0" >&2
  printf 'Note: use start_project.sh directly for full control.\n' >&2
  exit 2
fi

printf 'start_local.sh is deprecated. Use scripts/start_project.sh directly.\n'
exec "$SCRIPT_DIR/start_project.sh"
