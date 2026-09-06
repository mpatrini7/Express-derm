from __future__ import annotations

import json
import socket
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

import numpy as np
import pytest

import app.ai_service as ai_service_module
from app.ai_service import AIService
from app.ai_worker_client import (
    EXPECTED_WORKER_VERSION,
    WORKER_DECISION_POLICY_VERSION,
    ExpectedModel,
    TensorRTWorkerClient,
    WorkerProtocolError,
    WorkerRejectedError,
)
from app.config import settings
from app.decision_policy import DECISION_POLICY_VERSION


MODEL_HASH = "a" * 64
ENGINE_HASH = "b" * 64
EXPECTED_MODEL = ExpectedModel(
    version="test-model-v1",
    release_version="test-model-v1.0.0",
    model_sha256=MODEL_HASH,
    engine_sha256=ENGINE_HASH,
    deployment_status="validated",
    validation_status="validated",
    domain_status="microscope_validated",
    thresholds_validated=True,
)


def status_result(**overrides: Any) -> dict[str, Any]:
    result = {
        "ready": True,
        "worker_version": EXPECTED_WORKER_VERSION,
        "decision_policy_version": WORKER_DECISION_POLICY_VERSION,
        "model_version": EXPECTED_MODEL.version,
        "model_release": EXPECTED_MODEL.release_version,
        "model_sha256": MODEL_HASH,
        "engine_sha256": ENGINE_HASH,
        "deployment_status": EXPECTED_MODEL.deployment_status,
        "validation_status": EXPECTED_MODEL.validation_status,
        "domain_status": EXPECTED_MODEL.domain_status,
        "thresholds_validated": True,
        "reason": None,
    }
    result.update(overrides)
    return result


def prediction_result(**overrides: Any) -> dict[str, Any]:
    result = {
        "model_version": EXPECTED_MODEL.version,
        "model_release": EXPECTED_MODEL.release_version,
        "model_sha256": MODEL_HASH,
        "engine_sha256": ENGINE_HASH,
        "deployment_status": EXPECTED_MODEL.deployment_status,
        "inference_backend": "tensorrt_cpp",
        "raw_output": 1.27,
        "score": 0.73,
        "confidence": 0.46,
        "attention_level": "high",
        "abstained": False,
        "abstention_reason": None,
        "decision_policy_version": WORKER_DECISION_POLICY_VERSION,
        "validation_status": EXPECTED_MODEL.validation_status,
        "domain_status": EXPECTED_MODEL.domain_status,
        "thresholds_validated": True,
        "preprocessing_ms": 4.1,
        "inference_ms": 8.7,
        "latency_ms": 13.2,
    }
    result.update(overrides)
    return result


Responder = Callable[[dict[str, Any]], dict[str, Any] | bytes]


class ConnectedSocket:
    def __init__(self, worker: FakeWorker) -> None:
        self.worker = worker
        self.response = b""
        self.offset = 0

    def __enter__(self) -> ConnectedSocket:
        return self

    def __exit__(self, *args: object) -> None:
        del args

    def settimeout(self, timeout: float) -> None:
        assert timeout > 0

    def connect(self, socket_path: str) -> None:
        del socket_path

    def sendall(self, payload: bytes) -> None:
        request = json.loads(payload.partition(b"\n")[0])
        self.worker.requests.append(request)
        response = self.worker.responder(request)
        if isinstance(response, bytes):
            self.response = response
        else:
            self.response = json.dumps(response).encode("utf-8") + b"\n"

    def recv(self, size: int) -> bytes:
        chunk = self.response[self.offset : self.offset + size]
        self.offset += len(chunk)
        return chunk


class FakeWorker:
    def __init__(self, responder: Responder) -> None:
        self.responder = responder
        self.requests: list[dict[str, Any]] = []

    def socket_factory(
        self,
        family: int,
        socket_type: int,
    ) -> ConnectedSocket:
        assert family == socket.AF_UNIX
        assert socket_type == socket.SOCK_STREAM
        return ConnectedSocket(self)


