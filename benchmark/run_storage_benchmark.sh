#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
WORKLOAD_PY="$SCRIPT_DIR/benchmark_workload.py"

LABEL=""
TARGET_DIR=""
IMAGE_DIR=""
MODEL_DIR=""
OUTPUT_DIR=""
PYTHON_BIN="python3"
RUNS=5
FIO_SIZE_GIB=8
FIO_SECONDS=60
IMAGE_COUNT=1000
REPLAY_SECONDS=120
SUSTAINED_SECONDS=1800
MEMORY_LIMIT_MIB=512
DROP_CACHES=true
REQUIRE_INFERENCE=true
KEEP_TEST_DATA=false
QUICK=false
NOTES=""

usage() {
  cat <<'EOF'
Usage:
  ./run_storage_benchmark.sh \
    --label uhs|sd-express \
    --target-dir /safe/path/express-derm-benchmark \
    --image-dir /path/to/demo_images \
    --model-dir /path/to/model-package \
    --output-dir /path/to/results \
    [options]

Required:
  --label NAME                 Card label used in result paths.
  --target-dir PATH            Dedicated test directory. Its basename must be
                               exactly "express-derm-benchmark".
  --image-dir PATH             Source clinical/demo images.
  --model-dir PATH             Versioned model package containing ONNX files.
  --output-dir PATH            Final result directory (active logs use RAM).

Options:
  --python PATH                Python with onnxruntime/numpy installed.
  --runs N                     Repetitions for fio/model/ingest (default: 5).
  --fio-size-gib N             Generated fio file size (default: 8).
  --fio-seconds N              Duration of each fio workload (default: 60).
  --image-count N              Images per ingest run (default: 1000).
  --replay-seconds N           Concurrent replay duration (default: 120).
  --sustained-seconds N        Sustained replay duration (default: 1800).
  --memory-limit-mib N         Maximum source images staged in RAM (default: 512).
  --notes TEXT                 Free-form configuration note in metadata.
  --quick                      Validation only: short, non-reportable run.
  --no-drop-caches             Skip Linux cold-cache preparation.
  --allow-storage-only         Continue if ONNX inference is unavailable.
  --keep-test-data             Keep generated test data on the target card.
  --help                       Show this help.

The script never runs fio against a raw /dev device. It creates a unique
session below the dedicated target directory and removes only that generated
session after a successful run unless --keep-test-data is supplied.
EOF
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

while (($#)); do
  case "$1" in
    --label) LABEL="${2:?missing value for --label}"; shift 2 ;;
    --target-dir) TARGET_DIR="${2:?missing value for --target-dir}"; shift 2 ;;
    --image-dir) IMAGE_DIR="${2:?missing value for --image-dir}"; shift 2 ;;
    --model-dir) MODEL_DIR="${2:?missing value for --model-dir}"; shift 2 ;;
    --output-dir) OUTPUT_DIR="${2:?missing value for --output-dir}"; shift 2 ;;
    --python) PYTHON_BIN="${2:?missing value for --python}"; shift 2 ;;
    --runs) RUNS="${2:?missing value for --runs}"; shift 2 ;;
    --fio-size-gib) FIO_SIZE_GIB="${2:?missing value for --fio-size-gib}"; shift 2 ;;
    --fio-seconds) FIO_SECONDS="${2:?missing value for --fio-seconds}"; shift 2 ;;
    --image-count) IMAGE_COUNT="${2:?missing value for --image-count}"; shift 2 ;;
    --replay-seconds) REPLAY_SECONDS="${2:?missing value for --replay-seconds}"; shift 2 ;;
    --sustained-seconds) SUSTAINED_SECONDS="${2:?missing value for --sustained-seconds}"; shift 2 ;;
    --memory-limit-mib) MEMORY_LIMIT_MIB="${2:?missing value for --memory-limit-mib}"; shift 2 ;;
    --notes) NOTES="${2:?missing value for --notes}"; shift 2 ;;
    --quick) QUICK=true; shift ;;
    --no-drop-caches) DROP_CACHES=false; shift ;;
    --allow-storage-only) REQUIRE_INFERENCE=false; shift ;;
    --keep-test-data) KEEP_TEST_DATA=true; shift ;;
    --help|-h) usage; exit 0 ;;
    *) fail "unknown argument: $1" ;;
  esac
done

