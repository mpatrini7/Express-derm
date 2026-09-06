from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
WORKER_SOURCE = ROOT / "cpp" / "ai_worker" / "src" / "main.cpp"


def test_cpp_worker_uses_persistent_tensorrt_10_runtime() -> None:
    source = WORKER_SOURCE.read_text(encoding="utf-8")

    assert "NV_TENSORRT_MAJOR >= 10" in source
    assert source.count("deserializeCudaEngine(") == 1
    assert "createExecutionContext()" in source
    assert "setTensorAddress(" in source
    assert "enqueueV3(" in source
    assert "UnixServer server" in source
    assert source.index("TensorRTEngine engine") < source.index(
        "server.run(manifest, engine"
    )
    assert "popen(" not in source
    assert "system(" not in source


def test_cpp_worker_rechecks_provenance_paths_and_model_identity() -> None:
    source = WORKER_SOURCE.read_text(encoding="utf-8")

    assert '"accepted"' in source
    assert '"microscope_source_confirmed"' in source
    assert '"acquisition_protocol_status"' in source
    assert 'protocol->get<std::string>() == "validated"' not in source
    assert '"INELIGIBLE_OBSERVATION"' in source
    assert '"IMAGE_PATH_REJECTED"' in source
    assert "path_is_within(resolved, image_root)" in source
    assert "sha256_file(model_path) != manifest.model_sha256" in source
    assert "sha256_file(engine_path) != manifest.engine_sha256" in source
    assert '"inference_backend", "tensorrt_cpp"' in source
    assert '"model_release", release_version' in source
    assert 'kDecisionPolicyVersion = "binary-extremes-v1"' in source
    assert 'attention_level = "intermediate"' not in source
    assert "score >= manifest.low_threshold" in source
    assert "score < manifest.high_threshold" in source
    assert (
        "opencv_imread_bgr2rgb_inter_area_stretch_imagenet_nchw_float32_v1"
        in source
    )
    assert "Unsupported preprocessing contract" in source


def test_scan_profile_selects_the_self_contained_dual_runtime() -> None:
    profile = (ROOT / "scripts" / "scanner.env").read_text(encoding="utf-8")
    launcher = (ROOT / "scripts" / "start_project.sh").read_text(
        encoding="utf-8"
    )

    assert "EXPRESS_DERM_AI_BACKEND=onnxruntime" in profile
    assert "EXPRESS_DERM_AI_MODEL_DIR=models/express-derm-1" in profile
    assert "EXPRESS_DERM_AI_WORKER_BINARY=" not in profile
    assert "EXPRESS_DERM_AI_WORKER_SOCKET=" not in profile
    assert 'AI_BACKEND" == "tensorrt_cpp"' in launcher
    assert '"$WORKER_BINARY" \\' in launcher
    assert "--image-root" in launcher
