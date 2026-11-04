from app.db import Audit
from sqlalchemy import select
from test_workflow import command, current, generate_prd, prepare


def test_domains_excluded_atomically_with_shared_reason_and_audit(owner):
    app, client, sid = prepare(owner)
    before = current(client, sid)
    selected = [c for c in before["controls"] if c["included"]]
    domains = list(dict.fromkeys(c["domain"] for c in selected))[:2]
    first = selected[0]
    command(client, sid, "controls", {"control_id": first["id"], "included": False, "reason": "Prior reason"})
    result = command(client, sid, "controls/exclude-domains", {"domains": domains, "reason": " Shared reason "}).json()
    for control in result["controls"]:
        if control["id"] == first["id"]:
            assert control["reason"] == "Prior reason"
        elif control["domain"] in domains:
            assert not control["included"]
            assert control["reason"] == "Shared reason"
        else:
            assert control == next(c for c in before["controls"] if c["id"] == control["id"])
    with app.state.sessions() as db:
        audit = db.scalar(select(Audit).where(Audit.system_id == sid, Audit.action == "control.domains_excluded"))
        assert audit.detail["reason"] == "Shared reason"
        assert first["id"] not in audit.detail["control_ids"]


def test_invalid_or_stale_bulk_request_does_not_change_controls(owner):
    _, client, sid = prepare(owner)
    before = current(client, sid)
    domain = next(c["domain"] for c in before["controls"] if c["included"])
    for body in [{"domains": [domain], "reason": " "}, {"domains": [], "reason": "Reason"},
                 {"domains": [domain, "missing"], "reason": "Reason"}]:
        response = client.post(f"/api/v1/systems/{sid}/controls/exclude-domains",
                               json={"version": before["system"]["version"], **body})
        assert response.status_code in (409, 422)
        assert current(client, sid)["controls"] == before["controls"]
    response = client.post(f"/api/v1/systems/{sid}/controls/exclude-domains",
                           json={"version": -1, "domains": [domain], "reason": "Reason"})
    assert response.status_code == 409
    assert current(client, sid)["controls"] == before["controls"]


def test_bulk_exclusion_rejects_post_review_state(owner):
    _, client, sid = generate_prd(owner)
    before = current(client, sid)
    domain = next(c["domain"] for c in before["controls"] if c["included"])
    command(client, sid, "controls/exclude-domains", {"domains": [domain], "reason": "Reason"}, expected=409)
    assert current(client, sid)["controls"] == before["controls"]