@contextmanager
def fake_worker(responder: Responder) -> Iterator[FakeWorker]:
    worker = FakeWorker(responder)
    yield worker


def success_response(
    request: dict[str, Any],
    result: dict[str, Any],
) -> dict[str, Any]:
    return {
        "ipc_version": 1,
        "request_id": request["request_id"],
        "ok": True,
        "result": result,
    }


def test_status_round_trip_uses_versioned_model_identity() -> None:
    with fake_worker(
        lambda request: success_response(request, status_result()),
    ) as worker:
        status = TensorRTWorkerClient(
            Path("/unused/test-worker.sock"),
            timeout_seconds=1,
            socket_factory=worker.socket_factory,
        ).status(EXPECTED_MODEL)

    assert status.ready is True
    assert status.decision_policy_version == WORKER_DECISION_POLICY_VERSION
    assert status.model_version == EXPECTED_MODEL.version
    assert worker.requests == [
        {
            "ipc_version": 1,
            "request_id": worker.requests[0]["request_id"],
            "operation": "status",
            "expected_model": EXPECTED_MODEL.as_payload(),
        }
    ]


def test_status_rejects_the_retired_three_zone_worker() -> None:
    with fake_worker(
        lambda request: success_response(
            request,
            status_result(
                worker_version="express-derm-tensorrt-worker/0.1.0",
            ),
        ),
    ) as worker:
        with pytest.raises(WorkerProtocolError, match="decision policy"):
            TensorRTWorkerClient(
                Path("/unused/test-worker.sock"),
                timeout_seconds=1,
                socket_factory=worker.socket_factory,
            ).status(EXPECTED_MODEL)


@pytest.mark.parametrize(
    ("quality_status", "source_confirmed", "protocol_status"),
    [
        ("rejected", True, "validated"),
        ("accepted", False, "validated"),
    ],
)
def test_predict_rejects_ineligible_input_before_connecting(
    tmp_path: Path,
    quality_status: str,
    source_confirmed: bool,
    protocol_status: str,
) -> None:
    client = TensorRTWorkerClient(
        tmp_path / "missing.sock",
        timeout_seconds=1,
    )

    with pytest.raises(ValueError):
        client.predict(
            image_path=tmp_path / "missing.png",
            observation_id=1,
            quality_status=quality_status,
            microscope_source_confirmed=source_confirmed,
            acquisition_protocol_status=protocol_status,
            expected_model=EXPECTED_MODEL,
        )