[[ "$(uname -s)" == "Linux" ]] || fail "this benchmark must run on the Jetson Linux host"
(( EUID != 0 )) || fail "run as the normal user; the script invokes sudo only for cache preparation"
[[ -n "$LABEL" ]] || fail "--label is required"
[[ "$LABEL" =~ ^[a-zA-Z0-9._-]+$ ]] || fail "--label contains unsupported characters"
[[ -n "$TARGET_DIR" ]] || fail "--target-dir is required"
[[ -n "$IMAGE_DIR" ]] || fail "--image-dir is required"
[[ -n "$MODEL_DIR" ]] || fail "--model-dir is required"
[[ -n "$OUTPUT_DIR" ]] || fail "--output-dir is required"
[[ -f "$WORKLOAD_PY" ]] || fail "missing helper: $WORKLOAD_PY"
[[ -d "$IMAGE_DIR" ]] || fail "image directory does not exist: $IMAGE_DIR"
[[ -d "$MODEL_DIR" ]] || fail "model directory does not exist: $MODEL_DIR"
[[ "$(basename -- "$TARGET_DIR")" == "express-derm-benchmark" ]] || \
  fail "target directory basename must be express-derm-benchmark"

for value in "$RUNS" "$FIO_SIZE_GIB" "$FIO_SECONDS" "$IMAGE_COUNT" "$REPLAY_SECONDS" "$SUSTAINED_SECONDS" "$MEMORY_LIMIT_MIB"; do
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || fail "numeric options must be positive integers"
done

if [[ "$QUICK" == true ]]; then
  RUNS=2
  FIO_SIZE_GIB=1
  FIO_SECONDS=10
  IMAGE_COUNT=100
  REPLAY_SECONDS=20
  SUSTAINED_SECONDS=60
  NOTES="QUICK VALIDATION RUN; NOT SUITABLE FOR THE COMPETITION REPORT. $NOTES"
fi

for command_name in fio iostat findmnt lsblk df sync sha256sum; do
  command -v "$command_name" >/dev/null 2>&1 || fail "required command not found: $command_name"
done
[[ -x "$PYTHON_BIN" ]] || command -v "$PYTHON_BIN" >/dev/null 2>&1 || \
  fail "Python executable not found: $PYTHON_BIN"

mkdir -p -- "$TARGET_DIR" "$OUTPUT_DIR"
TARGET_DIR="$(cd -- "$TARGET_DIR" && pwd -P)"
IMAGE_DIR="$(cd -- "$IMAGE_DIR" && pwd -P)"
MODEL_DIR="$(cd -- "$MODEL_DIR" && pwd -P)"
OUTPUT_DIR="$(cd -- "$OUTPUT_DIR" && pwd -P)"

case "$TARGET_DIR" in
  /|/home|/mnt|/media|/opt|/usr|/var|/tmp) fail "unsafe target directory: $TARGET_DIR" ;;
esac

required_kib=$(( (FIO_SIZE_GIB + 3) * 1024 * 1024 ))
available_kib="$(df -Pk "$TARGET_DIR" | awk 'NR==2 {print $4}')"
[[ "$available_kib" =~ ^[0-9]+$ ]] || fail "unable to determine free space"
(( available_kib >= required_kib )) || \
  fail "target requires at least $((FIO_SIZE_GIB + 3)) GiB free"

if [[ "$DROP_CACHES" == true ]]; then
  command -v sudo >/dev/null 2>&1 || fail "sudo is required for cold-cache preparation"
  printf 'Authorising Linux cold-cache preparation with sudo...\n'
  sudo -v || fail "sudo authorisation failed"
  CACHE_PREPARATION="sync plus Linux drop_caches=3 before cold workloads"
else
  CACHE_PREPARATION="cache drop disabled; results must not be labelled cold-cache"
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
session_name="session-${LABEL}-${timestamp}"
target_session="$TARGET_DIR/$session_name"
final_result="$OUTPUT_DIR/${LABEL}-${timestamp}"
ram_root="$(mktemp -d "/dev/shm/express-derm-${LABEL}.XXXXXX")"
ram_result="$ram_root/results"
mkdir -p -- "$target_session" "$ram_result/fio" "$ram_result/model-load" \
  "$ram_result/ingest" "$ram_result/replay" "$ram_result/system"

iostat_pid=""
tegrastats_pid=""
completed=false

