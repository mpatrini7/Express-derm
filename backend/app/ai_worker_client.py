from __future__ import annotations

import json
import math
import socket
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .decision_policy import RUNTIME_ATTENTION_LEVELS


IPC_VERSION = 1
INFERENCE_BACKEND = "tensorrt_cpp"
MAX_MESSAGE_BYTES = 1024 * 1024
EXPECTED_WORKER_VERSION = "express-derm-tensorrt-worker/0.2.0"
WORKER_DECISION_POLICY_VERSION = "binary-extremes-v1"
SocketFactory = Callable[[int, int], socket.socket]


class WorkerUnavailableError(RuntimeError):
    pass


class WorkerProtocolError(RuntimeError):
    pass


class WorkerRejectedError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.retryable = retryable


@dataclass(frozen=True)
class ExpectedModel:
    version: str
    release_version: str
    model_sha256: str
    engine_sha256: str
    deployment_status: str
    validation_status: str
    domain_status: str
    thresholds_validated: bool

    @classmethod
    def from_manifest(cls, manifest: dict[str, Any]) -> ExpectedModel:
        version = _required_text(manifest, "version")
        return cls(
            version=version,
            release_version=(
                _optional_text(manifest, "release_version") or version
            ),
            model_sha256=_required_sha256(manifest, "model_sha256"),
            engine_sha256=_required_sha256(manifest, "engine_sha256"),
            deployment_status=_required_text(
                manifest,
                "deployment_status",
            ),
            validation_status=_required_text(
                manifest,
                "validation_status",
            ),
            domain_status=_required_text(manifest, "domain_status"),
            thresholds_validated=_required_bool(
                manifest,
                "thresholds_validated",
            ),
        )

    def as_payload(self) -> dict[str, Any]:
        return {
            "model_version": self.version,
            "model_release": self.release_version,
            "model_sha256": self.model_sha256,
            "engine_sha256": self.engine_sha256,
            "deployment_status": self.deployment_status,
            "validation_status": self.validation_status,
            "domain_status": self.domain_status,
            "thresholds_validated": self.thresholds_validated,
        }


@dataclass(frozen=True)
class WorkerStatus:
    ready: bool
    worker_version: str
    decision_policy_version: str
    model_version: str | None
    model_release: str | None
    model_sha256: str | None
    engine_sha256: str | None
    deployment_status: str | None
    validation_status: str | None
    domain_status: str | None
    reason: str | None


@dataclass(frozen=True)
class WorkerPrediction:
    model_version: str
    model_release: str
    model_sha256: str
    engine_sha256: str
    deployment_status: str
    raw_output: float
    score: float
    attention_level: str
    abstained: bool
    abstention_reason: str | None
    validation_status: str
    domain_status: str
    thresholds_validated: bool
    latency_ms: float
    payload: dict[str, Any]


