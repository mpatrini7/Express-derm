from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[2]
VERIFY_SCRIPT = ROOT / "scripts" / "verify_ai_model_package.py"
MODEL_VERSION = "express-derm-1"
MODEL_SHA256 = (
    "f47087ac224641740f7af18b4d112b460d7905cd37dc90f0b9fce707a5a106be"
)

spec = importlib.util.spec_from_file_location(
    "verify_ai_model_package",
    VERIFY_SCRIPT,
)
assert spec is not None and spec.loader is not None
verify_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_module)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def test_bundled_model_package_is_hash_verified() -> None:
    result = verify_module.verify_package(
        ROOT / "models" / MODEL_VERSION,
        require_engine=False,
        expected_version=MODEL_VERSION,
        expected_model_sha256=MODEL_SHA256,
    )

    assert result["version"] == MODEL_VERSION
    assert result["model_sha256"] == MODEL_SHA256
    assert result["runtime_model_count"] == 2
    assert result["bundle_sha256"] is not None


def test_model_package_verifier_accepts_registered_engine(
    tmp_path: Path,
) -> None:
    model_dir = tmp_path / "registered"
    model_dir.mkdir()
    model_bytes = b"onnx-model"
    engine_bytes = b"target-built-engine"
    (model_dir / "model.onnx").write_bytes(model_bytes)
    (model_dir / "model.engine").write_bytes(engine_bytes)
    manifest = {
        "version": MODEL_VERSION,
        "model_sha256": sha256_bytes(model_bytes),
        "engine_filename": "model.engine",
        "engine_sha256": sha256_bytes(engine_bytes),
        "deployment_status": "engine_registered",
    }
    manifest_path = model_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    (model_dir / "engine-registration.json").write_text(
        json.dumps(
            {
                "model_version": MODEL_VERSION,
                "model_sha256": sha256_bytes(model_bytes),
                "engine_sha256": sha256_bytes(engine_bytes),
                "registered_manifest_sha256": verify_module.sha256_file(
                    manifest_path
                ),
            }
        ),
        encoding="utf-8",
    )

    result = verify_module.verify_package(
        model_dir,
        require_engine=True,
        expected_version=MODEL_VERSION,
        expected_model_sha256=sha256_bytes(model_bytes),
    )

    assert result["engine_sha256"] == sha256_bytes(engine_bytes)
    assert result["deployment_status"] == "engine_registered"


def test_model_package_verifier_rejects_tampering(tmp_path: Path) -> None:
    model_dir = tmp_path / "source"
    model_dir.mkdir()
    (model_dir / "model.onnx").write_bytes(b"tampered")
    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "version": MODEL_VERSION,
                "model_sha256": sha256_bytes(b"original"),
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(
        verify_module.ModelPackageError,
        match="model.onnx hash",
    ):
        verify_module.verify_package(
            model_dir,
            require_engine=False,
            expected_version=MODEL_VERSION,
            expected_model_sha256=None,
        )


def test_bundled_model_package_rejects_broad_model_tampering(
    tmp_path: Path,
) -> None:
    source = ROOT / "models" / MODEL_VERSION
    model_dir = tmp_path / "dual"
    model_dir.mkdir()
    for filename in ("manifest.json", "model.onnx", "model-broad.onnx"):
        (model_dir / filename).write_bytes((source / filename).read_bytes())
    (model_dir / "model-broad.onnx").write_bytes(b"tampered")

    with pytest.raises(
        verify_module.ModelPackageError,
        match="model-broad.onnx hash",
    ):
        verify_module.verify_package(
            model_dir,
            require_engine=False,
            expected_version=MODEL_VERSION,
            expected_model_sha256=None,
        )


def test_launcher_verifies_models_only_when_ai_is_enabled() -> None:
    launcher = (ROOT / "scripts" / "start_project.sh").read_text(
        encoding="utf-8"
    )

    assert 'if [[ "$AI_ENABLED" == true ]]; then\n  assert_model_package' in launcher
    assert "verify_ai_model_package.py" in launcher
