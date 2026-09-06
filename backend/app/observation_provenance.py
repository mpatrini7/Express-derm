from .models import Observation

LEGACY_UNCONFIRMED_UPLOAD_DEVICE_ID = "upload"
MANUAL_UPLOAD_SOURCE_PREFIX = "manual-upload:"
CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID = (
    f"{MANUAL_UPLOAD_SOURCE_PREFIX}usb-microscope-confirmed"
)
CONFIRMED_CLINICAL_PHOTO_DEVICE_ID = "clinical-photo:operator-confirmed"
MANUAL_UPLOAD_BODY_PHOTO_DEVICE_ID = f"{MANUAL_UPLOAD_SOURCE_PREFIX}body-photo"
MANUAL_UPLOAD_OTHER_IMAGE_DEVICE_ID = f"{MANUAL_UPLOAD_SOURCE_PREFIX}other-image"


def is_upload_device_id(device_id: str) -> bool:
    return device_id == LEGACY_UNCONFIRMED_UPLOAD_DEVICE_ID or device_id.startswith(
        MANUAL_UPLOAD_SOURCE_PREFIX
    )


def has_confirmed_microscope_source(observation: Observation) -> bool:
    if observation.device_id == CONFIRMED_CLINICAL_PHOTO_DEVICE_ID:
        return True
    if is_upload_device_id(observation.device_id):
        return observation.device_id == CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID
    return True


def infer_observation_source_type(device_id: str) -> str:
    if device_id == CONFIRMED_CLINICAL_PHOTO_DEVICE_ID:
        return "clinical_photo_candidate"
    if device_id == LEGACY_UNCONFIRMED_UPLOAD_DEVICE_ID:
        return "legacy_upload"
    if device_id == CONFIRMED_MANUAL_MICROSCOPE_DEVICE_ID:
        return "manual_microscope"
    if device_id == MANUAL_UPLOAD_BODY_PHOTO_DEVICE_ID:
        return "manual_body_photo"
    if device_id == MANUAL_UPLOAD_OTHER_IMAGE_DEVICE_ID:
        return "manual_other_image"
    if is_upload_device_id(device_id):
        return "manual_other_image"
    return "microscope_capture"
