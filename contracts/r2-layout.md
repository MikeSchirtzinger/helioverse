# R2 object layout v1 — FROZEN

One **public bucket** (`helioverse-public`) served on a custom domain behind the Cloudflare CDN
(spec §4.3: client reads are cache hits, zero Worker invocations). KV holds a copy of
`snapshot/latest` for Worker-internal reads (alert sweep); R2 is the client-facing truth.

## Key rules

- All keys start with the contract major version: `v1/`.
- All timestamps in keys are UTC, path-split `YYYY/MM/DD/HHMM` (CDN- and listing-friendly).
- **Event-ID → key transform (bijective):** strip the colon from the time portion.
  `2026-06-04T07:31Z-CME-001` → `2026-06-04T0731Z-CME-001`. Nothing else changes.
- Writers: cron Workers only. Clients never write. One writer per key family (no contention).
- Every JSON object in the bucket validates against its schema in `contracts/schemas/`.

## Layout

| Key | Content | Written | Cache-Control | Retention |
|---|---|---|---|---|
| `v1/snapshot/latest.json` | combined snapshot (snapshot.schema.json) | every tick, overwrite | `max-age=60` | overwritten |
| `v1/snapshot/archive/YYYY/MM/DD/HHMM.json` | as-of copy of every tick — **this IS the append-only leakage-discipline record (spec §8.5)** | every tick, write-once | `immutable` | ≥ 1 year (≈5 GB/yr at 5-min ticks; prune to hourly after 1 yr) |
| `v1/ovation/latest.json` | full 360×181 OVATION grid, delay metadata attached | every OVATION refresh (~5 min), overwrite | `max-age=120` | overwritten |
| `v1/ovation/archive/YYYY/MM/DD/HH00.json` | hourly grid snapshot (hourly, NOT per-tick — a per-tick archive blows the 10 GB free tier in ~70 days) | hourly, write-once | `immutable` | 90 days |
| `v1/events/index.json` | `{active: [ids], recent: [ids], as_of}` | on event change | `max-age=60` | overwritten |
| `v1/events/{event-key}.json` | full Event object (event.schema.json), all kinematics versions inside | on upstream revision | `max-age=300` | permanent (eval ground truth) |
| `v1/thumbs/{event-key}.jpg` | 96×96 eruption thumbnail (Helioviewer ROI render, spec §5 — Workers never decode pixels) | once per event | `immutable` | permanent |
| `v1/imagery/sdo/{wl}/latest.jpg` | edge-cached SDO texture, `wl ∈ {0304, 0193, hmi}` | ~15 min | `max-age=300` | overwritten |
| `v1/imagery/sdo/{wl}/archive/YYYY/MM/DD/HH00.jpg` | hourly frame for the scrubber | hourly | `immutable` | 30 days (~1.3 GB for 3 wavelengths at 2048px) |
| `v1/history/insitu/YYYY-MM-DD.json` | consolidated daily 1-min in-situ series (scrubber + backfill, package W1-P9) | once/day + backfill | `immutable` | 30 days rolling in hot path; archive beyond |
| `v1/meta/contracts-version.json` | `{schemas: "1.0.0", wasm_api: "1.0.0", deployed_at}` | on deploy | `max-age=60` | overwritten |

## Budget check (free tier, spec §4.3)

Writes/day at 5-min cadence: 288 snapshot + 288 snapshot-archive + 288 ovation + 24 ovation-archive
+ 24×3 imagery + ~10 events ≈ **~970 Class-A ops/day ≈ 29K/month** — comfortably inside R2 free
(1M Class A/month). Storage: dominated by snapshot archive (~14 MB/day) + imagery archive
(~45 MB/day) ≈ **~1.8 GB/month** — inside 10 GB with the stated retentions.

## Failure semantics

- A failed upstream poll **never** deletes or blanks a key — last-good stays, and the snapshot's
  `sources.*.status` flips to `stale`/`gap` (staleness badge, spec §3.4/§7.3).
- Archive keys are write-once: a writer finding an existing archive key MUST NOT overwrite
  (append-only guarantee — the leakage adversarial pass in Wave 3 tests exactly this).
