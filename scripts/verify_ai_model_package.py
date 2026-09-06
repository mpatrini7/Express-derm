#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any


class ModelPackageError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def require_regular_file(path: Path) -> None:
    if not path.is_file() or path.is_symlink():
        raise ModelPackageError(f"Required regular file is missing: {path}")


def require_sha256(manifest: dict[str, Any], key: str) -> str:
    value = manifest.get(key)
    if (
        not isinstance(value, str)
        or len(value) != 64
        or any(character not in "0123456789abcdef" for character in value)
    ):
        raise ModelPackageError(f"Manifest field {key} is not a SHA-256")
    return value


def read_json_object(path: Path) -> dict[str, Any]:
    require_regular_file(path)
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ModelPackageError(f"Unable to read {path.name}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ModelPackageError(f"{path.name} must contain a JSON object")
    return payload


def verify_runtime_identity(manifest: dict[str, Any]) -> None:
    schema_version = manifest.get("schema_version", 1)
    if type(schema_version) is not int or schema_version < 1:
        raise ModelPackageError("Manifest schema_version is invalid")
    if schema_version < 3:
        return
    if schema_version not in {3, 4}:
        raise ModelPackageError("Manifest schema_version is unsupported")
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
    for field, value in expected.items():
        if manifest.get(field) != value:
            raise ModelPackageError(
                f"Manifest runtime identity field {field} is invalid"
            )


def dual_bundle_sha256(manifest: dict[str, Any]) -> str:
    receipt = {
        "version": manifest.get("version"),
        "release_version": manifest.get("release_version"),
        "models": manifest.get("models"),
        "decision_policy": manifest.get("decision_policy"),
    }
    canonical = json.dumps(
        receipt,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def verify_dual_bundle(
    model_dir: Path,
    manifest: dict[str, Any],
) -> str | None:
    if int(manifest.get("schema_version", 1)) < 4:
        return None
    models = manifest.get("models")
    if not isinstance(models, list) or len(models) != 2:
        raise ModelPackageError("Dual bundle must declare exactly two models")
    roles: set[str] = set()
    for model in models:
        if not isinstance(model, dict):
            raise ModelPackageError("Dual bundle model entry is invalid")
        role = model.get("role")
        filename = model.get("filename")
        if not isinstance(role, str) or not role:
            raise ModelPackageError("Dual bundle model role is invalid")
        if (
            not isinstance(filename, str)
            or not filename
            or Path(filename).name != filename
        ):
            raise ModelPackageError("Dual bundle model filename is unsafe")
        if role in roles:
            raise ModelPackageError("Dual bundle model roles are duplicated")
        roles.add(role)
        expected_sha256 = require_sha256(model, "model_sha256")
        model_path = model_dir / filename
        require_regular_file(model_path)
        if sha256_file(model_path) != expected_sha256:
            raise ModelPackageError(
                f"{filename} hash does not match manifest.json"
            )
    if roles != {"melanoma_attention", "broad_malignancy_attention"}:
        raise ModelPackageError("Dual bundle model roles are incomplete")
    policy = manifest.get("decision_policy")
    if (
        not isinstance(policy, dict)
        or policy.get("version") != "dual-center-scale-confirmation-v1"
    ):
        raise ModelPackageError("Dual bundle decision policy is invalid")
    evidence = policy.get("evidence")
    if not isinstance(evidence, list) or not evidence:
        raise ModelPackageError("Dual bundle decision evidence is missing")
    for artifact in evidence:
        if not isinstance(artifact, dict):
            raise ModelPackageError("Dual bundle evidence entry is invalid")
        filename = artifact.get("filename")
        if (
            not isinstance(filename, str)
            or not filename
            or Path(filename).name != filename
        ):
            raise ModelPackageError("Dual bundle evidence filename is unsafe")
        expected_sha256 = require_sha256(artifact, "sha256")
        artifact_path = model_dir / filename
        require_regular_file(artifact_path)
        if sha256_file(artifact_path) != expected_sha256:
            raise ModelPackageError(
                f"{filename} hash does not match manifest.json"
            )
    recorded_bundle_sha256 = require_sha256(manifest, "bundle_sha256")
    if dual_bundle_sha256(manifest) != recorded_bundle_sha256:
        raise ModelPackageError("Dual bundle hash does not match manifest.json")
    return recorded_bundle_sha256


def verify_package(
    model_dir: Path,
    *,
    require_engine: bool,
    expected_version: str | None,
    expected_release: str | None = None,
    expected_model_sha256: str | None = None,
) -> dict[str, Any]:
    if not model_dir.is_dir() or model_dir.is_symlink():
        raise ModelPackageError(
            f"Model package directory is missing or unsafe: {model_dir}"
        )

    manifest_path = model_dir / "manifest.json"
    model_path = model_dir / "model.onnx"
    require_regular_file(model_path)
    manifest = read_json_object(manifest_path)
    verify_runtime_identity(manifest)

    version = manifest.get("version")
    if not isinstance(version, str) or not version.strip():
        raise ModelPackageError("Manifest version is missing")
    if expected_version is not None and version != expected_version:
        raise ModelPackageError(
            f"Unexpected model version: {version}; expected {expected_version}"
        )

    release = manifest.get("release_version", version)
    if not isinstance(release, str) or not release.strip():
        raise ModelPackageError("Manifest release_version is invalid")
    if expected_release is not None and release != expected_release:
        raise ModelPackageError(
            f"Unexpected model release: {release}; expected {expected_release}"
        )

    model_sha256 = require_sha256(manifest, "model_sha256")
    if expected_model_sha256 is not None and model_sha256 != expected_model_sha256:
        raise ModelPackageError(
            "Manifest model hash does not match the installer receipt"
        )
    if sha256_file(model_path) != model_sha256:
        raise ModelPackageError("model.onnx hash does not match manifest.json")
    bundle_sha256 = verify_dual_bundle(model_dir, manifest)

    result: dict[str, Any] = {
        "model_dir": str(model_dir.resolve()),
        "version": version,
        "release_version": release,
        "model_sha256": model_sha256,
        "bundle_sha256": bundle_sha256,
        "runtime_model_count": int(manifest.get("runtime_model_count", 1)),
        "engine_sha256": None,
    }
    if require_engine:
        if bundle_sha256 is not None:
            raise ModelPackageError(
                "Dual-model bundles do not yet support the TensorRT worker"
            )
        if manifest.get("engine_filename") != "model.engine":
            raise ModelPackageError(
                "Registered manifest must declare engine_filename=model.engine"
            )
        engine_sha256 = require_sha256(manifest, "engine_sha256")
        engine_path = model_dir / "model.engine"
        require_regular_file(engine_path)
        if sha256_file(engine_path) != engine_sha256:
            raise ModelPackageError(
                "model.engine hash does not match manifest.json"
            )
        deployment_status = manifest.get("deployment_status")
        if not isinstance(deployment_status, str) or not deployment_status.strip():
            raise ModelPackageError(
                "Registered manifest has no deployment_status"
            )
        registration_path = model_dir / "engine-registration.json"
        registration = read_json_object(registration_path)
        if registration.get("model_version") != version:
            raise ModelPackageError(
                "Engine registration model version does not match manifest.json"
            )
        if registration.get("model_release", version) != release:
            raise ModelPackageError(
                "Engine registration model release does not match manifest.json"
            )
        if registration.get("model_sha256") != model_sha256:
            raise ModelPackageError(
                "Engine registration model hash does not match manifest.json"
            )
        if registration.get("engine_sha256") != engine_sha256:
            raise ModelPackageError(
                "Engine registration hash does not match model.engine"
            )
        registered_manifest_sha256 = require_sha256(
            registration,
            "registered_manifest_sha256",
        )
        if sha256_file(manifest_path) != registered_manifest_sha256:
            raise ModelPackageError(
                "Registered manifest hash does not match engine registration"
            )
        result["engine_sha256"] = engine_sha256
        result["deployment_status"] = deployment_status
    return result


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Verify an immutable Express-Derm AI model package."
    )
    parser.add_argument("--model-dir", required=True, type=Path)
    parser.add_argument("--require-engine", action="store_true")
    parser.add_argument("--expected-version")
    parser.add_argument("--expected-release")
    parser.add_argument("--expected-model-sha256")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        result = verify_package(
            args.model_dir,
            require_engine=args.require_engine,
            expected_version=args.expected_version,
            expected_release=args.expected_release,
            expected_model_sha256=args.expected_model_sha256,
        )
    except ModelPackageError as exc:
        print(f"Model package error: {exc}", file=sys.stderr)
        return 1
    print(
        "Verified AI model package: "
        f"{result['version']} "
        f"({result['bundle_sha256'] or result['model_sha256']})"
    )
    if result["engine_sha256"] is not None:
        print(f"Verified TensorRT engine: {result['engine_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
