"""Tests for sync_incidents.py (real dashboard incidents -> GRC). No database and no network needed."""
import pytest

import sync_incidents as s
from app.risk_live_scoring import counted_incidents, parse_ts


class FakeCollection:
    """Just enough of a MongoDB collection for the sync script."""

    def __init__(self, docs=()):
        self.docs = [dict(d) for d in docs]

    def delete_many(self, q):
        keep = [d for d in self.docs if not all(d.get(k) == v for k, v in q.items())]
        n, self.docs = len(self.docs) - len(keep), keep
        return type("R", (), {"deleted_count": n})

    def replace_one(self, q, doc, upsert=False):
        for i, d in enumerate(self.docs):
            if all(d.get(k) == v for k, v in q.items()):
                self.docs[i] = dict(doc)
                return
        if upsert:
            self.docs.append(dict(doc))


def incident(**kw):
    base = dict(id="INC-AAA111", ip="198.51.100.9", severity="High", status="Open", count=12,
                start="2026-11-20 09:00:00", end="2026-11-20 09:20:00", types={"SQL Injection": 12},
                techniques=["T1190"], sources=["haproxy"], engines=["rate"])
    return {**base, **kw}


def test_sql_injection_hits_the_website_and_its_database():
    assert s.assets_for(["SQL Injection"]) == ["AST-001", "AST-004"]


def test_each_kind_of_attack_lands_on_the_expected_asset():
    assert s.assets_for(["Brute Force (login)"]) == ["AST-003"]
    assert s.assets_for(["Credential Stuffing"]) == ["AST-003"]
    assert s.assets_for(["DoS/DDoS (HTTP flood)"]) == ["AST-001", "AST-005"]
    assert s.assets_for(["Port Scan"]) == ["AST-005"]
    assert s.assets_for(["Path Traversal"]) == ["AST-001"]
    assert s.assets_for(["Admin panel probe"]) == ["AST-002"]


def test_unknown_attack_falls_back_to_haproxy_and_no_types_too():
    assert s.assets_for(["Something new"]) == s.DEFAULT_ASSETS
    assert s.assets_for([]) == s.DEFAULT_ASSETS


def test_several_attack_types_give_each_asset_once():
    assert s.assets_for(["SQL Injection", "Path Traversal", "Port Scan"]) == ["AST-001", "AST-004", "AST-005"]


def test_incident_is_converted_to_the_grc_shape():
    d = s.map_incident(incident())
    assert d["incident_id"] == "INC-AAA111" and d["src_ip"] == "198.51.100.9"
    assert d["affected_assets"] == ["AST-001", "AST-004"]
    assert d["first_seen"] == "2026-11-20T09:00:00Z" and d["last_seen"] == "2026-11-20T09:20:00Z"
    assert d["severity"] == "high" and d["status"] == "open" and d["source"] == s.SOURCE
    assert d["attack_families"] == ["SQL Injection"] and d["techniques"] == ["T1190"]


def test_status_words_are_translated():
    assert s.map_incident(incident(status="Investigating"))["status"] == "investigating"
    assert s.map_incident(incident(status="Closed"))["status"] == "closed"
    assert s.map_incident(incident(status="???"))["status"] == "open"


def test_incident_made_only_of_demo_alerts_is_skipped():
    assert s.map_incident(incident(sources=["demo"])) is None
    assert s.map_incident(incident(sources=[])) is None
    assert s.map_incident(incident(sources=["demo", "haproxy"])) is not None


def test_pentest_traffic_is_labelled_so_it_never_raises_risk():
    d = s.map_incident(incident(sources=["pentest"]))
    assert d["labels"] == ["authorized_test"]
    assert counted_incidents([d], parse_ts("2026-01-01T00:00:00Z")) == []


def test_an_unreadable_date_becomes_none_not_a_crash():
    assert s.iso("not a date") is None and s.iso(None) is None
    assert s.map_incident(incident(start="bad"))["first_seen"] is None


def test_the_converted_incident_is_counted_by_the_live_risk_formula():
    d = s.map_incident(incident())
    assert counted_incidents([d], parse_ts("2026-11-01T00:00:00Z")) == [d]
    assert counted_incidents([d], parse_ts("2026-12-01T00:00:00Z")) == []       # older than the window


def test_run_stores_real_incidents_only_and_leaves_other_sources_alone():
    col = FakeCollection([{"incident_id": "INC-001", "source": "fixture"}, {"incident_id": "X-1"}])
    rows = [incident(), incident(id="INC-BBB222", sources=["demo"])]
    out = s.run(fetch=lambda url: rows, col=col, recalc=False)
    assert out == {"read": 2, "stored": 1, "skipped_demo": 1}
    assert sorted(d["incident_id"] for d in col.docs) == ["INC-001", "INC-AAA111", "X-1"]


def test_running_twice_does_not_duplicate_and_drops_incidents_that_disappeared():
    col = FakeCollection()
    s.run(fetch=lambda url: [incident(), incident(id="INC-OLD000")], col=col, recalc=False)
    s.run(fetch=lambda url: [incident()], col=col, recalc=False)
    assert [d["incident_id"] for d in col.docs] == ["INC-AAA111"]


def test_remove_deletes_only_what_the_script_stored():
    col = FakeCollection([{"incident_id": "INC-001", "source": "fixture"}])
    s.run(fetch=lambda url: [incident()], col=col, recalc=False)
    assert s.remove(col) == 1
    assert [d["incident_id"] for d in col.docs] == ["INC-001"]


def test_dashboard_down_raises_so_the_user_sees_why():
    def down(url):
        raise OSError("connection refused")
    with pytest.raises(OSError):
        s.run(fetch=down, col=FakeCollection(), recalc=False)
