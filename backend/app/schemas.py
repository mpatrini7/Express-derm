from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

AttentionLevel = Literal["low", "intermediate", "high", "uncertain"]
RiskStatus = Literal["not_assessed", "experimental", "validated"]
FollowUpAction = Literal[
    "capture_required",
    "evaluate_required",
    "monitor_12_months",
    "professional_review",
    "inconclusive",
]


class PatientCreate(BaseModel):
    display_name: Optional[str] = Field(default=None, max_length=128)
    birth_year: Optional[int] = Field(
        default=None,
        ge=1900,
        le=datetime.now().year,
    )
    notes: Optional[str] = Field(default=None, max_length=4000)

    @field_validator("display_name", "notes", mode="before")
    @classmethod
    def normalize_optional_text(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class PatientUpdate(PatientCreate):
    pass


class PatientRead(PatientCreate):
    id: int
    patient_code: str
    created_at: datetime
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class PatientSummaryRead(PatientRead):
    mapped_lesions: int
    documented_lesions: int
    observation_count: int
    record_status: Literal["not_mapped", "needs_capture", "documented"]
    highest_attention_level: Optional[AttentionLevel] = None
    attention_status: RiskStatus = "not_assessed"
    last_activity_at: datetime
    next_check_at: Optional[datetime] = None


class LesionCreate(BaseModel):
    body_part: str = Field(min_length=1, max_length=80)
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    z: float = Field(allow_inf_nan=False)
    label: Optional[str] = Field(default=None, max_length=128)
    notes: Optional[str] = None


class LesionUpdate(LesionCreate):
    change_reason: Optional[str] = Field(default=None, max_length=512)


class LesionRead(LesionCreate):
    id: int
    patient_id: int
    lesion_code: str
    archived: bool
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class LesionSummaryRead(LesionRead):
    observation_count: int
    accepted_observation_count: int
    latest_observation_at: Optional[datetime]
    latest_accepted_observation_id: Optional[int]
    latest_accepted_image_path: Optional[str]
    last_activity_at: datetime
    attention_level: Optional[AttentionLevel]
    risk_status: RiskStatus
    risk_score: Optional[float]
    risk_confidence: Optional[float]
    risk_assessed_at: Optional[datetime]
    risk_model_version: Optional[str]
    risk_validation_status: Optional[str]
    risk_domain_status: Optional[str]
    follow_up_action: FollowUpAction
    next_check_at: Optional[datetime]


class LesionAuditEventRead(BaseModel):
    id: int
    lesion_id: int
    event_type: Literal["location", "details"]
    previous_state: dict[str, Any]
    current_state: dict[str, Any]
    change_reason: Optional[str]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ObservationRead(BaseModel):
    id: int
    lesion_id: int
    captured_at: datetime
    microscope_image_path: str
    original_filename: Optional[str]
    mime_type: str
    device_id: str
    focus_score: Optional[float]
    mean_brightness: Optional[float]
    dark_fraction: Optional[float]
    bright_fraction: Optional[float]
    quality_score: Optional[float] = Field(default=None, ge=0, le=100)
    quality_status: str
    quality_reason: Optional[str]
    notes: Optional[str]
    created_at: datetime
    acquisition: Optional["ObservationAcquisitionRead"] = None
    model_config = ConfigDict(from_attributes=True)


ClinicalPhotoCandidateStatus = Literal["pending", "assigned", "dismissed"]


class ClinicalPhotoCandidateRead(BaseModel):
    id: int
    clinical_photo_id: int
    candidate_index: int
    crop_image_path: str
    bbox_x: int
    bbox_y: int
    bbox_width: int
    bbox_height: int
    detection_score: float = Field(ge=0, le=100)
    quality_score: float = Field(ge=0, le=100)
    focus_score: float
    mean_brightness: float
    dark_fraction: float
    bright_fraction: float
    quality_reason: Optional[str]
    status: ClinicalPhotoCandidateStatus
    assigned_lesion_id: Optional[int]
    created_at: datetime
    assigned_at: Optional[datetime]
    model_config = ConfigDict(from_attributes=True)


class ClinicalPhotoRead(BaseModel):
    id: int
    patient_id: int
    image_path: str
    original_filename: Optional[str]
    mime_type: str
    width: int
    height: int
    quality_score: float = Field(ge=0, le=100)
    focus_score: float
    mean_brightness: float
    dark_fraction: float
    bright_fraction: float
    quality_reason: Optional[str]
    created_at: datetime
    candidates: list[ClinicalPhotoCandidateRead]
    model_config = ConfigDict(from_attributes=True)


class ClinicalPhotoCandidateAssign(BaseModel):
    body_part: str = Field(min_length=1, max_length=80)
    x: float = Field(allow_inf_nan=False)
    y: float = Field(allow_inf_nan=False)
    z: float = Field(allow_inf_nan=False)
    label: Optional[str] = Field(default=None, max_length=128)


class ClinicalPhotoCandidateAssignmentRead(BaseModel):
    candidate: ClinicalPhotoCandidateRead
    lesion: LesionSummaryRead
    observation: ObservationRead


LongitudinalChangeFlag = Literal[
    "no_visible_change",
    "change_observed",
    "uncertain",
]


class LongitudinalReviewCreate(BaseModel):
    baseline_observation_id: int = Field(gt=0)
    comparison_observation_id: int = Field(gt=0)
    change_flag: LongitudinalChangeFlag
    notes: Optional[str] = Field(default=None, max_length=2000)

    @model_validator(mode="after")
    def validate_distinct_observations(self):
        if self.baseline_observation_id == self.comparison_observation_id:
            raise ValueError("Baseline and comparison observations must differ")
        return self


class LongitudinalReviewRead(LongitudinalReviewCreate):
    id: int
    lesion_id: int
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ModelRunRead(BaseModel):
    id: int
    observation_id: int
    model_version: str
    model_hash: Optional[str]
    backend: str
    score: float
    attention_level: str
    abstained: bool
    abstention_reason: Optional[str]
    validation_status: str
    domain_status: str
    latency_ms: float
    result_json: str
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)


