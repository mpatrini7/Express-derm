from __future__ import annotations

import shutil
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from .config import settings

ALLOWED_MIME_TYPES = {"image/jpeg", "image/png", "image/webp"}
EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


@dataclass(frozen=True)
class StagedFileDeletion:
    original_path: Path
    staged_path: Path


async def read_upload(file: UploadFile) -> bytes:
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=415, detail="Only JPEG, PNG and WebP are supported")

    content = await file.read()
    max_bytes = settings.max_upload_mb * 1024 * 1024
    if not content:
        raise HTTPException(status_code=400, detail="Empty upload")
    if len(content) > max_bytes:
        raise HTTPException(status_code=413, detail="Image exceeds upload limit")
    return content


def save_upload(
    content: bytes,
    mime_type: str,
    patient_id: int,
    lesion_id: int,
) -> str:
    relative_dir = Path(str(patient_id)) / str(lesion_id)
    target_dir = settings.image_dir / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)

    filename = f"{uuid4().hex}{EXTENSIONS[mime_type]}"
    target = target_dir / filename
    target.write_bytes(content)

    relative_path = (Path("images") / relative_dir / filename).as_posix()
    return relative_path


def save_encoded_jpeg(
    encoded: bytes,
    patient_id: int,
    lesion_id: int,
) -> str:
    relative_dir = Path(str(patient_id)) / str(lesion_id)
    target_dir = settings.image_dir / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.jpg"
    (target_dir / filename).write_bytes(encoded)
    return (Path("images") / relative_dir / filename).as_posix()


def save_clinical_photo(
    content: bytes,
    mime_type: str,
    patient_id: int,
) -> str:
    relative_dir = Path(str(patient_id)) / "clinical-photos"
    target_dir = settings.image_dir / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}{EXTENSIONS[mime_type]}"
    (target_dir / filename).write_bytes(content)
    return (Path("images") / relative_dir / filename).as_posix()


def save_clinical_candidate(
    encoded: bytes,
    patient_id: int,
) -> str:
    relative_dir = Path(str(patient_id)) / "clinical-candidates"
    target_dir = settings.image_dir / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}.jpg"
    (target_dir / filename).write_bytes(encoded)
    return (Path("images") / relative_dir / filename).as_posix()


def save_calibration_reference(
    content: bytes,
    mime_type: str,
    reference_type: str,
) -> str:
    relative_dir = Path("_calibration") / reference_type
    target_dir = settings.image_dir / relative_dir
    target_dir.mkdir(parents=True, exist_ok=True)
    filename = f"{uuid4().hex}{EXTENSIONS[mime_type]}"
    (target_dir / filename).write_bytes(content)
    return (Path("images") / relative_dir / filename).as_posix()


def delete_stored_file(relative_path: str) -> None:
    path = settings.data_dir / relative_path
    try:
        path.resolve().relative_to(settings.image_dir.resolve())
    except ValueError:
        return
    path.unlink(missing_ok=True)


def stage_stored_file_deletion(
    relative_path: str,
) -> StagedFileDeletion | None:
    path = settings.data_dir / relative_path
    try:
        path.resolve().relative_to(settings.image_dir.resolve())
    except ValueError as exc:
        raise RuntimeError("Stored image path is outside the image root") from exc
    if not path.exists():
        return None
    if not path.is_file():
        raise RuntimeError("Stored image path is not a regular file")

    staged_path = path.with_name(f".{path.name}.deleting-{uuid4().hex}")
    path.replace(staged_path)
    return StagedFileDeletion(
        original_path=path,
        staged_path=staged_path,
    )


def restore_staged_file_deletion(staged: StagedFileDeletion | None) -> None:
    if staged is None or not staged.staged_path.exists():
        return
    staged.staged_path.replace(staged.original_path)


def finalize_staged_file_deletion(staged: StagedFileDeletion | None) -> None:
    if staged is None:
        return
    staged.staged_path.unlink(missing_ok=True)


def delete_lesion_files(patient_id: int, lesion_id: int) -> None:
    _delete_image_tree(Path(str(patient_id)) / str(lesion_id))


def delete_patient_files(patient_id: int) -> None:
    _delete_image_tree(Path(str(patient_id)))


def _delete_image_tree(relative_path: Path) -> None:
    target = settings.image_dir / relative_path
    try:
        target.resolve().relative_to(settings.image_dir.resolve())
    except ValueError:
        return
    shutil.rmtree(target, ignore_errors=True)
