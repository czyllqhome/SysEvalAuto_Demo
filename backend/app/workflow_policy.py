"""Small shared policy boundary; domain rules remain in their owning services."""
from .db import AssessmentProfile

EXISTING_STATES = ('VERIFYING', 'GAP_REVIEW', 'REMEDIATING', 'ACCEPTED_RISKS', 'ASSESSMENT_COMPLETE')


def revision_states(db, system):
    profile = db.get(AssessmentProfile, system.id)
    return EXISTING_STATES if profile and profile.kind == 'existing' else ()
