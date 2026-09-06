from app.main import health
from app.risk_policy import FOLLOW_UP_POLICY_VERSION


def test_health_exposes_current_follow_up_policy() -> None:
    assert health() == {
        "status": "ok",
        "follow_up_policy_version": FOLLOW_UP_POLICY_VERSION,
    }
