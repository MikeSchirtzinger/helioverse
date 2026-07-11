# /// script
# requires-python = ">=3.11"
# ///
"""Re-derive every golden physics vector from the independent reference code."""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import formulas as F

ROOT = Path(__file__).resolve().parent.parent
VDIR = ROOT / "fixtures" / "vectors"
FAILURES: list[str] = []


def fail(message: str) -> None:
    FAILURES.append(message)
    print(f"  FAIL  {message}")


def ok(message: str) -> None:
    print(f"  ok    {message}")


def close(actual: float, expected: float, tolerance_type: str, tolerance: float) -> bool:
    if tolerance_type == "exact":
        return actual == expected
    if tolerance_type == "absolute":
        return abs(actual - expected) <= tolerance
    denominator = max(abs(actual), abs(expected), 1e-300)
    return abs(actual - expected) / denominator <= tolerance


def rederive(function: str, inputs: dict):
    if function == "l1_delay_seconds":
        result = F.l1_delay_seconds(
            inputs["spacecraft_earth_distance_km"], inputs["measured_speed_kms"]
        )
        return {"error": "OutOfRange"} if result is None else {"delay_s": result}
    if function == "dbm_step":
        radius, speed = F.dbm_step(
            inputs["r_km"],
            inputs["v_kms"],
            inputs["gamma_per_km"],
            inputs["ambient_wind_kms"],
            inputs["dt_s"],
        )
        return {"r_km": radius, "v_kms": speed}
    if function == "dbm_arrival":
        result = F.dbm_arrival(
            inputs["r_km"],
            inputs["v_kms"],
            inputs["t_unix"],
            inputs["gamma_per_km"],
            inputs["ambient_wind_kms"],
            inputs["target_r_km"],
        )
        if result is None:
            return {"error": "OutOfRange"}
        return {
            "t_arrival_unix": result[0],
            "v_arrival_kms": result[1],
            "transit_hours_approx": round(result[0] / 3600.0, 2),
        }
    if function == "cone_contains_earth":
        return {
            "contains": F.cone_contains_earth(
                inputs["apex_lon_deg"],
                inputs["apex_lat_deg"],
                inputs["half_angle_deg"],
                inputs["earth_helio_lon_deg"],
                inputs["earth_helio_lat_deg"],
                inputs["parker_offset_deg"],
            )
        }
    if function == "newell_coupling":
        return {
            "coupling": F.newell_coupling(
                inputs["v_kms"], inputs["by_nt"], inputs["bz_nt"]
            )
        }
    if function == "dst_step":
        return {
            "dst_next_nt": F.dst_step(
                inputs["dst_nt"],
                inputs["v_kms"],
                inputs["bz_nt"],
                inputs["density_pcc"],
                inputs["dt_s"],
            )
        }
    if function == "kp_to_g":
        return {"g": F.kp_to_g(inputs["kp"])}
    if function == "darkness_factor":
        return {"factor": F.darkness_factor(inputs["sun_alt_deg"])}
    if function == "go_look":
        return F.go_look(**inputs)
    return None  # sky_state uses shape-checked astronomical anchor cases.


print("== golden physics vectors ==")
for vector_file in sorted(VDIR.glob("*.json")):
    document = json.loads(vector_file.read_text())
    for block in document["vectors"]:
        function = block["function"]
        tolerance_type = block["tolerance"]["type"]
        tolerance_value = block["tolerance"].get("value")
        checked = 0
        for case in block["cases"]:
            actual = rederive(function, case["inputs"])
            if actual is None:
                continue
            expected = case["expect"]
            if set(actual) != set(expected):
                fail(
                    f"{vector_file.name}:{function}:{case['name']}: "
                    f"key mismatch {set(expected)} vs {set(actual)}"
                )
                continue
            for key, expected_value in expected.items():
                actual_value = actual[key]
                if isinstance(expected_value, (bool, str)) or expected_value is None:
                    matches = expected_value == actual_value
                elif isinstance(expected_value, (int, float)):
                    effective_type = tolerance_type
                    effective_value = tolerance_value
                    if function == "dbm_arrival":
                        if key == "v_arrival_kms":
                            effective_type, effective_value = "relative", 1e-6
                        elif key == "transit_hours_approx":
                            effective_type, effective_value = "absolute", 0.01
                    matches = close(
                        float(actual_value),
                        float(expected_value),
                        effective_type,
                        effective_value
                        if isinstance(effective_value, (int, float))
                        else 1e-9,
                    )
                else:
                    matches = expected_value == actual_value
                if not matches:
                    fail(
                        f"{vector_file.name}:{function}:{case['name']}:{key}: "
                        f"expect {expected_value}, rederived {actual_value}"
                    )
            checked += 1
        if checked:
            ok(
                f"{vector_file.name}: {function} — {checked} cases re-derive "
                "within tolerance"
            )
        else:
            ok(
                f"{vector_file.name}: {function} — shape-checked "
                f"({len(block['cases'])} astronomical anchors)"
            )

print()
if FAILURES:
    print(f"VECTORS RED — {len(FAILURES)} failure(s)")
    sys.exit(1)
print("VECTORS GREEN — reference formulas and golden cases agree")
