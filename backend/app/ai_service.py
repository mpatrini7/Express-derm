from __future__ import annotations

import json
import math
import time
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

import cv2
import numpy as np

from .ai_worker_client import (
    ExpectedModel,
    TensorRTWorkerClient,
    WorkerPrediction,
)
from .config import settings
from .decision_policy import (
    DECISION_POLICY_VERSION,
    classify_binary_score,
    classify_consensus_scores,
    combine_dual_signals,
)


DEPLOYMENT_PREPROCESSING_VERSION = (
    "opencv_imread_bgr2rgb_inter_area_stretch_imagenet_nchw_float32_v1"
)


def _validate_preprocessing_manifest(manifest: dict) -> None:
    """Require the explicit preprocessing contract for schema v3 bundles."""
    if int(manifest.get("schema_version", 1)) < 3:
        return
    expected = {
        "version": DEPLOYMENT_PREPROCESSING_VERSION,
        "decoder": "opencv_imread_color",
        "color_conversion": "bgr_to_rgb",
        "resize_interpolation": "area",
        "resize_geometry": "stretch_square",
        "pixel_scale": "uint8_div_255",
        "layout": "nchw",
        "dtype": "float32",
    }
    if manifest.get("preprocessing") != expected:
        raise RuntimeError(
            "Model preprocessing contract is missing or unsupported"
        )
    if int(manifest.get("schema_version", 1)) >= 4:
        models = manifest.get("models")
        if not isinstance(models, list) or any(
            not isinstance(model, dict)
            or model.get("preprocessing") != expected
            for model in models
        ):
            raise RuntimeError(
                "Dual-model preprocessing contracts are missing or unsupported"
            )


def _validate_model_identity_manifest(manifest: dict) -> None:
    """Require an explicit, self-contained runtime identity contract."""
    schema_version = int(manifest.get("schema_version", 1))
    if schema_version < 3:
        return
    expected = (
        {
            "model_family": "express-derm",
            "runtime_identity": "express-derm",
            "runtime_model_count": 1,
            "external_runtime_models": [],
        }
        if schema_version == 3
        else {
            "model_family": "express-derm",
            "runtime_identity": "express-derm-dual",
            "runtime_model_count": 2,
            "external_runtime_models": [],
        }
    )
    if any(manifest.get(field) != value for field, value in expected.items()):
        raise RuntimeError(
            "Model runtime identity contract is missing or unsupported"
        )
    if schema_version >= 4:
        models = manifest.get("models")
        if not isinstance(models, list) or len(models) != 2:
            raise RuntimeError("Dual-model runtime must declare two models")
        roles = {model.get("role") for model in models if isinstance(model, dict)}
        if roles != {"melanoma_attention", "broad_malignancy_attention"}:
            raise RuntimeError("Dual-model runtime roles are invalid")
        filenames = [model.get("filename") for model in models]
        if any(
            not isinstance(filename, str)
            or not filename
            or Path(filename).name != filename
            for filename in filenames
        ) or len(set(filenames)) != 2:
            raise RuntimeError("Dual-model runtime filenames are unsafe")
        policy = manifest.get("decision_policy")
        if (
            not isinstance(policy, dict)
            or policy.get("version") != DECISION_POLICY_VERSION
        ):
            raise RuntimeError("Dual-model decision policy is unsupported")


def _center_scale_batch(image: np.ndarray, manifest: dict) -> np.ndarray:
    size = int(manifest["image_size"])
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    height, width = rgb.shape[:2]
    resized_views: list[np.ndarray] = []
    for fraction in (1.0, 0.9, 0.8):
        crop_height = max(1, min(height, round(height * fraction)))
        crop_width = max(1, min(width, round(width * fraction)))
        top = (height - crop_height) // 2
        left = (width - crop_width) // 2
        crop = rgb[top : top + crop_height, left : left + crop_width]
        resized_views.append(
            cv2.resize(
                crop,
                (size, size),
                interpolation=cv2.INTER_AREA,
            )
        )
    tensor = np.stack(resized_views).astype(np.float32) / 255.0
    mean = np.asarray(manifest["mean"], dtype=np.float32)
    std = np.asarray(manifest["std"], dtype=np.float32)
    tensor = (tensor - mean) / std
    return np.transpose(tensor, (0, 3, 1, 2))


def _calibrate_logits(raw: np.ndarray, manifest: dict) -> list[float]:
    logits = np.asarray(raw, dtype=np.float64).reshape(-1)
    calibration_method = manifest.get(
        "calibration_method",
        "temperature_scaling",
    )
    if calibration_method == "affine_logistic_scaling":
        calibrated = (
            float(manifest["logit_scale"]) * logits
            + float(manifest["logit_bias"])
        )
    elif calibration_method == "temperature_scaling":
        temperature = max(float(manifest.get("temperature", 1.0)), 1e-6)
        calibrated = logits / temperature
    else:
        raise RuntimeError(
            f"Unsupported calibration method: {calibration_method}"
        )
    clipped = np.clip(calibrated, -50.0, 50.0)
    return [float(value) for value in 1.0 / (1.0 + np.exp(-clipped))]


