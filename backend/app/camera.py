from __future__ import annotations

import glob
import os
import re
import shutil
import subprocess
import threading
import time
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from .config import settings

MOCK_DEVICE_PATH = "mock://microscope"
MOCK_MODES = [
    {
        "pixel_format": "MJPG",
        "width": 1280,
        "height": 720,
        "fps": [30.0],
    },
    {
        "pixel_format": "MJPG",
        "width": 640,
        "height": 480,
        "fps": [30.0],
    },
]

FORMAT_PATTERN = re.compile(r"\[\d+\]:\s+'([^']+)'")
SIZE_PATTERN = re.compile(r"Size:\s+Discrete\s+(\d+)x(\d+)")
FPS_PATTERN = re.compile(r"\(([\d.]+)\s+fps\)")


def _video_candidates() -> list[str]:
    candidates = set(glob.glob("/dev/video*"))
    candidates.update(glob.glob("/dev/v4l/by-id/*"))
    candidates.update(glob.glob("/dev/v4l/by-path/*"))
    return sorted(candidates)


@dataclass
class SharedFrame:
    image: np.ndarray | None = None
    timestamp: float = 0.0
    sequence: int = -1


def parse_v4l2_modes(output: str) -> list[dict[str, object]]:
    modes: list[dict[str, object]] = []
    pixel_format: str | None = None
    current: dict[str, object] | None = None

    def flush() -> None:
        nonlocal current
        if current is not None:
            modes.append(current)
            current = None

    for line in output.splitlines():
        format_match = FORMAT_PATTERN.search(line)
        if format_match:
            flush()
            pixel_format = format_match.group(1)
            continue

        size_match = SIZE_PATTERN.search(line)
        if size_match and pixel_format:
            flush()
            current = {
                "pixel_format": pixel_format,
                "width": int(size_match.group(1)),
                "height": int(size_match.group(2)),
                "fps": [],
            }
            continue

        fps_match = FPS_PATTERN.search(line)
        if fps_match and current is not None:
            fps = round(float(fps_match.group(1)), 3)
            values = current["fps"]
            if isinstance(values, list) and fps not in values:
                values.append(fps)

    flush()
    return modes


def _device_modes(path: str) -> list[dict[str, object]]:
    command = shutil.which("v4l2-ctl")
    if command is None:
        return []
    try:
        result = subprocess.run(
            [command, "--list-formats-ext", "-d", path],
            check=False,
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError):
        return []
    if result.returncode != 0:
        return []
    return parse_v4l2_modes(result.stdout)


def _device_name(path: str) -> str:
    name_path = Path("/sys/class/video4linux") / Path(path).name / "name"
    try:
        name = name_path.read_text(encoding="utf-8").strip()
    except OSError:
        try:
            name = Path(path).name
        except OSError:
            name = path
    return name or path


def list_devices() -> list[dict[str, object]]:
    devices: list[dict[str, object]] = []
    if settings.camera_mock:
        devices.append(
            {
                "path": MOCK_DEVICE_PATH,
                "name": "Development microscope",
                "is_mock": True,
                "modes": MOCK_MODES,
            },
        )

    seen: set[str] = set()
    for path in _video_candidates():
        resolved = ""
        try:
            resolved = str(Path(path).resolve())
        except OSError:
            resolved = path
        if resolved in seen:
            continue
        seen.add(resolved)
        devices.append(
            {
                "path": path,
                "name": _device_name(path),
                "is_mock": False,
                "modes": _device_modes(path),
            },
        )
    return devices


def is_supported_device(device: str) -> bool:
    if device == MOCK_DEVICE_PATH:
        return settings.camera_mock
    return device in _video_candidates()


def device_name(device: str) -> str:
    if device == MOCK_DEVICE_PATH:
        return "Development microscope"
    return _device_name(device)


