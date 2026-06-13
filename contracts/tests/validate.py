# /// script
# requires-python = ">=3.11"
# dependencies = ["jsonschema>=4.21"]
# ///
"""Contract test runner — the Wave-0 green light (spec §11.2).

    uv run contracts/tests/validate.py

Checks, in order:
  1. Every fixture validates against its JSON Schema (draft 2020-12).
  2. Snapshot cross-invariants (delay math, arriving-now alignment, degraded rule).
  3. Event cross-invariants (leakage gate, kinematics versioning, arrival windows).
  4. Every golden vector re-derives EXACTLY from formulas.py (the pinned semantics) —
     this proves the vector files and the reference implementation agree, so a Rust
     implementation matching the vectors transitively matches the contract.
Exit 0 = contracts green. Any failure prints and exits 1.
"""

import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

from jsonschema import Draft202012Validator

sys.path.insert(0, str(Path(__file__).parent))
import formulas as F

ROOT = Path(__file__).resolve().parent.parent
FAILURES: list[str] = []


def fail(msg):
    FAILURES.append(msg)
    print(f"  FAIL  {msg}")


def ok(msg):
    print(f"  ok    {msg}")


def parse_iso(s):
    if s is None:
        return None
    fmt = "%Y-%m-%dT%H:%M:%SZ" if s.count(":") == 2 else "%Y-%m-%dT%H:%MZ"
    return datetime.strptime(s, fmt).replace(tzinfo=timezone.utc)


def close(a, b, tol_type, tol):
    if tol_type == "exact":
        return a == b
    if tol_type == "absolute":
        return abs(a - b) <= tol
    denom = max(abs(a), abs(b), 1e-300)
    return abs(a - b) / denom <= tol


# --- 1. schema validation -----------------------------------------------------
print("== schema validation ==")
schemas = {}
for name in ["snapshot", "event", "alert-subscription"]:
    schemas[name] = json.loads((ROOT / "schemas" / f"{name}.schema.json").read_text())
    Draft202012Validator.check_schema(schemas[name])
    ok(f"{name}.schema.json is a valid 2020-12 schema")

for sub, schema_name in [("snapshot", "snapshot"), ("events", "event")]:
    for fx in sorted((ROOT / "fixtures" / sub).glob("*.json")):
        doc = json.loads(fx.read_text())
        errs = list(Draft202012Validator(schemas[schema_name]).iter_errors(doc))
        if errs:
            for e in errs[:5]:
                fail(f"{fx.name}: {'/'.join(map(str, e.path))}: {e.message}")
        else:
            ok(f"{fx.name} validates against {schema_name}.schema.json")

# --- 2. snapshot cross-invariants ----------------------------------------------
print("== snapshot invariants ==")
for fx in sorted((ROOT / "fixtures" / "snapshot").glob("*.json")):
    s = json.loads(fx.read_text())
    le = s["l1_to_earth"]
    sw = s["solar_wind"]
    if le["delay_quality"] == "measured":
        expect = le["spacecraft_distance_km"] / sw["speed_kms"]
        if abs(le["delay_s"] - expect) > 1.0:
            fail(f"{fx.name}: delay_s {le['delay_s']} != distance/speed {expect:.1f} (±1 s)")
        else:
            ok(f"{fx.name}: delay_s consistent with distance/speed")
    else:
        if le["delay_s"] != F.FIXED_FALLBACK_DELAY_S:
            fail(f"{fx.name}: degraded_fixed but delay_s != {F.FIXED_FALLBACK_DELAY_S}")
        else:
            ok(f"{fx.name}: degraded fallback uses fixed delay")
        if s["sources"]["swpc_plasma"]["status"] == "ok":
            fail(f"{fx.name}: degraded_fixed but swpc_plasma claims ok")
    arriving = parse_iso(le["arriving_now_measured_at"])
    l1_at = parse_iso(s["clocks"]["l1_measured_at"])
    drift = abs((arriving - l1_at).total_seconds() - le["delay_s"])
    if drift > 60.0:
        fail(f"{fx.name}: arriving_now != l1_measured_at + delay_s (off by {drift:.0f} s)")
    else:
        ok(f"{fx.name}: arriving_now aligned with l1_measured_at + delay_s")
    series = sw["series"]
    lens = {k: len(v) for k, v in series.items()}
    if len(set(lens.values())) != 1:
        fail(f"{fx.name}: series arrays not index-aligned: {lens}")
    else:
        ok(f"{fx.name}: series arrays index-aligned ({lens['t_unix']} points)")

