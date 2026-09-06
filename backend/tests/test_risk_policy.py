import json
from datetime import datetime, timezone

import pytest

from app.models import ModelRun
from app.risk_policy import _risk_fields


def research_run(attention_level: str) -> ModelRun:
    return ModelRun(
        observation_id=1,
        model_version="research-model-v1",
        model_hash="model-hash",
        backend="onnxruntime",
        score=0.5,
        confidence=None,
        attention_level=attention_level,
        abstained=False,
        abstention_reason=None,
        validation_status="research_only",
        domain_status="microscope_validation_pending",
        latency_ms=12,
        result_json=json.dumps({"thresholds_validated": False}),
        created_at=datetime(2026, 7, 25, 12, 0, tzinfo=timezone.utc),
    )


@pytest.mark.parametrize(
    ("attention_level", "expected_action", "expected_date"),
    [
        ("low", "monitor_12_months", "2027-07-25T12:00:00+00:00"),
        ("intermediate", "inconclusive", None),
        ("high", "professional_review", "2026-07-25T12:00:00+00:00"),
        ("uncertain", "inconclusive", None),
    ],
)
def test_research_attention_generates_automatic_follow_up(
    attention_level: str,
    expected_action: str,
    expected_date: str | None,
) -> None:
    fields = _risk_fields(research_run(attention_level), 1)

    assert fields["risk_status"] == "experimental"
    assert fields["attention_level"] == (
        "uncertain" if attention_level == "intermediate" else attention_level
    )
    assert fields["follow_up_action"] == expected_action
    actual_date = fields["next_check_at"]
    assert (
        actual_date.isoformat() if actual_date is not None else None
    ) == expected_date