class TensorRTWorkerClient:
    def __init__(
        self,
        socket_path: Path,
        *,
        timeout_seconds: float,
        max_message_bytes: int = MAX_MESSAGE_BYTES,
        socket_factory: SocketFactory = socket.socket,
    ) -> None:
        if timeout_seconds <= 0 or not math.isfinite(timeout_seconds):
            raise ValueError("Worker timeout must be a positive number")
        if max_message_bytes <= 0:
            raise ValueError("Worker message limit must be positive")
        self.socket_path = socket_path
        self.timeout_seconds = timeout_seconds
        self.max_message_bytes = max_message_bytes
        self._socket_factory = socket_factory

    def status(self, expected_model: ExpectedModel) -> WorkerStatus:
        result = self._request(
            "status",
            {"expected_model": expected_model.as_payload()},
        )
        ready = _required_bool(result, "ready")
        status = WorkerStatus(
            ready=ready,
            worker_version=_required_text(result, "worker_version"),
            decision_policy_version=_required_text(
                result,
                "decision_policy_version",
            ),
            model_version=_optional_text(result, "model_version"),
            model_release=_optional_text(result, "model_release"),
            model_sha256=_optional_text(result, "model_sha256"),
            engine_sha256=_optional_text(result, "engine_sha256"),
            deployment_status=_optional_text(
                result,
                "deployment_status",
            ),
            validation_status=_optional_text(
                result,
                "validation_status",
            ),
            domain_status=_optional_text(result, "domain_status"),
            reason=_optional_text(result, "reason"),
        )
        if status.worker_version != EXPECTED_WORKER_VERSION:
            raise WorkerProtocolError(
                "Worker version does not implement the configured decision "
                "policy"
            )
        if status.decision_policy_version != WORKER_DECISION_POLICY_VERSION:
            raise WorkerProtocolError(
                "Worker decision policy does not match the backend"
            )
        if ready:
            self._verify_identity(
                expected_model,
                model_version=status.model_version,
                model_release=status.model_release,
                model_sha256=status.model_sha256,
                engine_sha256=status.engine_sha256,
                deployment_status=status.deployment_status,
                validation_status=status.validation_status,
                domain_status=status.domain_status,
                thresholds_validated=_required_bool(
                    result,
                    "thresholds_validated",
                ),
            )
        elif status.reason is None:
            raise WorkerProtocolError(
                "Unready worker response must include a reason"
            )
        return status

    def predict(
        self,
        *,
        image_path: Path,
        observation_id: int,
        quality_status: str,
        microscope_source_confirmed: bool,
        acquisition_protocol_status: str,
        expected_model: ExpectedModel,
    ) -> WorkerPrediction:
        if observation_id <= 0:
            raise ValueError("Observation ID must be positive")
        if quality_status != "accepted":
            raise ValueError(
                "Only quality-accepted microscope images can reach inference"
            )
        if microscope_source_confirmed is not True:
            raise ValueError(
                "Only source-confirmed microscope images can reach inference"
            )
        if not acquisition_protocol_status.strip():
            raise ValueError("Acquisition protocol status cannot be blank")

        try:
            resolved_image_path = image_path.resolve(strict=True)
        except OSError as exc:
            raise WorkerRejectedError(
                "IMAGE_PATH_REJECTED",
                f"Microscope image is unavailable: {exc}",
                False,
            ) from exc
        result = self._request(
            "predict",
            {
                "expected_model": expected_model.as_payload(),
                "input": {
                    "observation_id": observation_id,
                    "image_path": str(resolved_image_path),
                    "quality_status": quality_status,
                    "microscope_source_confirmed": (
                        microscope_source_confirmed
                    ),
                    # IPC v1 worker 0.1.0 required this legacy eligibility
                    # token. The authoritative recorded status is preserved
                    # separately and no longer gates experimental inference.
                    "acquisition_protocol_status": "validated",
                    "recorded_acquisition_protocol_status": (
                        acquisition_protocol_status
                    ),
                },
            },
        )

        backend = _required_text(result, "inference_backend")
        if backend != INFERENCE_BACKEND:
            raise WorkerProtocolError(
                f"Worker returned unsupported inference backend: {backend}"
            )
        self._verify_identity(
            expected_model,
            model_version=_required_text(result, "model_version"),
            model_release=_required_text(result, "model_release"),
            model_sha256=_required_text(result, "model_sha256"),
            engine_sha256=_required_text(result, "engine_sha256"),
            deployment_status=_required_text(
                result,
                "deployment_status",
            ),
            validation_status=_required_text(
                result,
                "validation_status",
            ),
            domain_status=_required_text(result, "domain_status"),
            thresholds_validated=_required_bool(
                result,
                "thresholds_validated",
            ),
        )

        raw_output = _required_number(result, "raw_output")
        score = _bounded_number(result, "score")
        legacy_confidence = _optional_bounded_number(result, "confidence")
        attention_level = _required_text(result, "attention_level")
        if attention_level not in RUNTIME_ATTENTION_LEVELS:
            raise WorkerProtocolError(
                f"Worker returned unknown attention level: {attention_level}"
            )
        if (
            _required_text(result, "decision_policy_version")
            != WORKER_DECISION_POLICY_VERSION
        ):
            raise WorkerProtocolError(
                "Worker prediction used an incompatible decision policy"
            )
        abstained = _required_bool(result, "abstained")
        abstention_reason = _optional_text(result, "abstention_reason")
        if abstained and abstention_reason is None:
            raise WorkerProtocolError(
                "Worker omitted the reason for an abstained result"
            )
        if not abstained and abstention_reason is not None:
            raise WorkerProtocolError(
                "Worker returned an abstention reason without abstaining"
            )
        if (attention_level == "uncertain") is not abstained:
            raise WorkerProtocolError(
                "Worker attention level and abstention state disagree"
            )
        latency_ms = _required_number(result, "latency_ms")
        if latency_ms < 0:
            raise WorkerProtocolError("Worker latency cannot be negative")
        for timing_key in ("preprocessing_ms", "inference_ms"):
            if _required_number(result, timing_key) < 0:
                raise WorkerProtocolError(
                    f"Worker field {timing_key} cannot be negative"
                )

        payload = dict(result)
        payload["ipc_version"] = IPC_VERSION
        payload.pop("confidence", None)
        if legacy_confidence is not None:
            payload["legacy_worker_confidence"] = legacy_confidence
        return WorkerPrediction(
            model_version=expected_model.version,
            model_release=expected_model.release_version,
            model_sha256=expected_model.model_sha256,
            engine_sha256=expected_model.engine_sha256,
            deployment_status=expected_model.deployment_status,
            raw_output=raw_output,
            score=score,
            attention_level=attention_level,
            abstained=abstained,
            abstention_reason=abstention_reason,
            validation_status=expected_model.validation_status,
            domain_status=expected_model.domain_status,
            thresholds_validated=expected_model.thresholds_validated,
            latency_ms=latency_ms,
            payload=payload,
        )

    def _request(
        self,
        operation: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        request_id = uuid.uuid4().hex
        request = {
            "ipc_version": IPC_VERSION,
            "request_id": request_id,
            "operation": operation,
            **payload,
        }
        encoded = (
            json.dumps(request, separators=(",", ":"), sort_keys=True).encode(
                "utf-8"
            )
            + b"\n"
        )
        if len(encoded) > self.max_message_bytes:
            raise WorkerProtocolError("Worker request exceeds the message limit")

        try:
            with self._socket_factory(
                socket.AF_UNIX,
                socket.SOCK_STREAM,
            ) as connection:
                connection.settimeout(self.timeout_seconds)
                connection.connect(str(self.socket_path))
                connection.sendall(encoded)
                response_bytes = _read_message(
                    connection,
                    self.max_message_bytes,
                )
        except (OSError, TimeoutError) as exc:
            raise WorkerUnavailableError(
                f"TensorRT C++ worker unavailable at {self.socket_path}: {exc}"
            ) from exc

        try:
            response = json.loads(response_bytes)
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise WorkerProtocolError(
                "TensorRT C++ worker returned invalid JSON"
            ) from exc
        if not isinstance(response, dict):
            raise WorkerProtocolError("Worker response must be a JSON object")
        if response.get("ipc_version") != IPC_VERSION:
            raise WorkerProtocolError("Worker IPC version mismatch")
        if response.get("request_id") != request_id:
            raise WorkerProtocolError("Worker response request ID mismatch")
        if type(response.get("ok")) is not bool:
            raise WorkerProtocolError("Worker response has no boolean ok field")
        if response["ok"] is False:
            error = response.get("error")
            if not isinstance(error, dict):
                raise WorkerProtocolError(
                    "Worker error response has no error object"
                )
            raise WorkerRejectedError(
                code=_required_text(error, "code"),
                message=_required_text(error, "message"),
                retryable=_required_bool(error, "retryable"),
            )
        result = response.get("result")
        if not isinstance(result, dict):
            raise WorkerProtocolError(
                "Successful worker response has no result object"
            )
        return result

    @staticmethod
    def _verify_identity(
        expected: ExpectedModel,
        *,
        model_version: str | None,
        model_release: str | None,
        model_sha256: str | None,
        engine_sha256: str | None,
        deployment_status: str | None,
        validation_status: str | None,
        domain_status: str | None,
        thresholds_validated: bool,
    ) -> None:
        actual = (
            model_version,
            model_release,
            model_sha256,
            engine_sha256,
            deployment_status,
            validation_status,
            domain_status,
            thresholds_validated,
        )
        wanted = (
            expected.version,
            expected.release_version,
            expected.model_sha256,
            expected.engine_sha256,
            expected.deployment_status,
            expected.validation_status,
            expected.domain_status,
            expected.thresholds_validated,
        )
        if actual != wanted:
            raise WorkerProtocolError(
                "TensorRT worker model identity does not match the local "
                "manifest"
            )


def _read_message(connection: socket.socket, limit: int) -> bytes:
    message = bytearray()
    while True:
        chunk = connection.recv(min(65536, limit + 1 - len(message)))
        if not chunk:
            raise WorkerProtocolError(
                "TensorRT C++ worker closed without a complete response"
            )
        message.extend(chunk)
        newline_at = message.find(b"\n")
        if newline_at >= 0:
            return bytes(message[:newline_at])
        if len(message) > limit:
            raise WorkerProtocolError(
                "TensorRT C++ worker response exceeds the message limit"
            )


def _required_text(container: dict[str, Any], key: str) -> str:
    value = container.get(key)
    if not isinstance(value, str) or not value.strip():
        raise WorkerProtocolError(f"Field {key} must be non-empty text")
    return value


def _optional_text(container: dict[str, Any], key: str) -> str | None:
    value = container.get(key)
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise WorkerProtocolError(f"Field {key} must be text or null")
    return value


def _required_bool(container: dict[str, Any], key: str) -> bool:
    value = container.get(key)
    if type(value) is not bool:
        raise WorkerProtocolError(f"Field {key} must be boolean")
    return value


def _required_number(container: dict[str, Any], key: str) -> float:
    value = container.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise WorkerProtocolError(f"Field {key} must be numeric")
    parsed = float(value)
    if not math.isfinite(parsed):
        raise WorkerProtocolError(f"Field {key} must be finite")
    return parsed


def _bounded_number(container: dict[str, Any], key: str) -> float:
    value = _required_number(container, key)
    if not 0 <= value <= 1:
        raise WorkerProtocolError(f"Field {key} must be between 0 and 1")
    return value


def _optional_bounded_number(
    container: dict[str, Any],
    key: str,
) -> float | None:
    if container.get(key) is None:
        return None
    return _bounded_number(container, key)


def _required_sha256(container: dict[str, Any], key: str) -> str:
    value = _required_text(container, key)
    if len(value) != 64 or any(
        character not in "0123456789abcdef" for character in value
    ):
        raise WorkerProtocolError(f"Manifest field {key} must be a SHA-256 hash")
    return value