stop_monitors() {
  if [[ -n "$iostat_pid" ]]; then
    kill "$iostat_pid" 2>/dev/null || true
    wait "$iostat_pid" 2>/dev/null || true
    iostat_pid=""
  fi
  if [[ -n "$tegrastats_pid" ]]; then
    kill "$tegrastats_pid" 2>/dev/null || true
    wait "$tegrastats_pid" 2>/dev/null || true
    tegrastats_pid=""
  fi
}

on_exit() {
  stop_monitors
  if [[ "$completed" != true ]]; then
    printf 'Benchmark interrupted. Generated target data was left at:\n%s\n' "$target_session" >&2
    printf 'Active RAM logs, if still available, are at:\n%s\n' "$ram_root" >&2
  fi
}
trap on_exit EXIT INT TERM

drop_caches() {
  sync
  if [[ "$DROP_CACHES" == true ]]; then
    sudo sh -c 'echo 3 > /proc/sys/vm/drop_caches'
  fi
}

event() {
  printf '%s\t%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$ram_result/events.tsv"
}

target_mount="$(findmnt -T "$TARGET_DIR" -n -o SOURCE,TARGET,FSTYPE,OPTIONS | head -n 1)"
"$PYTHON_BIN" "$WORKLOAD_PY" metadata \
  --output "$ram_result/metadata.json" \
  --label "$LABEL" \
  --started-at "$started_at" \
  --target-dir "$TARGET_DIR" \
  --target-mount "$target_mount" \
  --image-dir "$IMAGE_DIR" \
  --model-dir "$MODEL_DIR" \
  --runs "$RUNS" \
  --fio-size-gib "$FIO_SIZE_GIB" \
  --fio-seconds "$FIO_SECONDS" \
  --image-count "$IMAGE_COUNT" \
  --replay-seconds "$REPLAY_SECONDS" \
  --sustained-seconds "$SUSTAINED_SECONDS" \
  --cache-preparation "$CACHE_PREPARATION" \
  --notes "$NOTES"

{
  printf 'date_utc=%s\n' "$started_at"
  printf 'label=%s\n' "$LABEL"
  printf 'target_mount=%s\n' "$target_mount"
  printf 'fio_version=%s\n' "$(fio --version)"
  printf 'python_version=%s\n' "$($PYTHON_BIN --version 2>&1)"
  printf 'kernel=%s\n' "$(uname -a)"
  printf 'quick=%s\n' "$QUICK"
} > "$ram_result/system/environment.txt"
lsblk -o NAME,MODEL,SERIAL,SIZE,TYPE,FSTYPE,MOUNTPOINTS,TRAN > "$ram_result/system/lsblk.txt" 2>&1 || true
findmnt > "$ram_result/system/findmnt.txt" 2>&1 || true
df -hT > "$ram_result/system/df-before.txt" 2>&1 || true
command -v lspci >/dev/null 2>&1 && lspci -nn > "$ram_result/system/lspci.txt" 2>&1 || true
command -v nvme >/dev/null 2>&1 && nvme list > "$ram_result/system/nvme-list.txt" 2>&1 || true
command -v nvpmodel >/dev/null 2>&1 && nvpmodel -q > "$ram_result/system/nvpmodel.txt" 2>&1 || true
command -v jetson_clocks >/dev/null 2>&1 && jetson_clocks --show > "$ram_result/system/jetson-clocks.txt" 2>&1 || true
[[ -f /etc/nv_tegra_release ]] && cp /etc/nv_tegra_release "$ram_result/system/nv_tegra_release.txt" || true

iostat -dx 1 > "$ram_result/system/iostat.log" 2>&1 &
iostat_pid=$!
if command -v tegrastats >/dev/null 2>&1; then
  tegrastats --interval 1000 > "$ram_result/system/tegrastats.log" 2>&1 &
  tegrastats_pid=$!
else
  printf 'tegrastats unavailable\n' > "$ram_result/system/tegrastats.log"
fi

model_target="$target_session/model-package"
mkdir -p -- "$model_target"
cp -a "$MODEL_DIR/." "$model_target/"
sync

fio_file="$target_session/fio-test.bin"
event "Preparing ${FIO_SIZE_GIB} GiB fio test file"
fio --name=prepare \
  --filename="$fio_file" \
  --rw=write --bs=1M --size="${FIO_SIZE_GIB}G" \
  --ioengine=libaio --iodepth=16 --direct=1 --end_fsync=1 \
  --group_reporting --output-format=json \
  --output="$ram_result/fio/prepare.json"

