from app.config import settings
from app.storage import (
    finalize_staged_file_deletion,
    restore_staged_file_deletion,
    stage_stored_file_deletion,
)


def test_staged_image_deletion_can_be_restored_or_finalized() -> None:
    relative_path = "images/1/2/test-image.png"
    image_path = settings.data_dir / relative_path
    image_path.parent.mkdir(parents=True, exist_ok=True)
    image_path.write_bytes(b"microscope image")

    first_stage = stage_stored_file_deletion(relative_path)
    assert first_stage is not None
    assert image_path.exists() is False
    assert first_stage.staged_path.is_file()

    restore_staged_file_deletion(first_stage)
    assert image_path.read_bytes() == b"microscope image"
    assert first_stage.staged_path.exists() is False

    second_stage = stage_stored_file_deletion(relative_path)
    assert second_stage is not None
    finalize_staged_file_deletion(second_stage)
    assert image_path.exists() is False
    assert second_stage.staged_path.exists() is False