class CameraStream:
    def __init__(
        self,
        device: str,
        width: int | None = None,
        height: int | None = None,
        pixel_format: str | None = None,
        frame_rate: float | None = None,
    ):
        self.device = device
        self.width = width
        self.height = height
        self.pixel_format = pixel_format
        self.frame_rate = frame_rate
        self.frame = SharedFrame()
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.thread: threading.Thread | None = None
        self.error: str | None = None
        self._mock_base: np.ndarray | None = None

    @property
    def is_mock(self) -> bool:
        return self.device == MOCK_DEVICE_PATH

    def start(self) -> None:
        if self.is_mock or (self.thread and self.thread.is_alive()):
            return
        self.stop_event.clear()
        self.error = None
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        if not os.path.exists(self.device):
            self.error = f"Camera not found: {self.device}"
            return
        capture = cv2.VideoCapture(self.device, cv2.CAP_V4L2)
        if not capture.isOpened():
            capture.release()
            capture = cv2.VideoCapture(self.device)
            if not capture.isOpened():
                if not os.access(self.device, os.R_OK | os.W_OK):
                    self.error = (
                        f"Unable to open {self.device} (permission denied)"
                    )
                else:
                    self.error = f"Unable to open {self.device}"
                return

        if self.pixel_format and len(self.pixel_format) == 4:
            capture.set(
                cv2.CAP_PROP_FOURCC,
                cv2.VideoWriter_fourcc(*self.pixel_format),
            )
        if self.width:
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, self.width)
        if self.height:
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, self.height)
        if self.frame_rate:
            capture.set(cv2.CAP_PROP_FPS, self.frame_rate)

        try:
            while not self.stop_event.is_set():
                ok, image = capture.read()
                if not ok:
                    self.error = f"Unable to read from {self.device}"
                    time.sleep(0.1)
                    continue
                with self.lock:
                    self.frame = SharedFrame(
                        image=image,
                        timestamp=time.time(),
                        sequence=self.frame.sequence + 1,
                    )
                    self.error = None
        finally:
            capture.release()

    def _make_mock_frame(self) -> SharedFrame:
        width = self.width or 1280
        height = self.height or 720
        if (
            self._mock_base is None
            or self._mock_base.shape[:2] != (height, width)
        ):
            base = np.full((height, width, 3), (132, 142, 138), dtype=np.uint8)
            grid_step = max(24, min(width, height) // 12)
            for x in range(0, width, grid_step):
                cv2.line(base, (x, 0), (x, height), (105, 116, 112), 1)
            for y in range(0, height, grid_step):
                cv2.line(base, (0, y), (width, y), (105, 116, 112), 1)
            center = (width // 2, height // 2)
            radius = max(24, min(width, height) // 7)
            cv2.circle(base, center, radius, (55, 72, 67), 4)
            cv2.circle(base, center, radius // 2, (196, 205, 201), 3)
            cv2.putText(
                base,
                "DEVELOPMENT CAMERA",
                (max(12, width // 24), max(36, height // 12)),
                cv2.FONT_HERSHEY_SIMPLEX,
                max(0.55, min(width, height) / 900),
                (38, 57, 52),
                2,
                cv2.LINE_AA,
            )
            self._mock_base = base

        image = self._mock_base.copy()
        with self.lock:
            sequence = self.frame.sequence + 1
        offset = sequence % max(1, image.shape[1] // 3)
        cv2.line(
            image,
            (image.shape[1] // 3 + offset, 0),
            (image.shape[1] // 3 + offset, image.shape[0]),
            (68, 144, 112),
            3,
        )
        frame = SharedFrame(image=image, timestamp=time.time(), sequence=sequence)
        with self.lock:
            self.frame = frame
            self.error = None
        return SharedFrame(
            image=image.copy(),
            timestamp=frame.timestamp,
            sequence=sequence,
        )

    def get_frame(self) -> SharedFrame:
        if self.is_mock:
            return self._make_mock_frame()
        self.start()
        with self.lock:
            return SharedFrame(
                image=None if self.frame.image is None else self.frame.image.copy(),
                timestamp=self.frame.timestamp,
                sequence=self.frame.sequence,
            )

    def wait_for_frame(
        self,
        timeout: float,
        after_sequence: int = -1,
    ) -> SharedFrame | None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            frame = self.get_frame()
            if frame.image is not None and frame.sequence > after_sequence:
                return frame
            if (
                not self.is_mock
                and self.error
                and self.thread is not None
                and not self.thread.is_alive()
            ):
                return None
            time.sleep(0.02)
        return None

    def get(self) -> np.ndarray | None:
        return self.get_frame().image

    def stop(self) -> None:
        self.stop_event.set()
        if (
            self.thread
            and self.thread.is_alive()
            and self.thread is not threading.current_thread()
        ):
            self.thread.join(timeout=1)


class CameraManager:
    def __init__(self):
        self.streams: dict[
            tuple[str, int | None, int | None, str | None, float | None],
            CameraStream,
        ] = {}
        self.lock = threading.Lock()

    def get_stream(
        self,
        device: str,
        width: int | None = None,
        height: int | None = None,
        pixel_format: str | None = None,
        frame_rate: float | None = None,
    ) -> CameraStream:
        key = (device, width, height, pixel_format, frame_rate)
        with self.lock:
            if key not in self.streams:
                self.streams[key] = CameraStream(
                    device,
                    width=width,
                    height=height,
                    pixel_format=pixel_format,
                    frame_rate=frame_rate,
                )
            return self.streams[key]

    def stop_all(self) -> None:
        with self.lock:
            streams = list(self.streams.values())
            self.streams.clear()
        for stream in streams:
            stream.stop()


camera_manager = CameraManager()
