"""W4: bring the dashboard's REAL incidents into the GRC database, so risk scores follow real attacks.

The dashboard (port 8000) groups the real alerts into incidents. This script reads them through
GET /api/incidents, works out which asset each one hit, and stores them in the `incidents` collection
(marked source = "sentinel-dashboard"). The next risk recalculation then raises the risks of those assets.

    python sync_incidents.py                 read the dashboard, store the incidents, recalculate the risks
    python sync_incidents.py --no-recalc     only store them
    python sync_incidents.py --remove        remove what this script stored (fixtures and other data stay)
    python sync_incidents.py --url http://localhost:8000   where the dashboard runs

Run it again whenever you want fresh numbers (every run replaces what the previous run stored).

The dashboard's alerts do not say which asset was attacked, so the asset is chosen from the attack type
with the table ASSET_RULES below. That table is a team decision: review it and change it here.
"""
import argparse
import json
import os
import urllib.request
from datetime import datetime

SOURCE = "sentinel-dashboard"
DEFAULT_ASSETS = ["AST-005"]   # everything reaches the site through HAProxy, so an unknown attack lands there

# (words found in the attack type, assets hit). The first rule that matches an attack type wins.
ASSET_RULES = [
    (("sql",), ["AST-001", "AST-004"]),                                     # website + its database
    (("admin",), ["AST-002"]),                                              # admin pages
    (("login", "credential", "stuffing", "password", "session"), ["AST-003"]),   # auth and sessions
    (("dos", "flood", "ddos"), ["AST-001", "AST-005"]),                     # website + the proxy in front of it
    (("scan", "recon", "probe", "sensitive file"), ["AST-005"]),
    (("xss", "injection", "traversal", "ssrf", "web attack", "command", "xxe", "file inclusion"), ["AST-001"]),
]


def assets_for(attack_types):
    """Asset ids hit by an incident, from the attack types it contains (no repeats, stable order)."""
    found = []
    for name in attack_types or []:
        text = str(name).lower()
        hit = next((a for words, a in ASSET_RULES if any(w in text for w in words)), DEFAULT_ASSETS)
        found += [x for x in hit if x not in found]
    return found or list(DEFAULT_ASSETS)


def iso(value):
    """'2026-11-20 09:15:00' (the dashboard's format) -> '2026-11-20T09:15:00Z'. None if it cannot be read."""
    try:
        return datetime.strptime(str(value).strip(), "%Y-%m-%d %H:%M:%S").strftime("%Y-%m-%dT%H:%M:%SZ")
    except ValueError:
        return None


STATUS = {"open": "open", "investigating": "investigating", "closed": "closed"}


def map_incident(inc):
    """One dashboard incident -> one GRC incident document. None for incidents made only of demo alerts."""
    sources = [str(s).lower() for s in inc.get("sources") or []]
    if not sources or all(s == "demo" for s in sources):
        return None                      # sample data inside the dashboard is not a real attack
    types = list((inc.get("types") or {}).keys())
    doc = {
        "incident_id": inc["id"],
        "src_ip": inc.get("ip"),
        "attack_families": types,
        "affected_assets": assets_for(types),
        "techniques": list(inc.get("techniques") or []),
        "first_seen": iso(inc.get("start")),
        "last_seen": iso(inc.get("end")),
        "status": STATUS.get(str(inc.get("status", "")).lower(), "open"),
        "severity": str(inc.get("severity", "")).lower(),
        "alert_count": inc.get("count", 0),
        "labels": [],
        "source": SOURCE,
    }
    if any("pentest" in s for s in sources + [str(e).lower() for e in inc.get("engines") or []]):
        doc["labels"] = ["authorized_test"]       # our own pentest traffic must not raise risk (spec 12.5)
    return doc


def fetch_incidents(url):
    with urllib.request.urlopen(f"{url.rstrip('/')}/api/incidents?limit=1000", timeout=10) as r:   # noqa: S310
        return json.loads(r.read().decode("utf-8")).get("rows", [])


def store(docs, col):
    """Replace what an earlier run stored. Documents from other sources (fixtures, Alaa) are never touched."""
    col.delete_many({"source": SOURCE})
    for d in docs:
        col.replace_one({"incident_id": d["incident_id"]}, d, upsert=True)
    return len(docs)


def remove(col):
    return col.delete_many({"source": SOURCE}).deleted_count


def run(url="http://localhost:8000", recalc=True, fetch=None, col=None):
    rows = (fetch or fetch_incidents)(url)
    docs = [d for d in (map_incident(r) for r in rows) if d]
    if col is None:
        from app.database import get_incidents
        col = get_incidents()
    saved = store(docs, col)
    result = {"read": len(rows), "stored": saved, "skipped_demo": len(rows) - saved}
    if recalc:
        from app.risk_live import recalculate_all
        result["recalculated"] = recalculate_all()
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--url", default=os.environ.get("SENTINEL_URL", "http://localhost:8000"))
    ap.add_argument("--no-recalc", action="store_true")
    ap.add_argument("--remove", action="store_true")
    args = ap.parse_args()
    if args.remove:
        from app.database import get_incidents
        print(f"Removed {remove(get_incidents())} incidents stored by this script")
    else:
        out = run(args.url, recalc=not args.no_recalc)
        print(f"Read {out['read']} incidents, stored {out['stored']} real ones "
              f"(skipped {out['skipped_demo']} made only of sample alerts)")
        if "recalculated" in out:
            print("Risks recalculated:", out["recalculated"])
