export type AttentionLevel = "low" | "intermediate" | "high" | "uncertain";
export type RiskStatus = "not_assessed" | "experimental" | "validated";
export type FollowUpAction =
  | "capture_required"
  | "evaluate_required"
  | "monitor_12_months"
  | "professional_review"
  | "inconclusive";

export interface Patient {
  id: number;
  patient_code: string;
  display_name: string | null;
  birth_year: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  mapped_lesions: number;
  documented_lesions: number;
  observation_count: number;
  record_status: "not_mapped" | "needs_capture" | "documented";
  highest_attention_level: AttentionLevel | null;
  attention_status: RiskStatus;
  last_activity_at: string;
  next_check_at: string | null;
}

export interface PatientProfileInput {
  display_name: string | null;
  birth_year: number | null;
  notes: string | null;
}

export interface Lesion {
  id: number;
  patient_id: number;
  lesion_code: string;
  body_part: string;
  x: number;
  y: number;
  z: number;
  label: string | null;
  notes: string | null;
  archived: boolean;
  created_at: string;
  observation_count: number;
  accepted_observation_count: number;
  latest_observation_at: string | null;
  latest_accepted_observation_id: number | null;
  latest_accepted_image_path: string | null;
  last_activity_at: string;
  attention_level: AttentionLevel | null;
  risk_status: RiskStatus;
  risk_score: number | null;
  risk_confidence: number | null;
  risk_assessed_at: string | null;
  risk_model_version: string | null;
  risk_validation_status: string | null;
  risk_domain_status: string | null;
  follow_up_action: FollowUpAction;
  next_check_at: string | null;
}

export interface LesionEditableState {
  body_part: string;
  x: number;
  y: number;
  z: number;
  label: string | null;
  notes: string | null;
}

export interface LesionAuditEvent {
  id: number;
  lesion_id: number;
  event_type: "location" | "details";
  previous_state: LesionEditableState;
  current_state: LesionEditableState;
  change_reason: string | null;
  created_at: string;
}

export interface Observation {
  id: number;
  lesion_id: number;
  captured_at: string;
  microscope_image_path: string;
  original_filename: string | null;
  mime_type: string;
  device_id: string;
  focus_score: number | null;
  mean_brightness: number | null;
  dark_fraction: number | null;
  bright_fraction: number | null;
  quality_score: number | null;
  quality_status: string;
  quality_reason: string | null;
  notes: string | null;
  created_at: string;
  acquisition: ObservationAcquisition | null;
}

export type ClinicalPhotoCandidateStatus = "pending" | "assigned" | "dismissed";

export interface ClinicalPhotoCandidate {
  id: number;
  clinical_photo_id: number;
  candidate_index: number;
  crop_image_path: string;
  bbox_x: number;
  bbox_y: number;
  bbox_width: number;
  bbox_height: number;
  detection_score: number;
  quality_score: number;
  focus_score: number;
  mean_brightness: number;
  dark_fraction: number;
  bright_fraction: number;
  quality_reason: string | null;
  status: ClinicalPhotoCandidateStatus;
  assigned_lesion_id: number | null;
  created_at: string;
  assigned_at: string | null;
}

export interface ClinicalPhoto {
  id: number;
  patient_id: number;
  image_path: string;
  original_filename: string | null;
  mime_type: string;
  width: number;
  height: number;
  quality_score: number;
  focus_score: number;
  mean_brightness: number;
  dark_fraction: number;
  bright_fraction: number;
  quality_reason: string | null;
  created_at: string;
  candidates: ClinicalPhotoCandidate[];
}

export interface ClinicalPhotoCandidateAssignment {
  candidate: ClinicalPhotoCandidate;
  lesion: Lesion;
  observation: Observation;
}

export type LongitudinalChangeFlag =
  | "no_visible_change"
  | "change_observed"
  | "uncertain";

export interface LongitudinalReview {
  id: number;
  lesion_id: number;
  baseline_observation_id: number;
  comparison_observation_id: number;
  change_flag: LongitudinalChangeFlag;
  notes: string | null;
  created_at: string;
}

export type LongitudinalReviewCreate = Pick<
  LongitudinalReview,
  | "baseline_observation_id"
  | "comparison_observation_id"
  | "change_flag"
  | "notes"
>;

export interface ModelRun {
  id: number;
  observation_id: number;
  model_version: string;
  model_hash: string | null;
  backend: string;
  score: number;
  attention_level: AttentionLevel;
  abstained: boolean;
  abstention_reason: string | null;
  validation_status: string;
  domain_status: string;
  latency_ms: number;
  result_json: string;
  created_at: string;
}

export type DualCombinedLabel =
  | "high_confirmed"
  | "review"
  | "no_elevated_signal";

export interface AISignalResult {
  model_version: string;
  model_sha256: string;
  target: string;
  view_names: string[];
  view_scores: number[];
  consensus_level: AttentionLevel;
  low_threshold: number;
  high_threshold: number;
  thresholds_validated: boolean;
}

export interface DualAIResultPayload {
  decision_policy_version: "dual-center-scale-confirmation-v1";
  combined_label: DualCombinedLabel;
  signals: {
    melanoma_attention: AISignalResult;
    broad_malignancy_attention: AISignalResult;
  };
}

export interface AIStatus {
  enabled: boolean;
  ready: boolean;
  backend: string;
  model_version: string | null;
  model_release?: string | null;
  model_hash?: string | null;
  validation_status: string | null;
  domain_status: string | null;
  reason: string | null;
}

export interface CameraMode {
  pixel_format: string;
  width: number;
  height: number;
  fps: number[];
}

export interface CameraDevice {
  path: string;
  name: string;
  is_mock: boolean;
  modes: CameraMode[];
}

export type ProtocolStatus =
  | "incomplete"
  | "reference_pending"
  | "provisional"
  | "validated";

export interface AcquisitionSetup {
  id: number;
  revision: number;
  name: string;
  magnification_x: number | null;
  orientation: "cranial_up" | "caudal_up";
  spacer_id: string | null;
  illumination:
    | "integrated_led"
    | "cross_polarized"
    | "external_controlled";
  exposure: number | null;
  gain: number | null;
  white_balance: number | null;
  focus_threshold: number;
  min_brightness: number;
  max_brightness: number;
  thresholds_status: "provisional" | "calibrated";
  scale_reference_path: string | null;
  color_reference_path: string | null;
  capture_ready: boolean;
  protocol_status: ProtocolStatus;
  updated_at: string;
}

export type AcquisitionSetupUpdate = Omit<
  AcquisitionSetup,
  | "id"
  | "revision"
  | "scale_reference_path"
  | "color_reference_path"
  | "capture_ready"
  | "protocol_status"
  | "updated_at"
>;

export interface ObservationAcquisition {
  protocol_revision: number;
  protocol_name: string;
  protocol_status: ProtocolStatus;
  device_path: string;
  device_name: string;
  width: number;
  height: number;
  pixel_format: string;
  frame_rate: number | null;
  exposure: number | null;
  gain: number | null;
  white_balance: number | null;
  magnification_x: number | null;
  orientation: string;
  spacer_id: string | null;
  illumination: string;
  focus_threshold: number;
  min_brightness: number;
  max_brightness: number;
  thresholds_status: string;
  scale_reference_path: string | null;
  color_reference_path: string | null;
  created_at: string;
}
