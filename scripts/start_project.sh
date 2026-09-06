#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

START_PROJECT_PROFILE="${START_PROJECT_PROFILE:-default}"
START_PROJECT_ENV_FILE="${START_PROJECT_ENV_FILE:-}"

if [[ "$START_PROJECT_PROFILE" == "scan" && -z "$START_PROJECT_ENV_FILE" ]]; then
  START_PROJECT_ENV_FILE="$ROOT_DIR/scripts/scanner.env"
fi

if [[ -n "$START_PROJECT_ENV_FILE" ]]; then
  if [[ -f "$START_PROJECT_ENV_FILE" ]]; then
    :
  elif [[ -f "$ROOT_DIR/$START_PROJECT_ENV_FILE" ]]; then
    START_PROJECT_ENV_FILE="$ROOT_DIR/$START_PROJECT_ENV_FILE"
  else
    printf 'START_PROJECT_ENV_FILE not found: %s\n' "$START_PROJECT_ENV_FILE" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  set -a
  source "$START_PROJECT_ENV_FILE"
  set +a
fi

LOG_DIR="${LOCAL_LOG_DIR:-${TMPDIR:-/tmp}/express-derm-bodymap-project}"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
MODEL_DIR_RAW="${EXPRESS_DERM_AI_MODEL_DIR:-$ROOT_DIR/models/express-derm-1}"
VITE_FORCE="${START_PROJECT_VITE_FORCE:-true}"
CLEAN_VITE_CACHE="${START_PROJECT_CLEAN_VITE_CACHE:-false}"
RESTART_FRONTEND="${START_PROJECT_RESTART_FRONTEND:-false}"
FOLLOW_UP_POLICY_VERSION="dual-center-scale-confirmation-v1"

AI_ENABLED="${EXPRESS_DERM_AI_ENABLED:-true}"
AI_BACKEND="${EXPRESS_DERM_AI_BACKEND:-onnxruntime}"
AI_ALLOW_UNVALIDATED="${EXPRESS_DERM_AI_ALLOW_UNVALIDATED_MODEL:-true}"
AI_REQUIRED="${EXPRESS_DERM_AI_REQUIRED:-true}"
DATA_DIR_RAW="${EXPRESS_DERM_DATA_DIR:-./data}"
WORKER_BINARY_RAW="${EXPRESS_DERM_AI_WORKER_BINARY:-cpp/ai_worker/build/express-derm-ai-worker}"
WORKER_SOCKET_RAW="${EXPRESS_DERM_AI_WORKER_SOCKET:-./data/express-derm-ai.sock}"

BACKEND_URL="http://$BACKEND_HOST:${BACKEND_PORT}"
FRONTEND_URL="http://$FRONTEND_HOST:${FRONTEND_PORT}/"

