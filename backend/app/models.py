from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Patient(Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_code: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    birth_year: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    lesions: Mapped[list["Lesion"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )
    clinical_photos: Mapped[list["ClinicalPhoto"]] = relationship(
        back_populates="patient", cascade="all, delete-orphan"
    )


class AppCounter(Base):
    __tablename__ = "app_counters"

    name: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Lesion(Base):
    __tablename__ = "lesions"
    __table_args__ = (
        UniqueConstraint("patient_id", "lesion_code", name="uq_patient_lesion_code"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), index=True
    )
    lesion_code: Mapped[str] = mapped_column(String(32))
    body_part: Mapped[str] = mapped_column(String(80))
    x: Mapped[float] = mapped_column(Float)
    y: Mapped[float] = mapped_column(Float)
    z: Mapped[float] = mapped_column(Float)
    label: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    patient: Mapped["Patient"] = relationship(back_populates="lesions")
    observations: Mapped[list["Observation"]] = relationship(
        back_populates="lesion",
        cascade="all, delete-orphan",
        order_by="Observation.captured_at.desc()",
    )
    audit_events: Mapped[list["LesionAuditEvent"]] = relationship(
        back_populates="lesion",
        cascade="all, delete-orphan",
        order_by="LesionAuditEvent.created_at.desc()",
    )
    longitudinal_reviews: Mapped[list["LongitudinalReview"]] = relationship(
        back_populates="lesion",
        cascade="all, delete-orphan",
        order_by="LongitudinalReview.created_at.desc()",
    )


class LesionAuditEvent(Base):
    __tablename__ = "lesion_audit_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesion_id: Mapped[int] = mapped_column(
        ForeignKey("lesions.id", ondelete="CASCADE"),
        index=True,
    )
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    previous_state: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    current_state: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    change_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )

    lesion: Mapped["Lesion"] = relationship(back_populates="audit_events")


class Observation(Base):
    __tablename__ = "observations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesion_id: Mapped[int] = mapped_column(
        ForeignKey("lesions.id", ondelete="CASCADE"), index=True
    )
    captured_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    microscope_image_path: Mapped[str] = mapped_column(String(512))
    original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(80))
    device_id: Mapped[str] = mapped_column(String(128), default="upload")
    focus_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mean_brightness: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    dark_fraction: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    bright_fraction: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    quality_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    quality_status: Mapped[str] = mapped_column(String(32), default="manual")
    quality_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    ai_result_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    lesion: Mapped["Lesion"] = relationship(back_populates="observations")
    model_runs: Mapped[list["ModelRun"]] = relationship(
        back_populates="observation",
        cascade="all, delete-orphan",
        order_by="ModelRun.created_at.desc()",
    )
    acquisition: Mapped[Optional["ObservationAcquisition"]] = relationship(
        back_populates="observation",
        cascade="all, delete-orphan",
        uselist=False,
    )


