import pytest

from app.ai_service import (
    DEPLOYMENT_PREPROCESSING_VERSION,
    _validate_model_identity_manifest,
    _validate_preprocessing_manifest,
)


def _manifest() -> dict:
    return {
        "schema_version": 3,
        "model_family": "express-derm",
        "runtime_identity": "express-derm",
        "runtime_model_count": 1,
        "external_runtime_models": [],
        "preprocessing": {
            "version": DEPLOYMENT_PREPROCESSING_VERSION,
            "decoder": "opencv_imread_color",
            "color_conversion": "bgr_to_rgb",
            "resize_interpolation": "area",
            "resize_geometry": "stretch_square",
            "pixel_scale": "uint8_div_255",
            "layout": "nchw",
            "dtype": "float32",
        },
    }


def test_schema_v3_requires_exact_preprocessing_contract() -> None:
    _validate_preprocessing_manifest(_manifest())

    invalid = _manifest()
    invalid["preprocessing"]["resize_interpolation"] = "linear"
    with pytest.raises(RuntimeError, match="preprocessing contract"):
        _validate_preprocessing_manifest(invalid)


def test_schema_v3_requires_one_express_derm_runtime_model() -> None:
    _validate_model_identity_manifest(_manifest())

    invalid = _manifest()
    invalid["external_runtime_models"] = ["another-model"]
    with pytest.raises(RuntimeError, match="runtime identity contract"):
        _validate_model_identity_manifest(invalid)


def test_schema_v4_requires_two_named_internal_models() -> None:
    manifest = _manifest()
    manifest.update(
        {
            "schema_version": 4,
            "runtime_identity": "express-derm-dual",
            "runtime_model_count": 2,
            "models": [
                {
                    "role": "melanoma_attention",
                    "filename": "model.onnx",
                    "preprocessing": manifest["preprocessing"],
                },
                {
                    "role": "broad_malignancy_attention",
                    "filename": "model-broad.onnx",
                    "preprocessing": manifest["preprocessing"],
                },
            ],
            "decision_policy": {
                "version": "dual-center-scale-confirmation-v1"
            },
        }
    )

    _validate_preprocessing_manifest(manifest)
    _validate_model_identity_manifest(manifest)

    invalid = {**manifest, "runtime_model_count": 1}
    with pytest.raises(RuntimeError, match="runtime identity contract"):
        _validate_model_identity_manifest(invalid)


def test_legacy_manifest_remains_loadable() -> None:
    _validate_preprocessing_manifest({"schema_version": 2})
    _validate_model_identity_manifest({"schema_version": 2})