resolve_python_path() {
  local candidate="${1:-python3}"

  if [[ "$candidate" = /* ]]; then
    echo "$candidate"
    return
  fi
  if [[ "$candidate" == */* && -x "$ROOT_DIR/backend/$candidate" ]]; then
    echo "$ROOT_DIR/backend/$candidate"
  elif [[ "$candidate" == */* && -x "$ROOT_DIR/$candidate" ]]; then
    echo "$ROOT_DIR/$candidate"
  else
    command -v "$candidate"
  fi
}

resolve_path_in_project() {
  local value="$1"
  if [[ "$value" = /* ]]; then
    echo "$value"
  else
    echo "$ROOT_DIR/$value"
  fi
}

resolve_path_in_backend() {
  local value="$1"
  if [[ "$value" = /* ]]; then
    echo "$value"
  else
    echo "$ROOT_DIR/backend/$value"
  fi
}

curl_local() {
  curl --noproxy '*' --max-time 2 "$@"
}

wait_for_url() {
  local url="$1"
  local attempts=120
  local attempt=1
  while [[ "$attempt" -le "$attempts" ]]; do
    if curl_local -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
    attempt=$((attempt + 1))
  done
  return 1
}

assert_python_path() {
  if [[ ! -x "$1" ]]; then
    printf 'Backend python not found or not executable: %s\n' "$1" >&2
    printf 'Set BACKEND_PYTHON to a working interpreter.\n' >&2
    exit 1
  fi
}

assert_frontend_tools() {
  "$ROOT_DIR/scripts/ensure_frontend_dependencies.sh"
  local vite="$ROOT_DIR/frontend/node_modules/.bin/vite"
  if [[ ! -x "$vite" ]]; then
    printf 'Frontend dependencies missing: %s\n' "$vite" >&2
    printf 'Dependency preparation did not complete successfully.\n' >&2
    exit 1
  fi
  FRONTEND_BIN="$vite"
}

assert_frontend_is_express() {
  local probe_url="$1"
  if ! curl_local -fsS "$probe_url" 2>/dev/null | grep -q '<title>Express-Derm</title>'; then
    return 1
  fi
}

kill_frontend_port() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 1
  fi
  local pids
  pids="$(lsof -t -iTCP:"$FRONTEND_PORT" -sTCP:LISTEN 2>/dev/null | tr '\n' ' ')"
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    return 0
  fi
  return 1
}

assert_model_package() {
  local model_dir="$1"
  local verify_arguments=(--model-dir "$model_dir")
  if [[ "$AI_BACKEND" == "tensorrt_cpp" ]]; then
    verify_arguments+=(--require-engine)
  fi
  if ! "$PYTHON_PATH" "$ROOT_DIR/scripts/verify_ai_model_package.py" "${verify_arguments[@]}"; then
    printf 'AI model package verification failed. Restore the immutable package before starting AI.\n' >&2
    exit 1
  fi
}

print_python_setup_help() {
  printf 'Run make start from the project root.\n' >&2
  printf 'Make will create an isolated Python environment and install requirements.txt.\n' >&2
  printf 'Do not use sudo pip or --break-system-packages.\n' >&2
}

assert_backend_dependencies() {
  if ! "$PYTHON_PATH" -c 'import alembic, cv2, fastapi, numpy, sqlalchemy, uvicorn' >/dev/null 2>&1; then
    printf 'Backend Python dependencies are not available in %s.\n' "$PYTHON_PATH" >&2
    print_python_setup_help
    exit 1
  fi
}

assert_onnxruntime() {
  if ! "$PYTHON_PATH" -c 'import onnxruntime' >/dev/null 2>&1; then
    printf 'onnxruntime is not available in %s.\n' "$PYTHON_PATH" >&2
    print_python_setup_help
    exit 1
  fi
}

wait_for_socket() {
  local socket_path="$1"
  local worker_pid="$2"
  local attempts=120
  local attempt=1
  while [[ "$attempt" -le "$attempts" ]]; do
    if [[ -S "$socket_path" ]]; then
      return 0
    fi
    if ! kill -0 "$worker_pid" 2>/dev/null; then
      return 1
    fi
    sleep 0.25
    attempt=$((attempt + 1))
  done
  return 1
}

backend_ready_and_ai_ready() {
  if ! backend_policy_is_current; then
    return 1
  fi
  if [[ "$AI_ENABLED" != true ]]; then
    return 0
  fi
  local status
  status="$(curl_local -fsS "$BACKEND_URL/api/ai/status" 2>/dev/null || true)"
  [[ "$status" == *'"ready":true'* ]]
}

backend_policy_is_current() {
  local health
  health="$(curl_local -fsS "$BACKEND_URL/api/health" 2>/dev/null || true)"
  [[ "$health" == *"\"follow_up_policy_version\":\"$FOLLOW_UP_POLICY_VERSION\""* ]]
}

cleanup() {
  trap - EXIT INT TERM
  if [[ "$backend_started" == true && -n "${backend_pid:-}" ]]; then
    kill "$backend_pid" 2>/dev/null || true
  fi
  if [[ "$frontend_started" == true && -n "${frontend_pid:-}" ]]; then
    kill "$frontend_pid" 2>/dev/null || true
  fi
  if [[ "$worker_started" == true && -n "${worker_pid:-}" ]]; then
    kill "$worker_pid" 2>/dev/null || true
  fi
  wait 2>/dev/null || true
}

trap cleanup EXIT
trap 'exit 130' INT TERM

mkdir -p "$LOG_DIR"
backend_log="$LOG_DIR/backend.log"
frontend_log="$LOG_DIR/frontend.log"
worker_log="$LOG_DIR/cpp-worker.log"
backend_pid=""
frontend_pid=""
worker_pid=""
backend_started=false
frontend_started=false
worker_started=false

PYTHON_PATH="$(resolve_python_path "${BACKEND_PYTHON:-python3}")" || {
  printf 'Could not find the configured Python interpreter.\n' >&2
  printf 'Install Python dependencies from requirements.txt before startup.\n' >&2
  exit 1
}
assert_python_path "$PYTHON_PATH"
assert_backend_dependencies

assert_frontend_tools

MODEL_DIR="$(resolve_path_in_project "$MODEL_DIR_RAW")"
DATA_DIR="$(resolve_path_in_backend "$DATA_DIR_RAW")"
WORKER_SOCKET="$(resolve_path_in_backend "$WORKER_SOCKET_RAW")"
WORKER_BINARY="$(resolve_path_in_project "$WORKER_BINARY_RAW")"
if [[ "$AI_ENABLED" == true ]]; then
  assert_model_package "$MODEL_DIR"
fi

if [[ "$AI_ENABLED" == true && "$AI_BACKEND" == "onnxruntime" ]]; then
  assert_onnxruntime
fi
if [[ "$AI_ENABLED" == true && "$AI_BACKEND" == "tensorrt_cpp" && ! -x "$WORKER_BINARY" ]]; then
  printf 'TensorRT C++ worker is missing or not executable: %s\n' "$WORKER_BINARY" >&2
  printf 'Build it on the target Linux system with: ./scripts/build_cpp_ai_worker.sh\n' >&2
  exit 1
fi

if backend_ready_and_ai_ready; then
  printf 'Reusing backend already running at %s/api/health\n' "$BACKEND_URL"
else
  if curl_local -fsS "$BACKEND_URL/api/health" >/dev/null 2>&1; then
    if ! backend_policy_is_current; then
      printf 'Backend already running on %s uses an outdated follow-up policy.\n' "$BACKEND_URL" >&2
      printf 'Stop the existing project process, then run make again.\n' >&2
      exit 1
    fi
    if [[ "$AI_ENABLED" == true && "$AI_REQUIRED" == true ]]; then
      printf 'Backend is already running on %s but AI is not ready.\n' "$BACKEND_URL" >&2
      printf 'Stop that process or rerun with EXPRESS_DERM_AI_ENABLED=false.\n' >&2
      exit 1
    fi
    printf 'Reusing existing backend at %s (AI disabled in this run)\n' "$BACKEND_URL"
  else
    if [[ "$AI_ENABLED" == true && "$AI_BACKEND" == "tensorrt_cpp" ]]; then
      mkdir -p "$DATA_DIR/images"
      "$WORKER_BINARY" \
        --model-dir "$MODEL_DIR" \
        --image-root "$DATA_DIR/images" \
        --socket "$WORKER_SOCKET" \
        >"$worker_log" 2>&1 &
      worker_pid=$!
      worker_started=true
      if ! wait_for_socket "$WORKER_SOCKET" "$worker_pid"; then
        printf 'TensorRT C++ worker did not become ready. See %s\n' "$worker_log" >&2
        tail -n 160 "$worker_log" >&2
        exit 1
      fi
      printf 'TensorRT C++ worker started at %s\n' "$WORKER_SOCKET"
    fi
    (
      cd "$ROOT_DIR/backend"
      exec env \
        EXPRESS_DERM_AI_ENABLED="$AI_ENABLED" \
        EXPRESS_DERM_AI_ALLOW_UNVALIDATED_MODEL="$AI_ALLOW_UNVALIDATED" \
        EXPRESS_DERM_AI_BACKEND="$AI_BACKEND" \
        EXPRESS_DERM_AI_MODEL_DIR="$MODEL_DIR" \
        EXPRESS_DERM_AI_WORKER_SOCKET="$WORKER_SOCKET" \
        "$PYTHON_PATH" -m uvicorn app.main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT"
    ) >"$backend_log" 2>&1 &
    backend_pid=$!
    backend_started=true
    if ! wait_for_url "$BACKEND_URL/api/health"; then
      printf 'Backend did not become ready. See %s\n' "$backend_log" >&2
      tail -n 120 "$backend_log" >&2
      exit 1
    fi
    if [[ "$AI_ENABLED" == true && "$AI_REQUIRED" == true ]]; then
      if ! curl_local -fsS "$BACKEND_URL/api/ai/status" 2>/dev/null | grep -q '"ready":true'; then
        printf 'Backend is running but AI is still not ready. See %s\n' "$backend_log" >&2
        tail -n 160 "$backend_log" >&2
        exit 1
      fi
    fi
    printf 'Backend started at %s\n' "$BACKEND_URL"
  fi
fi

if curl_local -fsS "$FRONTEND_URL" >/dev/null 2>&1; then
  if assert_frontend_is_express "$FRONTEND_URL"; then
    printf 'Reusing frontend already running at %s\n' "$FRONTEND_URL"
  elif [[ "$RESTART_FRONTEND" == true ]]; then
    kill_frontend_port
    sleep 0.3
  else
    printf 'A different service is already running at %s.\n' "$FRONTEND_URL" >&2
    printf 'Set START_PROJECT_RESTART_FRONTEND=true to restart frontend automatically, or stop the service manually.\n' >&2
    exit 1
  fi
fi

if ! curl_local -fsS "$FRONTEND_URL" >/dev/null 2>&1; then
  (
    cd "$ROOT_DIR/frontend"
    if [[ "$CLEAN_VITE_CACHE" == true ]]; then
      rm -rf .vite
    fi
    [[ "$VITE_FORCE" == true ]] && VITE_FORCE_ARGS=(--force) || VITE_FORCE_ARGS=()
    exec "$FRONTEND_BIN" "${VITE_FORCE_ARGS[@]}" --host "$FRONTEND_HOST" --port "$FRONTEND_PORT" --strictPort
  ) >"$frontend_log" 2>&1 &
  frontend_pid=$!
  frontend_started=true
  if ! wait_for_url "$FRONTEND_URL"; then
    printf 'Frontend did not become ready. See %s\n' "$frontend_log" >&2
    tail -n 160 "$frontend_log" >&2
    exit 1
  fi
  if ! assert_frontend_is_express "$FRONTEND_URL"; then
    printf 'Frontend started but returned a non-Express-Derm page. See %s\n' "$frontend_log" >&2
    tail -n 200 "$frontend_log" >&2
    exit 1
  fi
  printf 'Frontend started at %s\n' "$FRONTEND_URL"
fi

printf '========================================================\n'
printf 'Express-Derm READY for local microscope test\n'
if [[ "$START_PROJECT_PROFILE" == "scan" ]]; then
  if [[ -n "$START_PROJECT_ENV_FILE" ]]; then
    printf 'ENV preset: %s\n' "$START_PROJECT_ENV_FILE"
  else
    printf 'ENV preset: <inline overrides>\n'
  fi
fi
printf 'Backend : %s/api/health\n' "$BACKEND_URL"
printf 'Frontend: %s\n' "$FRONTEND_URL"
printf 'AI      : enabled=%s backend=%s model_dir=%s\n' "$AI_ENABLED" "$AI_BACKEND" "$MODEL_DIR"
printf 'Logs    : %s\n' "$LOG_DIR"
if [[ "$backend_started" == true ]]; then
  printf 'Backend PID: %s\n' "$backend_pid"
fi
if [[ "$frontend_started" == true ]]; then
  printf 'Frontend PID: %s\n' "$frontend_pid"
fi
if [[ "$worker_started" == true ]]; then
  printf 'C++ worker PID: %s\n' "$worker_pid"
fi
printf '========================================================\n'
printf 'Press Ctrl+C to stop services started by this script.\n'

while :; do
  if [[ "$backend_started" == true ]] && ! kill -0 "$backend_pid" 2>/dev/null; then
    printf 'Backend stopped unexpectedly.\n' >&2
    exit 1
  fi
  if [[ "$frontend_started" == true ]] && ! kill -0 "$frontend_pid" 2>/dev/null; then
    printf 'Frontend stopped unexpectedly.\n' >&2
    exit 1
  fi
  if [[ "$worker_started" == true ]] && ! kill -0 "$worker_pid" 2>/dev/null; then
    printf 'TensorRT C++ worker stopped unexpectedly. See %s\n' "$worker_log" >&2
    exit 1
  fi
  sleep 1
done
