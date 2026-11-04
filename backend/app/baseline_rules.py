"""Shared baseline invariants; workflow-specific approval policy stays in services."""

from .domain import DomainError


def validate_current_baseline(baseline_id, current_id, content_hash, expected_hash):
    if baseline_id != current_id or content_hash != expected_hash:
        raise DomainError("BASELINE_CHANGED", 409)


def validate_confirmations(confirmations, content_hash, required_parties):
    """Callers supply server-owned policy, never a client-selected bypass."""
    if {item.party for item in confirmations} != set(required_parties):
        raise DomainError("BOTH_CONFIRMATIONS_REQUIRED", 409)
    if len({item.actor_id for item in confirmations}) != len(required_parties) or any(
        item.content_hash != content_hash for item in confirmations
    ):
        raise DomainError("BASELINE_CHANGED", 409)
