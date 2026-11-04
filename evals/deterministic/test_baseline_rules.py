from types import SimpleNamespace

import pytest

from app.baseline_rules import validate_confirmations, validate_current_baseline
from app.domain import DomainError


@pytest.mark.parametrize("parties,actors,hashes,code", [
    (["customer", "supplier"], ["a", "b"], ["h", "h"], None),
    (["customer"], ["a"], ["h"], "BOTH_CONFIRMATIONS_REQUIRED"),
    (["customer", "supplier"], ["a", "a"], ["h", "h"], "BASELINE_CHANGED"),
    (["customer", "supplier"], ["a", "b"], ["h", "old"], "BASELINE_CHANGED"),
])
def test_confirmation_invariants(parties, actors, hashes, code):
    rows = [SimpleNamespace(party=p, actor_id=a, content_hash=h)
            for p, a, h in zip(parties, actors, hashes)]
    if code:
        with pytest.raises(DomainError, match=code):
            validate_confirmations(rows, "h", ("customer", "supplier"))
    else:
        validate_confirmations(rows, "h", ("customer", "supplier"))


@pytest.mark.parametrize("current,expected", [("old", "h"), ("id", "old")])
def test_stale_baseline_rejected(current, expected):
    with pytest.raises(DomainError, match="BASELINE_CHANGED"):
        validate_current_baseline("id", current, "h", expected)