@dataclass(frozen=True)
class Prediction:
    model_version: str
    model_hash: str | None
    backend: str
    score: float
    attention_level: str
    abstained: bool
    abstention_reason: str | None
    validation_status: str
    domain_status: str
    latency_ms: float
    payload: dict


class AIService:
    def __init__(self) -> None:
        self._lock = Lock()
        self._session = None
        self._dual_sessions: dict[str, object] = {}
        self._worker: TensorRTWorkerClient | None = None
        self._manifest: dict | None = None
        self._error: str | None = None

    def status(self) -> dict:
        if not settings.ai_enabled:
            return {
                "enabled": False,
                "ready": False,
                "backend": settings.ai_backend,
                "model_version": None,
                "model_release": None,
                "model_hash": None,
                "validation_status": None,
                "domain_status": None,
                "reason": "AI is disabled by configuration",
            }
        self._ensure_loaded()
        manifest = self._manifest or {}
        if self._worker is not None and self._manifest is not None:
            try:
                worker_status = self._worker.status(
                    ExpectedModel.from_manifest(self._manifest)
                )
            except RuntimeError as exc:
                return {
                    "enabled": True,
                    "ready": False,
                    "backend": settings.ai_backend,
                    "model_version": manifest.get("version"),
                    "model_release": manifest.get(
                        "release_version", manifest.get("version")
                    ),
                    "model_hash": manifest.get(
                        "bundle_sha256", manifest.get("model_sha256")
                    ),
                    "validation_status": manifest.get("validation_status"),
                    "domain_status": manifest.get("domain_status"),
                    "reason": str(exc),
                }
            return {
                "enabled": True,
                "ready": worker_status.ready,
                "backend": settings.ai_backend,
                "model_version": worker_status.model_version,
                "model_release": worker_status.model_release,
                "model_hash": worker_status.model_sha256,
                "validation_status": worker_status.validation_status,
                "domain_status": worker_status.domain_status,
                "reason": worker_status.reason,
            }
        return {
            "enabled": True,
            "ready": self._session is not None or bool(self._dual_sessions),
            "backend": settings.ai_backend,
            "model_version": manifest.get("version"),
            "model_release": manifest.get(
                "release_version", manifest.get("version")
            ),
            "model_hash": manifest.get(
                "bundle_sha256", manifest.get("model_sha256")
            ),
            "validation_status": manifest.get("validation_status"),
            "domain_status": manifest.get("domain_status"),
            "reason": self._error,
        }

    def _ensure_loaded(self) -> None:
        if (
            self._session is not None
            or self._dual_sessions
            or self._worker is not None
            or self._error is not None
        ):
            return
        with self._lock:
            if (
                self._session is not None
                or self._dual_sessions
                or self._worker is not None
                or self._error is not None
            ):
                return
            try:
                manifest_path = settings.ai_model_dir / "manifest.json"
                if not manifest_path.exists():
                    raise RuntimeError(
                        f"Model manifest not found in {settings.ai_model_dir}"
                    )

                self._manifest = json.loads(
                    manifest_path.read_text(encoding="utf-8")
                )
                _validate_preprocessing_manifest(self._manifest)
                _validate_model_identity_manifest(self._manifest)
                if (
                    self._manifest.get("validation_status") != "validated"
                    and not settings.ai_allow_unvalidated_model
                ):
                    raise RuntimeError(
                        "Model is not marked validated; explicitly allow the "
                        "included research-only model"
                    )

                if settings.ai_backend == "onnxruntime":
                    import onnxruntime as ort

                    providers = [
                        provider
                        for provider in (
                            "CUDAExecutionProvider",
                            "CPUExecutionProvider",
                        )
                        if provider in ort.get_available_providers()
                    ]
                    selected_providers = providers or ["CPUExecutionProvider"]
                    if int(self._manifest.get("schema_version", 1)) >= 4:
                        loaded_sessions: dict[str, object] = {}
                        for model in self._manifest["models"]:
                            filename = str(model["filename"])
                            model_path = settings.ai_model_dir / filename
                            if not model_path.exists():
                                raise RuntimeError(
                                    f"ONNX model not found: {filename}"
                                )
                            loaded_sessions[str(model["role"])] = (
                                ort.InferenceSession(
                                    str(model_path),
                                    providers=selected_providers,
                                )
                            )
                        self._dual_sessions = loaded_sessions
                    else:
                        model_path = settings.ai_model_dir / "model.onnx"
                        if not model_path.exists():
                            raise RuntimeError(
                                "ONNX model not found in "
                                f"{settings.ai_model_dir}"
                            )
                        self._session = ort.InferenceSession(
                            str(model_path),
                            providers=selected_providers,
                        )
                elif settings.ai_backend == "tensorrt_cpp":
                    if int(self._manifest.get("schema_version", 1)) >= 4:
                        raise RuntimeError(
                            "The dual-model policy currently requires the "
                            "ONNX Runtime backend"
                        )
                    expected_model = ExpectedModel.from_manifest(
                        self._manifest
                    )
                    if (
                        expected_model.deployment_status != "validated"
                        and not settings.ai_allow_unvalidated_model
                    ):
                        raise RuntimeError(
                            "TensorRT deployment is not validated; keep AI "
                            "disabled or explicitly allow a research-only "
                            "runtime"
                        )
                    self._worker = TensorRTWorkerClient(
                        settings.ai_worker_socket,
                        timeout_seconds=settings.ai_worker_timeout_seconds,
                    )
                else:
                    raise RuntimeError(
                        f"Unsupported AI backend: {settings.ai_backend}"
                    )
            except Exception as exc:
                self._error = str(exc)

    def predict(
        self,
        image_path: Path,
        *,
        observation_id: int,
        quality_status: str,
        microscope_source_confirmed: bool,
        acquisition_protocol_status: str,
    ) -> Prediction:
        self._ensure_loaded()
        if self._manifest is None:
            raise RuntimeError(self._error or "AI model is unavailable")
        if self._worker is not None:
            worker_prediction = self._worker.predict(
                image_path=image_path,
                observation_id=observation_id,
                quality_status=quality_status,
                microscope_source_confirmed=microscope_source_confirmed,
                acquisition_protocol_status=acquisition_protocol_status,
                expected_model=ExpectedModel.from_manifest(self._manifest),
            )
            return self._worker_prediction(worker_prediction)
        if self._session is None and not self._dual_sessions:
            raise RuntimeError(self._error or "AI model is unavailable")

        started = time.perf_counter()
        manifest = self._manifest
        image = cv2.imread(str(image_path), cv2.IMREAD_COLOR)
        if image is None:
            raise RuntimeError("Unable to read microscope image")
        if self._dual_sessions:
            return self._predict_dual(image, started=started)

        size = int(manifest["image_size"])
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        rgb = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_AREA)
        tensor = rgb.astype(np.float32) / 255.0
        mean = np.asarray(manifest["mean"], dtype=np.float32)
        std = np.asarray(manifest["std"], dtype=np.float32)
        tensor = (tensor - mean) / std
        tensor = np.transpose(tensor, (2, 0, 1))[None, ...]

        raw = self._session.run(
            [manifest["output_name"]],
            {manifest["input_name"]: tensor},
        )[0]
        logit = float(np.asarray(raw).reshape(-1)[0])
        calibration_method = manifest.get(
            "calibration_method",
            "temperature_scaling",
        )
        if calibration_method == "affine_logistic_scaling":
            scale = float(manifest["logit_scale"])
            bias = float(manifest["logit_bias"])
            calibrated_logit = scale * logit + bias
        elif calibration_method == "temperature_scaling":
            temperature = max(float(manifest.get("temperature", 1.0)), 1e-6)
            calibrated_logit = logit / temperature
        else:
            raise RuntimeError(
                f"Unsupported calibration method: {calibration_method}"
            )
        score = 1.0 / (
            1.0 + math.exp(-max(min(calibrated_logit, 50), -50))
        )

        decision = classify_binary_score(
            score,
            low_threshold=float(manifest["low_threshold"]),
            high_threshold=float(manifest["high_threshold"]),
            abstention_margin=float(
                manifest.get("abstention_margin", 0.0)
            ),
        )

        latency_ms = (time.perf_counter() - started) * 1000.0
        payload = {
            "model_version": manifest["version"],
            "model_release": manifest.get(
                "release_version", manifest["version"]
            ),
            "model_sha256": manifest.get("model_sha256"),
            "score": score,
            "attention_level": decision.level,
            "abstained": decision.abstained,
            "abstention_reason": decision.reason,
            "decision_policy_version": DECISION_POLICY_VERSION,
            "validation_status": manifest.get("validation_status", "unknown"),
            "domain_status": manifest.get("domain_status", "unknown"),
            "latency_ms": latency_ms,
            "thresholds_validated": bool(
                manifest.get("thresholds_validated", False)
            ),
            "research_only": True,
        }

        return Prediction(
            model_version=manifest["version"],
            model_hash=manifest.get("model_sha256"),
            backend=settings.ai_backend,
            score=score,
            attention_level=decision.level,
            abstained=decision.abstained,
            abstention_reason=decision.reason,
            validation_status=manifest.get("validation_status", "unknown"),
            domain_status=manifest.get("domain_status", "unknown"),
            latency_ms=latency_ms,
            payload=payload,
        )

    def _predict_dual(
        self,
        image: np.ndarray,
        *,
        started: float,
    ) -> Prediction:
        if self._manifest is None:
            raise RuntimeError("Dual-model manifest is unavailable")
        manifest = self._manifest
        model_manifests = {
            str(model["role"]): model for model in manifest["models"]
        }
        signal_payloads: dict[str, dict] = {}
        signal_decisions = {}
        signal_scores: dict[str, list[float]] = {}

        for role in ("melanoma_attention", "broad_malignancy_attention"):
            model_manifest = model_manifests[role]
            tensor = _center_scale_batch(image, model_manifest)
            session = self._dual_sessions[role]
            raw = np.asarray(
                [
                    float(
                        np.asarray(
                            session.run(
                                [model_manifest["output_name"]],
                                {
                                    model_manifest["input_name"]: tensor[
                                        view_index : view_index + 1
                                    ]
                                },
                            )[0]
                        ).reshape(-1)[0]
                    )
                    for view_index in range(len(tensor))
                ],
                dtype=np.float64,
            )
            scores = _calibrate_logits(raw, model_manifest)
            decision = classify_consensus_scores(
                scores,
                low_threshold=float(model_manifest["low_threshold"]),
                high_threshold=float(model_manifest["high_threshold"]),
            )
            signal_scores[role] = scores
            signal_decisions[role] = decision
            signal_payloads[role] = {
                "model_version": model_manifest["version"],
                "model_sha256": model_manifest["model_sha256"],
                "target": model_manifest["target"],
                "view_names": [
                    "original",
                    "center_crop_90",
                    "center_crop_80",
                ],
                "view_scores": scores,
                "consensus_level": decision.level,
                "low_threshold": float(model_manifest["low_threshold"]),
                "high_threshold": float(model_manifest["high_threshold"]),
                "thresholds_validated": bool(
                    model_manifest.get("thresholds_validated", False)
                ),
            }

        policy = manifest["decision_policy"]
        combined = combine_dual_signals(
            signal_decisions["melanoma_attention"],
            signal_decisions["broad_malignancy_attention"],
            broad_scores=signal_scores["broad_malignancy_attention"],
            broad_confirmation_threshold=float(
                policy["broad_confirmation_threshold"]
            ),
        )
        combined_label = {
            "high": "high_confirmed",
            "uncertain": "review",
            "low": "no_elevated_signal",
        }[combined.level]
        latency_ms = (time.perf_counter() - started) * 1000.0
        payload = {
            "model_version": manifest["version"],
            "model_release": manifest.get(
                "release_version", manifest["version"]
            ),
            "model_sha256": manifest["bundle_sha256"],
            "score": signal_scores["melanoma_attention"][0],
            "score_semantics": "melanoma_original_view_compatibility_only",
            "attention_level": combined.level,
            "combined_label": combined_label,
            "abstained": combined.abstained,
            "abstention_reason": combined.reason,
            "decision_policy_version": DECISION_POLICY_VERSION,
            "view_protocol": policy["view_protocol"],
            "broad_confirmation_threshold": float(
                policy["broad_confirmation_threshold"]
            ),
            "signals": signal_payloads,
            "validation_status": manifest.get(
                "validation_status", "unknown"
            ),
            "domain_status": manifest.get("domain_status", "unknown"),
            "latency_ms": latency_ms,
            "thresholds_validated": bool(
                manifest.get("thresholds_validated", False)
            ),
            "research_only": True,
        }
        return Prediction(
            model_version=manifest["version"],
            model_hash=manifest["bundle_sha256"],
            backend=settings.ai_backend,
            score=signal_scores["melanoma_attention"][0],
            attention_level=combined.level,
            abstained=combined.abstained,
            abstention_reason=combined.reason,
            validation_status=manifest.get("validation_status", "unknown"),
            domain_status=manifest.get("domain_status", "unknown"),
            latency_ms=latency_ms,
            payload=payload,
        )

    @staticmethod
    def _worker_prediction(result: WorkerPrediction) -> Prediction:
        return Prediction(
            model_version=result.model_version,
            model_hash=result.model_sha256,
            backend="tensorrt_cpp",
            score=result.score,
            attention_level=result.attention_level,
            abstained=result.abstained,
            abstention_reason=result.abstention_reason,
            validation_status=result.validation_status,
            domain_status=result.domain_status,
            latency_ms=result.latency_ms,
            payload=result.payload,
        )


ai_service = AIService()