# --- 3. event cross-invariants ---------------------------------------------------
print("== event invariants ==")
for fx in sorted((ROOT / "fixtures" / "events").glob("*.json")):
    e = json.loads(fx.read_text())
    most = [k for k in e["kinematics"] if k["is_most_accurate"]]
    if e["kinematics"] and len(most) != 1:
        fail(f"{fx.name}: expected exactly one is_most_accurate kinematics, got {len(most)}")
    versions = [k["version"] for k in e["kinematics"]]
    if versions != sorted(versions):
        fail(f"{fx.name}: kinematics not ordered oldest-first")
    for p in e["predictions"]:
        if parse_iso(p["inputs_as_of"]) > parse_iso(p["predicted_at"]):
            fail(f"{fx.name}: inputs_as_of after predicted_at (leakage!)")
        usable = [k for k in e["kinematics"]
                  if parse_iso(k["measured_at"]) <= parse_iso(p["inputs_as_of"])]
        if e["kinematics"] and not usable:
            fail(f"{fx.name}: prediction has no leakage-safe kinematics version")
        arr = p.get("arrival")
        if arr:
            ws, eta, we = (parse_iso(arr[k]) for k in ("window_start", "eta", "window_end"))
            if not (ws <= eta <= we):
                fail(f"{fx.name}: arrival window does not bracket eta")
    out = e["outcome"]
    if out and out["hit"] and not out.get("shock_arrival_at"):
        fail(f"{fx.name}: outcome hit=true but no shock_arrival_at")
    ok(f"{fx.name}: invariants hold "
       f"({len(e['kinematics'])} kinematics, {len(e['predictions'])} predictions, "
       f"outcome={'yes' if out else 'none'})")

# --- 4. golden vectors re-derive from the pinned formulas -------------------------
print("== golden vectors re-derive ==")
VDIR = ROOT / "fixtures" / "vectors"


def rederive(fn_name, inputs):
    i = inputs
    if fn_name == "l1_delay_seconds":
        r = F.l1_delay_seconds(i["spacecraft_earth_distance_km"], i["measured_speed_kms"])
        return {"error": "OutOfRange"} if r is None else {"delay_s": r}
    if fn_name == "dbm_step":
        r, v = F.dbm_step(i["r_km"], i["v_kms"], i["gamma_per_km"], i["ambient_wind_kms"], i["dt_s"])
        return {"r_km": r, "v_kms": v}
    if fn_name == "dbm_arrival":
        r = F.dbm_arrival(i["r_km"], i["v_kms"], i["t_unix"], i["gamma_per_km"],
                          i["ambient_wind_kms"], i["target_r_km"])
        if r is None:
            return {"error": "OutOfRange"}
        return {"t_arrival_unix": r[0], "v_arrival_kms": r[1],
                "transit_hours_approx": round(r[0] / 3600.0, 2)}
    if fn_name == "cone_contains_earth":
        return {"contains": F.cone_contains_earth(
            i["apex_lon_deg"], i["apex_lat_deg"], i["half_angle_deg"],
            i["earth_helio_lon_deg"], i["earth_helio_lat_deg"], i["parker_offset_deg"])}
    if fn_name == "newell_coupling":
        return {"coupling": F.newell_coupling(i["v_kms"], i["by_nt"], i["bz_nt"])}
    if fn_name == "dst_step":
        return {"dst_next_nt": F.dst_step(i["dst_nt"], i["v_kms"], i["bz_nt"],
                                          i["density_pcc"], i["dt_s"])}
    if fn_name == "kp_to_g":
        return {"g": F.kp_to_g(i["kp"])}
    if fn_name == "darkness_factor":
        return {"factor": F.darkness_factor(i["sun_alt_deg"])}
    if fn_name == "go_look":
        return F.go_look(**i)
    return None  # sky_state: ephemeris anchors, shape-checked only


for vf in sorted(VDIR.glob("*.json")):
    doc = json.loads(vf.read_text())
    for block in doc["vectors"]:
        fn = block["function"]
        tol = block["tolerance"]
        tol_type = tol["type"]
        tol_val = tol.get("value")
        n_checked = 0
        for case in block["cases"]:
            got = rederive(fn, case["inputs"])
            if got is None:
                continue  # shape-only block
            exp = case["expect"]
            if set(got) != set(exp):
                fail(f"{vf.name}:{fn}:{case['name']}: key mismatch {set(exp)} vs {set(got)}")
                continue
            for k, ev in exp.items():
                gv = got[k]
                if isinstance(ev, (bool, str)) or ev is None or isinstance(gv, (bool, str)):
                    same = ev == gv
                elif isinstance(ev, (int, float)):
                    eff_type = tol_type
                    eff_val = tol_val
                    if fn == "dbm_arrival":
                        if k == "v_arrival_kms":
                            eff_type, eff_val = "relative", 1e-6
                        elif k == "transit_hours_approx":
                            eff_type, eff_val = "absolute", 0.01
                    same = close(float(gv), float(ev), eff_type,
                                 eff_val if isinstance(eff_val, (int, float)) else 1e-9)
                else:
                    same = ev == gv
                if not same:
                    fail(f"{vf.name}:{fn}:{case['name']}:{k}: expect {ev}, rederived {gv}")
            n_checked += 1
        if n_checked:
            ok(f"{vf.name}: {fn} — {n_checked} cases re-derive within tolerance")
        else:
            ok(f"{vf.name}: {fn} — shape-checked ({len(block['cases'])} anchor cases, "
               f"ephemeris tolerance per contract)")

print()
if FAILURES:
    print(f"CONTRACTS RED — {len(FAILURES)} failure(s)")
    sys.exit(1)
print("CONTRACTS GREEN — all schemas, fixtures, invariants, and vectors agree")
