import type { Observation } from "./types";

export const LEGACY_UNCONFIRMED_UPLOAD_DEVICE_ID = "upload";
export const BODY_PHOTO_UPLOAD_DEVICE_ID = "manual-upload:body-photo";
export const OTHER_IMAGE_UPLOAD_DEVICE_ID = "manual-upload:other-image";
export const MANUAL_UPLOAD_PREFIX = "manual-upload:";
export const CLINICAL_PHOTO_DEVICE_ID = "clinical-photo:operator-confirmed";

export type UploadSourceType =
  | "microscope"
  | "body_photo"
  | "other_image"
  | "unknown";

export function hasConfirmedMicroscopeSource(
  observation: Pick<Observation, "device_id">,
) {
  return inferUploadSourceType(observation) === "microscope";
}

export function inferUploadSourceType(
  observation: Pick<Observation, "device_id">,
): UploadSourceType {
  if (observation.device_id === LEGACY_UNCONFIRMED_UPLOAD_DEVICE_ID) {
    return "unknown";
  }
  if (observation.device_id === CLINICAL_PHOTO_DEVICE_ID) {
    return "microscope";
  }
  if (observation.device_id === BODY_PHOTO_UPLOAD_DEVICE_ID) {
    return "body_photo";
  }
  if (observation.device_id === OTHER_IMAGE_UPLOAD_DEVICE_ID) {
    return "other_image";
  }
  if (
    observation.device_id.startsWith(MANUAL_UPLOAD_PREFIX) &&
    observation.device_id !== "manual-upload:usb-microscope-confirmed"
  ) {
    return "other_image";
  }
  return "microscope";
}

export function isAIEligibleObservation(observation: Observation) {
  return aiIneligibilityReason(observation) === null;
}

export function aiIneligibilityReason(observation: Observation) {
  if (observation.quality_status !== "accepted") {
    return "The image did not pass the quality gate.";
  }
  if (!hasConfirmedMicroscopeSource(observation)) {
    return "Only an operator-confirmed lesion image can be analyzed.";
  }
  return null;
}
