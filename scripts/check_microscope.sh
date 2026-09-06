#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_URL="${BACKEND_URL:-http://127.0.0.1:8000}"
OPEN_PROBE="${CHECK_MICROSCOPE_OPEN_PROBE:-false}"
PYTHON_BIN="${PYTHON:-${BACKEND_PYTHON:-python3}}"
if ! PYTHON_BIN="$(command -v "${PYTHON_BIN}" 2>/dev/null)"; then
  PYTHON_BIN=""
fi

echo "== OS and USB devices =="
uname -a || true
lsusb || true

echo
if command -v v4l2-ctl >/dev/null 2>&1; then
  echo "== V4L2 root devices =="
  v4l2-ctl --list-devices || true
else
  echo "v4l2-ctl not found: install v4l-utils to inspect camera nodes."
fi

echo
echo "== Discovered /dev video candidate nodes =="
if [[ -d /dev ]]; then
  find /dev -maxdepth 4 \( -path '/dev/video*' -o -path '/dev/v4l/by-id/*' -o -path '/dev/v4l/by-path/*' \) 2>/dev/null | sort || true
else
  echo "/dev not available."
fi

echo
echo "== Group membership / permissions =="
if command -v id >/dev/null 2>&1; then
  echo "Current groups: $(id -nG)"
  if command -v grep >/dev/null 2>&1 && ! id -nG | grep -qw video; then
    echo "WARNING: user is not in 'video' group; camera access can fail."
    echo "If needed: adduser <you> video and relogin."
  fi
fi

echo
echo "== Device permissions and metadata =="
for DEVICE in /dev/video* /dev/v4l/by-id/* /dev/v4l/by-path/*; do
  [[ -e "${DEVICE}" ]] || continue
  echo
  echo "------------------------------------------------------------"
  echo "DEVICE: ${DEVICE}"
  ls -l "${DEVICE}" || true
  if command -v stat >/dev/null 2>&1; then
    if command -v stat --help >/dev/null 2>&1; then
      stat -c "owner=%U:%G mode=%a" "${DEVICE}" 2>/dev/null || true
    else
      stat "${DEVICE}" || true
    fi
  fi
  if command -v v4l2-ctl >/dev/null 2>&1; then
    echo "-- v4l2 --all"
    v4l2-ctl --all -d "${DEVICE}" || true
    echo "-- v4l2 --list-formats-ext"
    v4l2-ctl --list-formats-ext -d "${DEVICE}" || true
  fi
  echo
done

echo
echo "== Backend camera discovery API =="
if command -v curl >/dev/null 2>&1; then
  curl -sS "${BACKEND_URL}/api/camera/devices" | sed -e 's/,"/,\n"/g' || true
else
  echo "curl non trovato; installa curl per testare /api/camera/devices"
fi

echo
if [[ "$OPEN_PROBE" == true ]]; then
  echo
  echo "== Backend camera openability probe =="
  if [[ -n "${PYTHON_BIN}" ]]; then
    PYTHONPATH="${ROOT_DIR}/backend" "${PYTHON_BIN}" - <<'PY'
from app.camera import CameraStream, list_devices

devices = list_devices()
if not devices:
    print("No camera candidates discovered on this host.")
for device in devices:
    path = device["path"]
    stream = CameraStream(device=path)
    stream.start()
    stream.stop()
    if stream.error:
        print(f"{path}: {stream.error}")
    else:
        print(f"{path}: open OK")
PY
  else
    echo "Nessun interprete Python con le dipendenze richieste trovato per il probe"
  fi
else
  echo "Backend camera openability probe disabled. Set CHECK_MICROSCOPE_OPEN_PROBE=true to run."
fi

echo
echo "Save this output. Select the microscope device and verify:"
echo "- native resolution and frame rate"
echo "- MJPEG/YUYV formats"
echo "- exposure, white balance and gain controls"
echo "- camera node path and file permissions"