class ClinicalPhoto(Base):
    __tablename__ = "clinical_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), index=True
    )
    image_path: Mapped[str] = mapped_column(String(512), nullable=False)
    original_filename: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    mime_type: Mapped[str] = mapped_column(String(80), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    quality_score: Mapped[float] = mapped_column(Float, nullable=False)
    focus_score: Mapped[float] = mapped_column(Float, nullable=False)
    mean_brightness: Mapped[float] = mapped_column(Float, nullable=False)
    dark_fraction: Mapped[float] = mapped_column(Float, nullable=False)
    bright_fraction: Mapped[float] = mapped_column(Float, nullable=False)
    quality_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    patient: Mapped["Patient"] = relationship(back_populates="clinical_photos")
    candidates: Mapped[list["ClinicalPhotoCandidate"]] = relationship(
        back_populates="clinical_photo",
        cascade="all, delete-orphan",
        order_by="ClinicalPhotoCandidate.candidate_index.asc()",
    )


class ClinicalPhotoCandidate(Base):
    __tablename__ = "clinical_photo_candidates"
    __table_args__ = (
        UniqueConstraint(
            "clinical_photo_id",
            "candidate_index",
            name="uq_clinical_photo_candidate_index",
        ),
        CheckConstraint(
            "status IN ('pending', 'assigned', 'dismissed')",
            name="ck_clinical_photo_candidate_status",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    clinical_photo_id: Mapped[int] = mapped_column(
        ForeignKey("clinical_photos.id", ondelete="CASCADE"), index=True
    )
    candidate_index: Mapped[int] = mapped_column(Integer, nullable=False)
    crop_image_path: Mapped[str] = mapped_column(String(512), nullable=False)
    bbox_x: Mapped[int] = mapped_column(Integer, nullable=False)
    bbox_y: Mapped[int] = mapped_column(Integer, nullable=False)
    bbox_width: Mapped[int] = mapped_column(Integer, nullable=False)
    bbox_height: Mapped[int] = mapped_column(Integer, nullable=False)
    detection_score: Mapped[float] = mapped_column(Float, nullable=False)
    quality_score: Mapped[float] = mapped_column(Float, nullable=False)
    focus_score: Mapped[float] = mapped_column(Float, nullable=False)
    mean_brightness: Mapped[float] = mapped_column(Float, nullable=False)
    dark_fraction: Mapped[float] = mapped_column(Float, nullable=False)
    bright_fraction: Mapped[float] = mapped_column(Float, nullable=False)
    quality_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending")
    assigned_lesion_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("lesions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    assigned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    clinical_photo: Mapped["ClinicalPhoto"] = relationship(back_populates="candidates")


class LongitudinalReview(Base):
    __tablename__ = "longitudinal_reviews"
    __table_args__ = (
        CheckConstraint(
            "baseline_observation_id <> comparison_observation_id",
            name="ck_longitudinal_reviews_distinct_observations",
        ),
        CheckConstraint(
            "change_flag IN "
            "('no_visible_change', 'change_observed', 'uncertain')",
            name="ck_longitudinal_reviews_change_flag",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesion_id: Mapped[int] = mapped_column(
        ForeignKey("lesions.id", ondelete="CASCADE"),
        index=True,
    )
    baseline_observation_id: Mapped[int] = mapped_column(
        ForeignKey("observations.id", ondelete="CASCADE"),
    )
    comparison_observation_id: Mapped[int] = mapped_column(
        ForeignKey("observations.id", ondelete="CASCADE"),
    )
    change_flag: Mapped[str] = mapped_column(String(32), nullable=False)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )

    lesion: Mapped["Lesion"] = relationship(
        back_populates="longitudinal_reviews",
    )


class AcquisitionSetup(Base):
    __tablename__ = "acquisition_setup"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    name: Mapped[str] = mapped_column(
        String(128),
        nullable=False,
        default="Primary microscope protocol",
    )
    magnification_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    orientation: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="cranial_up",
    )
    spacer_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    illumination: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        default="integrated_led",
    )
    exposure: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gain: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    white_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    focus_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    min_brightness: Mapped[float] = mapped_column(Float, nullable=False)
    max_brightness: Mapped[float] = mapped_column(Float, nullable=False)
    thresholds_status: Mapped[str] = mapped_column(
        String(32),
        nullable=False,
        default="provisional",
    )
    scale_reference_path: Mapped[Optional[str]] = mapped_column(
        String(512),
        nullable=True,
    )
    color_reference_path: Mapped[Optional[str]] = mapped_column(
        String(512),
        nullable=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
    )


class ObservationAcquisition(Base):
    __tablename__ = "observation_acquisition"

    observation_id: Mapped[int] = mapped_column(
        ForeignKey("observations.id", ondelete="CASCADE"),
        primary_key=True,
    )
    protocol_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    protocol_name: Mapped[str] = mapped_column(String(128), nullable=False)
    protocol_status: Mapped[str] = mapped_column(String(32), nullable=False)
    device_path: Mapped[str] = mapped_column(String(255), nullable=False)
    device_name: Mapped[str] = mapped_column(String(255), nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    pixel_format: Mapped[str] = mapped_column(String(32), nullable=False)
    frame_rate: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    exposure: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    gain: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    white_balance: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    magnification_x: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    orientation: Mapped[str] = mapped_column(String(32), nullable=False)
    spacer_id: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    illumination: Mapped[str] = mapped_column(String(64), nullable=False)
    focus_threshold: Mapped[float] = mapped_column(Float, nullable=False)
    min_brightness: Mapped[float] = mapped_column(Float, nullable=False)
    max_brightness: Mapped[float] = mapped_column(Float, nullable=False)
    thresholds_status: Mapped[str] = mapped_column(String(32), nullable=False)
    scale_reference_path: Mapped[Optional[str]] = mapped_column(
        String(512),
        nullable=True,
    )
    color_reference_path: Mapped[Optional[str]] = mapped_column(
        String(512),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
    )

    observation: Mapped["Observation"] = relationship(
        back_populates="acquisition",
    )


class ModelRun(Base):
    __tablename__ = "model_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    observation_id: Mapped[int] = mapped_column(
        ForeignKey("observations.id", ondelete="CASCADE"), index=True
    )
    model_version: Mapped[str] = mapped_column(String(128))
    model_hash: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    backend: Mapped[str] = mapped_column(String(64))
    score: Mapped[float] = mapped_column(Float)
    confidence: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    attention_level: Mapped[str] = mapped_column(String(32))
    abstained: Mapped[bool] = mapped_column(Boolean, default=False)
    abstention_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    validation_status: Mapped[str] = mapped_column(String(64))
    domain_status: Mapped[str] = mapped_column(String(64))
    latency_ms: Mapped[float] = mapped_column(Float)
    result_json: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    observation: Mapped["Observation"] = relationship(back_populates="model_runs")