for run in $(seq 1 "$RUNS"); do
  run_id="$(printf '%02d' "$run")"

  event "Sequential read run $run of $RUNS"
  drop_caches
  fio --name=sequential-read \
    --filename="$fio_file" \
    --rw=read --bs=1M --size="${FIO_SIZE_GIB}G" \
    --ioengine=libaio --iodepth=32 --direct=1 \
    --runtime="$FIO_SECONDS" --time_based --group_reporting \
    --output-format=json+ --output="$ram_result/fio/sequential-read-${run_id}.json"

  event "4 KiB random read run $run of $RUNS"
  drop_caches
  fio --name=random-read-4k \
    --filename="$fio_file" \
    --rw=randread --bs=4k --size="${FIO_SIZE_GIB}G" \
    --ioengine=libaio --iodepth=32 --direct=1 \
    --runtime="$FIO_SECONDS" --time_based --group_reporting \
    --output-format=json+ --output="$ram_result/fio/random-read-4k-${run_id}.json"

  event "Model cold-load run $run of $RUNS"
  drop_caches
  model_args=(
    "$WORKLOAD_PY" model-load
    --model-dir "$model_target"
    --output "$ram_result/model-load/run-${run_id}.json"
  )
  [[ "$REQUIRE_INFERENCE" == true ]] && model_args+=(--require-inference)
  "$PYTHON_BIN" "${model_args[@]}"

  event "Image ingest run $run of $RUNS"
  drop_caches
  ingest_args=(
    "$WORKLOAD_PY" ingest
    --source-dir "$IMAGE_DIR"
    --destination "$target_session/ingest-run-${run_id}"
    --output "$ram_result/ingest/run-${run_id}.json"
    --count "$IMAGE_COUNT"
    --memory-limit-mib "$MEMORY_LIMIT_MIB"
  )
  [[ "$KEEP_TEST_DATA" == true ]] && ingest_args+=(--keep-data)
  "$PYTHON_BIN" "${ingest_args[@]}"
done

event "Concurrent ingest, inference and review replay"
drop_caches
replay_args=(
  "$WORKLOAD_PY" replay
  --source-dir "$IMAGE_DIR"
  --model-dir "$model_target"
  --destination "$target_session/replay-run-concurrent"
  --output "$ram_result/replay/concurrent.json"
  --duration-seconds "$REPLAY_SECONDS"
  --memory-limit-mib "$MEMORY_LIMIT_MIB"
)
[[ "$REQUIRE_INFERENCE" == true ]] && replay_args+=(--require-inference)
[[ "$KEEP_TEST_DATA" == true ]] && replay_args+=(--keep-data)
"$PYTHON_BIN" "${replay_args[@]}"

event "Sustained replay for $SUSTAINED_SECONDS seconds"
drop_caches
sustained_args=(
  "$WORKLOAD_PY" replay
  --source-dir "$IMAGE_DIR"
  --model-dir "$model_target"
  --destination "$target_session/replay-run-sustained"
  --output "$ram_result/replay/sustained.json"
  --duration-seconds "$SUSTAINED_SECONDS"
  --memory-limit-mib "$MEMORY_LIMIT_MIB"
)
[[ "$REQUIRE_INFERENCE" == true ]] && sustained_args+=(--require-inference)
[[ "$KEEP_TEST_DATA" == true ]] && sustained_args+=(--keep-data)
"$PYTHON_BIN" "${sustained_args[@]}"

event "Benchmark measurements complete"
stop_monitors
df -hT > "$ram_result/system/df-after.txt" 2>&1 || true

mkdir -p -- "$final_result"
cp -a "$ram_result/." "$final_result/"
"$PYTHON_BIN" "$WORKLOAD_PY" hash-tree \
  --root "$final_result" \
  --output "$final_result/SHA256SUMS"

if [[ "$KEEP_TEST_DATA" != true ]]; then
  "$PYTHON_BIN" "$WORKLOAD_PY" cleanup --path "$target_session" --parent "$TARGET_DIR"
else
  printf 'Generated target data retained at: %s\n' "$target_session"
fi

completed=true
trap - EXIT INT TERM
rm -rf -- "$ram_root"

printf '\nBenchmark complete. Result directory:\n%s\n' "$final_result"
printf 'Run the comparison tool after both card scenarios are complete.\n'