class AIStatus(BaseModel):
    enabled: bool
    ready: bool
    backend: str
    model_version: Optional[str]
    model_release: Optional[str] = None
    model_hash: Optional[str] = None
    validation_status: Optional[str]
    domain_status: Optional[str]
    reason: Optional[str]


class CameraMode(BaseModel):
    pixel_format: str
    width: int
    height: int
    fps: list[float]


class CameraDevice(BaseModel):
    path: str
    name: str
    is_mock: bool = False
    modes: list[CameraMode] = Field(default_factory=list)


class AcquisitionSetupUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    magnification_x: Optional[float] = Field(default=None, ge=1, le=2000)
    orientation: Literal["cranial_up", "caudal_up"]
    spacer_id: Optional[str] = Field(default=None, max_length=128)
    illumination: Literal[
        "integrated_led",
        "cross_polarized",
        "external_controlled",
    ]
    exposure: Optional[float] = None
    gain: Optional[float] = None
    white_balance: Optional[float] = None
    focus_threshold: float = Field(ge=0)
    min_brightness: float = Field(ge=0, le=255)
    max_brightness: float = Field(ge=0, le=255)
    thresholds_status: Literal["provisional", "calibrated"]

    @model_validator(mode="after")
    def validate_brightness_range(self):
        if self.min_brightness >= self.max_brightness:
            raise ValueError(
                "Minimum brightness must be lower than maximum brightness"
            )
        return self


class AcquisitionSetupRead(AcquisitionSetupUpdate):
    id: int
    revision: int
    scale_reference_path: Optional[str]
    color_reference_path: Optional[str]
    capture_ready: bool
    protocol_status: Literal[
        "incomplete",
        "reference_pending",
        "provisional",
        "validated",
    ]
    updated_at: datetime
    model_config = ConfigDict(from_attributes=True)


class ObservationAcquisitionRead(BaseModel):
    protocol_revision: int
    protocol_name: str
    protocol_status: str
    device_path: str
    device_name: str
    width: int
    height: int
    pixel_format: str
    frame_rate: Optional[float]
    exposure: Optional[float]
    gain: Optional[float]
    white_balance: Optional[float]
    magnification_x: Optional[float]
    orientation: str
    spacer_id: Optional[str]
    illumination: str
    focus_threshold: float
    min_brightness: float
    max_brightness: float
    thresholds_status: str
    scale_reference_path: Optional[str]
    color_reference_path: Optional[str]
    created_at: datetime
    model_config = ConfigDict(from_attributes=True)
