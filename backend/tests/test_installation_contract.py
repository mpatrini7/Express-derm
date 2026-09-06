from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

from app.risk_policy import FOLLOW_UP_POLICY_VERSION


ROOT = Path(__file__).resolve().parents[2]
VERIFY_SCRIPT = ROOT / "scripts" / "verify_ai_model_package.py"
MODEL_NAME = "express-derm-1"
MODEL_RELEASE = "express-derm-v0.4.0-dual"
MODEL_DIR = ROOT / "models" / MODEL_NAME

spec = importlib.util.spec_from_file_location("verify_ai_model_package", VERIFY_SCRIPT)
assert spec is not None and spec.loader is not None
verify_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify_module)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def test_standalone_startup_contract() -> None:
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")
    bootstrap = (ROOT / "scripts" / "ensure_python_dependencies.sh").read_text(
        encoding="utf-8"
    )
    launcher = (ROOT / "scripts" / "start_project.sh").read_text(
        encoding="utf-8"
    )

    assert "PYTHON_ENV_DIR ?= $(CURDIR)/.runtime/python" in makefile
    assert "PYTHON ?= $(PYTHON_ENV_DIR)/bin/python" in makefile
    assert "./scripts/ensure_python_dependencies.sh" in makefile
    assert "start: setup-python" in makefile
    assert "models/express-derm-1" in makefile
    assert "start: frontend-deps" not in makefile
    assert "python3-venv" in bootstrap
    assert "requirements.txt" in bootstrap
    assert "Do not use sudo pip or --break-system-packages" in bootstrap
    assert "models/express-derm-1" in launcher
    assert 'AI_ENABLED="${EXPRESS_DERM_AI_ENABLED:-true}"' in launcher
    assert 'AI_REQUIRED="${EXPRESS_DERM_AI_REQUIRED:-true}"' in launcher
    assert (
        'AI_ALLOW_UNVALIDATED="${EXPRESS_DERM_AI_ALLOW_UNVALIDATED_MODEL:-true}"'
        in launcher
    )
    assert f'FOLLOW_UP_POLICY_VERSION="{FOLLOW_UP_POLICY_VERSION}"' in launcher
    assert "backend_policy_is_current" in launcher
    assert "uses an outdated follow-up policy" in launcher
    assert "Run make start from the project root" in launcher
    assert "Do not use sudo pip or --break-system-packages" in launcher
    assert "/bin/python" not in launcher


def test_bundled_model_is_hash_verified_and_has_expected_identity() -> None:
    result = verify_module.verify_package(
        MODEL_DIR,
        require_engine=False,
        expected_version=MODEL_NAME,
        expected_release=MODEL_RELEASE,
        expected_model_sha256=None,
    )
    manifest = json.loads(
        (MODEL_DIR / "manifest.json").read_text(encoding="utf-8")
    )

    assert result["version"] == MODEL_NAME
    assert result["release_version"] == MODEL_RELEASE
    assert manifest["model_family"] == "express-derm"
    assert manifest["runtime_identity"] == "express-derm-dual"
    assert manifest["runtime_model_count"] == 2
    assert manifest["external_runtime_models"] == []
    assert result["bundle_sha256"] == manifest["bundle_sha256"]
    assert {
        model["role"] for model in manifest["models"]
    } == {"melanoma_attention", "broad_malignancy_attention"}
    assert verify_module.sha256_file(
        MODEL_DIR / "model-broad.onnx"
    ) == next(
        model["model_sha256"]
        for model in manifest["models"]
        if model["role"] == "broad_malignancy_attention"
    )
    assert result["model_sha256"] == verify_module.sha256_file(
        MODEL_DIR / "model.onnx"
    )


def test_model_package_verifier_accepts_registered_engine(tmp_path: Path) -> None:
    model_dir = tmp_path / "registered"
    model_dir.mkdir()
    model_bytes = b"onnx-model"
    engine_bytes = b"target-built-engine"
    (model_dir / "model.onnx").write_bytes(model_bytes)
    (model_dir / "model.engine").write_bytes(engine_bytes)
    manifest = {
        "schema_version": 3,
        "version": MODEL_NAME,
        "release_version": MODEL_RELEASE,
        "model_family": "express-derm",
        "runtime_identity": "express-derm",
        "runtime_model_count": 1,
        "external_runtime_models": [],
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
                "model_version": MODEL_NAME,
                "model_release": MODEL_RELEASE,
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
        expected_version=MODEL_NAME,
        expected_release=MODEL_RELEASE,
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
                "version": MODEL_NAME,
                "release_version": MODEL_RELEASE,
                "model_sha256": sha256_bytes(b"original"),
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(verify_module.ModelPackageError, match="model.onnx hash"):
        verify_module.verify_package(
            model_dir,
            require_engine=False,
            expected_version=MODEL_NAME,
            expected_release=MODEL_RELEASE,
            expected_model_sha256=None,
        )


def test_model_package_verifier_rejects_an_external_runtime_model(
    tmp_path: Path,
) -> None:
    model_dir = tmp_path / "source"
    model_dir.mkdir()
    model_bytes = b"onnx-model"
    (model_dir / "model.onnx").write_bytes(model_bytes)
    (model_dir / "manifest.json").write_text(
        json.dumps(
            {
                "schema_version": 3,
                "version": MODEL_NAME,
                "release_version": MODEL_RELEASE,
                "model_family": "express-derm",
                "runtime_identity": "express-derm",
                "runtime_model_count": 2,
                "external_runtime_models": ["another-model"],
                "model_sha256": sha256_bytes(model_bytes),
            }
        ),
        encoding="utf-8",
    )

    with pytest.raises(
        verify_module.ModelPackageError,
        match="runtime identity field",
    ):
        verify_module.verify_package(
            model_dir,
            require_engine=False,
            expected_version=MODEL_NAME,
            expected_release=MODEL_RELEASE,
            expected_model_sha256=None,
        )