def test_predict_returns_a_fully_auditable_cpp_result(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "microscope.png"
    image_path.write_bytes(b"source-confirmed test image")

    with fake_worker(
        lambda request: success_response(request, prediction_result()),
    ) as worker:
        prediction = TensorRTWorkerClient(
            Path("/unused/test-worker.sock"),
            timeout_seconds=1,
            socket_factory=worker.socket_factory,
        ).predict(
            image_path=image_path,
            observation_id=42,
            quality_status="accepted",
            microscope_source_confirmed=True,
            acquisition_protocol_status="incomplete",
            expected_model=EXPECTED_MODEL,
        )

    assert prediction.model_version == EXPECTED_MODEL.version
    assert prediction.model_release == EXPECTED_MODEL.release_version
    assert prediction.model_sha256 == MODEL_HASH
    assert prediction.engine_sha256 == ENGINE_HASH
    assert prediction.raw_output == 1.27
    assert prediction.score == 0.73
    assert prediction.payload["inference_backend"] == "tensorrt_cpp"
    assert prediction.payload["ipc_version"] == 1
    assert "confidence" not in prediction.payload
    assert prediction.payload["legacy_worker_confidence"] == 0.46
    assert worker.requests[0]["operation"] == "predict"
    assert worker.requests[0]["input"] == {
        "observation_id": 42,
        "image_path": str(image_path.resolve()),
        "quality_status": "accepted",
        "microscope_source_confirmed": True,
        "acquisition_protocol_status": "validated",
        "recorded_acquisition_protocol_status": "incomplete",
    }


def test_predict_accepts_worker_result_without_confidence(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "microscope.png"
    image_path.write_bytes(b"source-confirmed test image")

    with fake_worker(
        lambda request: success_response(
            request,
            prediction_result(confidence=None),
        ),
    ) as worker:
        prediction = TensorRTWorkerClient(
            Path("/unused/test-worker.sock"),
            timeout_seconds=1,
            socket_factory=worker.socket_factory,
        ).predict(
            image_path=image_path,
            observation_id=42,
            quality_status="accepted",
            microscope_source_confirmed=True,
            acquisition_protocol_status="incomplete",
            expected_model=EXPECTED_MODEL,
        )

    assert "confidence" not in prediction.payload
    assert "legacy_worker_confidence" not in prediction.payload


def test_predict_rejects_worker_model_identity_mismatch(
    tmp_path: Path,
) -> None:
    image_path = tmp_path / "microscope.png"
    image_path.write_bytes(b"source-confirmed test image")

    with fake_worker(
        lambda request: success_response(
            request,
            prediction_result(engine_sha256="c" * 64),
        ),
    ) as worker:
        with pytest.raises(
            WorkerProtocolError,
            match="does not match",
        ):
            TensorRTWorkerClient(
                Path("/unused/test-worker.sock"),
                timeout_seconds=1,
                socket_factory=worker.socket_factory,
            ).predict(
                image_path=image_path,
                observation_id=42,
                quality_status="accepted",
                microscope_source_confirmed=True,
                acquisition_protocol_status="validated",
                expected_model=EXPECTED_MODEL,
            )


def test_worker_error_preserves_code_and_retryability() -> None:
    def reject(request: dict[str, Any]) -> dict[str, Any]:
        return {
            "ipc_version": 1,
            "request_id": request["request_id"],
            "ok": False,
            "error": {
                "code": "MODEL_NOT_READY",
                "message": "TensorRT engine is not ready",
                "retryable": True,
            },
        }

    with fake_worker(reject) as worker:
        with pytest.raises(WorkerRejectedError) as error:
            TensorRTWorkerClient(
                Path("/unused/test-worker.sock"),
                timeout_seconds=1,
                socket_factory=worker.socket_factory,
            ).status(EXPECTED_MODEL)

    assert error.value.code == "MODEL_NOT_READY"
    assert error.value.retryable is True


def test_status_rejects_a_mismatched_response_request_id() -> None:
    def mismatch(request: dict[str, Any]) -> dict[str, Any]:
        response = success_response(request, status_result())
        response["request_id"] = "0" * 32
        return response

    with fake_worker(mismatch) as worker:
        with pytest.raises(
            WorkerProtocolError,
            match="request ID mismatch",
        ):
            TensorRTWorkerClient(
                Path("/unused/test-worker.sock"),
                timeout_seconds=1,
                socket_factory=worker.socket_factory,
            ).status(EXPECTED_MODEL)


def test_status_rejects_an_unready_worker_without_a_reason() -> None:
    with fake_worker(
        lambda request: success_response(
            request,
            status_result(
                ready=False,
                model_version=None,
                model_sha256=None,
                engine_sha256=None,
                validation_status=None,
                domain_status=None,
                reason=None,
            ),
        ),
    ) as worker:
        with pytest.raises(
            WorkerProtocolError,
            match="must include a reason",
        ):
            TensorRTWorkerClient(
                Path("/unused/test-worker.sock"),
                timeout_seconds=1,
                socket_factory=worker.socket_factory,
            ).status(EXPECTED_MODEL)


def test_cpp_backend_requires_an_explicit_engine_hash(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": EXPECTED_MODEL.version,
                "release_version": EXPECTED_MODEL.release_version,
                "model_sha256": MODEL_HASH,
                "validation_status": EXPECTED_MODEL.validation_status,
                "domain_status": EXPECTED_MODEL.domain_status,
                "thresholds_validated": True,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_backend", "tensorrt_cpp")
    monkeypatch.setattr(settings, "ai_model_dir", model_dir)

    status = AIService().status()

    assert status["ready"] is False
    assert "engine_sha256" in status["reason"]


def test_cpp_backend_rejects_registration_only_without_override(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": EXPECTED_MODEL.version,
                "release_version": EXPECTED_MODEL.release_version,
                "model_sha256": MODEL_HASH,
                "engine_sha256": ENGINE_HASH,
                "deployment_status": "engine_registered",
                "validation_status": EXPECTED_MODEL.validation_status,
                "domain_status": EXPECTED_MODEL.domain_status,
                "thresholds_validated": True,
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_backend", "tensorrt_cpp")
    monkeypatch.setattr(settings, "ai_model_dir", model_dir)
    monkeypatch.setattr(settings, "ai_allow_unvalidated_model", False)

    status = AIService().status()

    assert status["ready"] is False
    assert "deployment is not validated" in status["reason"]


def test_ai_service_uses_persistent_cpp_worker_contract(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    model_dir = tmp_path / "model"
    model_dir.mkdir()
    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": EXPECTED_MODEL.version,
                "release_version": EXPECTED_MODEL.release_version,
                "model_sha256": MODEL_HASH,
                "engine_sha256": ENGINE_HASH,
                "deployment_status": EXPECTED_MODEL.deployment_status,
                "validation_status": EXPECTED_MODEL.validation_status,
                "domain_status": EXPECTED_MODEL.domain_status,
                "thresholds_validated": True,
            }
        ),
        encoding="utf-8",
    )
    image_path = tmp_path / "microscope.png"
    image_path.write_bytes(b"source-confirmed test image")

    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "ai_backend", "tensorrt_cpp")
    monkeypatch.setattr(settings, "ai_model_dir", model_dir)
    monkeypatch.setattr(
        settings,
        "ai_worker_socket",
        Path("/unused/test-worker.sock"),
    )
    monkeypatch.setattr(settings, "ai_worker_timeout_seconds", 1)

    def respond(request: dict[str, Any]) -> dict[str, Any]:
        result = (
            status_result()
            if request["operation"] == "status"
            else prediction_result()
        )
        return success_response(request, result)

    with fake_worker(respond) as worker:
        real_client = TensorRTWorkerClient(
            Path("/unused/test-worker.sock"),
            timeout_seconds=1,
            socket_factory=worker.socket_factory,
        )
        monkeypatch.setattr(
            ai_service_module,
            "TensorRTWorkerClient",
            lambda *args, **kwargs: real_client,
        )
        service = AIService()
        status = service.status()
        prediction = service.predict(
            image_path,
            observation_id=42,
            quality_status="accepted",
            microscope_source_confirmed=True,
            acquisition_protocol_status="validated",
        )

    assert status["ready"] is True
    assert status["backend"] == "tensorrt_cpp"
    assert prediction.backend == "tensorrt_cpp"
    assert prediction.model_hash == MODEL_HASH
    assert prediction.payload["engine_sha256"] == ENGINE_HASH
    assert [request["operation"] for request in worker.requests] == [
        "status",
        "predict",
    ]


def test_onnx_adapter_applies_affine_logistic_calibration(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSession:
        def run(self, output_names, inputs):
            assert output_names == ["logit"]
            assert inputs["image"].shape == (1, 3, 16, 16)
            return [np.asarray([[2.0]], dtype=np.float32)]

    image_path = tmp_path / "observation.png"
    image = np.full((24, 24, 3), 127, dtype=np.uint8)
    assert ai_service_module.cv2.imwrite(str(image_path), image)
    monkeypatch.setattr(settings, "ai_backend", "onnxruntime")
    service = AIService()
    service._session = FakeSession()
    service._manifest = {
        "version": "affine-test-v1",
        "release_version": "affine-test-v1",
        "model_sha256": MODEL_HASH,
        "image_size": 16,
        "mean": [0.485, 0.456, 0.406],
        "std": [0.229, 0.224, 0.225],
        "input_name": "image",
        "output_name": "logit",
        "calibration_method": "affine_logistic_scaling",
        "logit_scale": 0.5,
        "logit_bias": -1.0,
        "low_threshold": 0.2,
        "high_threshold": 0.8,
        "validation_status": "research_only",
        "domain_status": "microscope_validation_pending",
    }

    prediction = service.predict(
        image_path,
        observation_id=1,
        quality_status="accepted",
        microscope_source_confirmed=True,
        acquisition_protocol_status="validated",
    )

    assert prediction.score == pytest.approx(0.5)
    assert prediction.attention_level == "uncertain"
    assert prediction.abstained is True
    assert prediction.payload["decision_policy_version"] == (
        DECISION_POLICY_VERSION
    )
    assert prediction.backend == "onnxruntime"


def test_onnx_adapter_runs_two_models_over_three_center_scale_views(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeSession:
        def __init__(self, logits: list[float]) -> None:
            self.logits = logits
            self.position = 0

        def run(self, output_names, inputs):
            assert output_names == ["logit"]
            assert inputs["image"].shape == (1, 3, 16, 16)
            logit = self.logits[self.position]
            self.position += 1
            return [np.asarray([[logit]], dtype=np.float32)]

    def model(role: str, version: str) -> dict[str, Any]:
        return {
            "role": role,
            "version": version,
            "model_sha256": ("b" if role.startswith("broad") else "a") * 64,
            "target": role,
            "image_size": 16,
            "mean": [0.485, 0.456, 0.406],
            "std": [0.229, 0.224, 0.225],
            "input_name": "image",
            "output_name": "logit",
            "calibration_method": "affine_logistic_scaling",
            "logit_scale": 1.0,
            "logit_bias": 0.0,
            "low_threshold": 0.2,
            "high_threshold": 0.6,
            "thresholds_validated": False,
        }

    image_path = tmp_path / "observation.png"
    image = np.full((24, 32, 3), 127, dtype=np.uint8)
    assert ai_service_module.cv2.imwrite(str(image_path), image)
    monkeypatch.setattr(settings, "ai_backend", "onnxruntime")
    service = AIService()
    service._dual_sessions = {
        "melanoma_attention": FakeSession([2.2, 2.1, 2.0]),
        "broad_malignancy_attention": FakeSession([2.4, 2.3, 2.2]),
    }
    service._manifest = {
        "version": "express-derm-1",
        "release_version": "express-derm-v0.4.0-dual",
        "bundle_sha256": "c" * 64,
        "models": [
            model("melanoma_attention", "melanoma-v1"),
            model("broad_malignancy_attention", "broad-v1"),
        ],
        "decision_policy": {
            "view_protocol": "center_scale3_consensus_v1",
            "broad_confirmation_threshold": 0.8,
        },
        "validation_status": "research_only",
        "domain_status": "microscope_validation_pending",
        "thresholds_validated": False,
    }

    prediction = service.predict(
        image_path,
        observation_id=1,
        quality_status="accepted",
        microscope_source_confirmed=True,
        acquisition_protocol_status="validated",
    )

    assert prediction.attention_level == "high"
    assert prediction.model_hash == "c" * 64
    assert prediction.payload["combined_label"] == "high_confirmed"
    assert set(prediction.payload["signals"]) == {
        "melanoma_attention",
        "broad_malignancy_attention",
    }
    assert len(
        prediction.payload["signals"]["melanoma_attention"]["view_scores"]
    ) == 3
