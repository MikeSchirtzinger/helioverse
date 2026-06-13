# Helioverse — Aurora Forecasting on a Live 3D Heliosphere
### Technical Specification v0.4 — refined 2026-06-12

**Changes from v0.3 (same day):** execution model corrected to a **parallel agent-loop factory** — humans in the loop only for canvas taste, provisioning, and go/no-go. §11 re-rebuilt: the human day-by-day schedule becomes a contracts-first **work-package DAG** (Wave 0 contracts → Wave 1 wide fan-out → Wave 2 integration → Wave 3 verification fleet); **all v0.3 ladder cuts are restored to v1 scope** (GOES nowcast leg, Web Push, 30-day history, Project scrub mode); the ladder survives only as external-failure contingency (§11.4); new §11.5 names what no fleet compresses (ground-truth accrual, upstream cadences, platform budgets, soak wall-clock); every acceptance-checklist line must now carry a machine-runnable verification harness.

**Changes from v0.2:**
- **§11 rebuilt around the real clock** — the June 17 deadline is **five days out** from this revision: explicit v1-minimum bars per pillar (binary acceptance checklist), a day-by-day two-track critical path, and a pre-agreed de-scope ladder with a never-cut floor.
- **§4 stack made internally consistent with the Cloudflare hosting decision** — NATS/tokio/polars removed (there is no long-running server anywhere to host them); cron→D1/KV *is* the bus; Rust lives in one shared WASM crate (propagator + scoring) consumed by client and Workers; realtime = cached-snapshot polling, no WebSockets in v1.
- **§4.3 budget math made explicit** — KV's 1K writes/day forces combined-snapshot writes at ~5-min cadence on free tier; client reads are served from an R2 public bucket behind the CDN so the 100K req/day Worker ceiling isn't a daily-active-user ceiling.
- **§2.1 flagship claim tightened** — it's a *timing* re-alignment of NOAA's own oval; the measurable win concentrates at onsets/Bz turns (when minutes matter); stale-L1 fallback = fixed delay + "degraded" label. Headline metric becomes onset-timing skill, which accrues from day one.
- **§3.4 imagery** — everything client-visible routes through our edge cache with per-layer failover; **§5** thumbnails rendered by Helioviewer's server-side ROI screenshot API into R2 (Workers never decode pixels).
- **§7.5 alerts scoped** — v1 channels are in-app + Web Push only.
- **§8 metric-accrual honesty** — nowcast metrics publish first; CME-arrival skill stays sparse for months; every published number carries n + interval, or shows "collecting."
- **§9** — open questions #1 (default look), #2 (beyond Earth), #3 (server model runs), #5 (imagery failover), #6 (refresh/cost) decided; #4 and #7 remain open with recommendations.
- **Phase 0 hardened** — append-only as-of input capture and upstream contract tests are launch-blocking (SWPC's viewer migration lands ~June 30, two weeks *after* launch).

**Helioverse is a live 3D visualization of the Sun's activity that doubles as an aurora-forecasting product for prosumers.** It began with one idea: *watch the Sun's events unfold in three dimensions and time* — flares and CMEs erupting, their particle mass propagating out through the heliosphere, stacking and interacting, sweeping past Earth. We track those events because they're what drives the aurora, so the same engine answers the practical question too: tell the user, with a stated accuracy and margin of error, whether and when they'll see the aurora from their location.

Two faces, one system:
- **The 3D heliosphere** (the founding feature) — the Sun in real imagery, events detected/tagged/propagated as GPU particle systems from Sun to past-Earth, scrubable across history↔live↔projection. This is the thing you *watch*.
- **The aurora answer** (the point of pointing it at Earth) — "can I see it tonight from here?", with honest confidence. This is the thing you *act on*.

Both ship in v1 (§11). Better forecasts come from modeling the whole chain — eruption → propagation → L1 arrival → magnetospheric coupling → auroral oval — rather than reading a single index, and the 3D view makes that chain legible to a prosumer who wants to understand, not just be told.

**Flagship differentiator:** we publish our *own* forecast with a transparent, eval-derived accuracy + margin of error, and we beat NOAA's public aurora product on its own terms — see §2.1, the real-delay correction.

---

## 1. Goals & Non-Goals

**Goals**
- **Tell a prosumer whether they can see the aurora tonight from their location, when, and how confident we are** — the primary job.
- Publish our *own* forecast with a transparent accuracy + margin of error derived from our live eval loop; let users filter/compare against other public sources, and **track those other sources' accuracy too**.
- Beat NOAA's public aurora product by computing the *actual* L1→Earth propagation delay instead of their fixed 30-min assumption (§2.1).
- Near-real-time multi-wavelength views of the Sun; detect/ingest flares and CMEs, assign each a persistent **Event ID**, tag on a timeline with a thumbnail of the eruption.
- 3D simulation of each event's particle mass from Sun → Earth and past it (≥ 1 AU), in space + time — as the *explanation* of the forecast.
- Track standard metrics: speed, magnitude/class, **Bz** (first-class signal), density, proton flux, Kp/Dst.
- Model **multiple simultaneous CMEs** at different speeds — cannibalism, stacking, stream interaction — and coupling to Earth's magnetosphere.
- A scrubable timeline from history (30 days) → live (as close to real-time as the data allows).
- A reinforcement/continuous-improvement loop with concrete eval metrics that close the gap from "observed eruption" to "quantified Earth impact" to "auroral oval / visibility."

**v1 deadline: June 17, 2026 — five days from this revision (2026-06-12).** Both pillars (3D heliosphere + aurora answer) ship together — no partial release. Execution is a **parallel agent-loop factory** (§11), so labor is not the binding constraint and the **full §6–§7 v1 feature set is the plan**: §11.1's binary acceptance checklist is the gate, §11.2's work-package DAG is the shape of the fan-out, and cuts exist only as external-failure contingencies (§11.4) — never as labor relief.

**Non-Goals (v1)**
- Operational/safety-critical forecasting (this is prosumer decision-support; mirror NOAA's disclaimer — defer to SWPC for official warnings).
- Running a full 3D MHD solver in-browser (we *consume* WSA-Enlil/cone-model output and run a fast reduced-physics propagator; full MHD is a backend/offline option).
- Photospheric-resolution science-grade imagery pipeline.

---

## 2. Reality Check on "Real-Time"

This is the single most important constraint to internalize, because it shapes the whole UX. There is no single "live sun" feed; latencies differ by source:

| Layer | Source | Effective cadence / latency |
|---|---|---|
| Solar disk imagery (EUV/HMI) | SDO NRT | ~15 min |
| Coronagraph (CME liftoff) | SOHO/LASCO, GOES CCOR-1 | ~15 min – hours; LASCO has data gaps |
| X-ray flare flux | GOES XRS | ~1 min |
| In-situ solar wind (speed, density, Bz) | DSCOVR/ACE @ L1 | ~1 min; **only ~15–60 min warning** (L1 is ~1.5M km upstream, not at the Sun) |
| CME arrival | physics propagation | **1–4 days transit**, arrival-time error **±6–12 h** even for good models |

So "live" means three different clocks running at once:
1. **Sun clock** — what the Sun looked like ~15 min ago.
2. **L1 clock** — what's hitting us in ~30–60 min (measured, high-confidence).
3. **Propagation clock** — model projection of CMEs in flight, with a widening uncertainty cone.

The UI must make this legible, not hide it. (See §7, confidence cones.)

### 2.1 The real-delay correction — our flagship accuracy edge

NOAA's own public aurora product (the OVATION 30-minute forecast everyone reuses) has a known, documented simplification: it assumes a **fixed 30-minute travel time** from the L1 observation point to Earth — a delay that corresponds to ~800 km/s solar wind (i.e. *storm-level* speed). In reality the L1→Earth delay varies from under 30 minutes up to an hour or more depending on the actual measured solar-wind speed.

**We compute the real delay.** L1 sits ~1.5M km upstream; the propagation lag is simply that distance divided by the *currently measured* bulk speed from the plasma feed (refined with the Bz/density structure, not just a scalar). At a typical 400 km/s, the true lag is ~60+ minutes — double NOAA's fixed assumption. So:

- When we time-align L1 measurements to "what's actually arriving at Earth now," we're correct where NOAA is systematically off (most of the time, since quiet/moderate wind is far more common than 800 km/s).
- This is a **defensible, quantifiable "we're better and here's exactly why"** claim — and the eval loop (§8) proves it continuously by scoring our delay-corrected nowcast against measured ground magnetometer / auroral response vs. the fixed-delay baseline.
- It's also honest about its own limit: the delay is still an estimate (the wind isn't uniform between L1 and Earth), so it ships with a margin of error like everything else we publish.

**Scope the claim correctly (v0.3):** the correction re-times NOAA's *own* oval — same source physics, better clock. Its measurable win therefore concentrates where minutes matter: substorm onsets, sudden southward-Bz turns, storm commencements — exactly the moments a prosumer is deciding whether to walk outside. During slowly-varying quiet conditions the two products converge, and we say so. The eval accordingly headlines **onset-timing skill vs the fixed-30-min baseline** (§8.4-G) — a metric that accrues continuously from day one, unlike CME-arrival skill which needs months of resolved events (§8.4 accrual note). Fallback rule: when the L1 plasma feed is stale or gapped (ACE and DSCOVR both have real outage history), revert to the fixed-delay baseline and **label the forecast as degraded** rather than silently extrapolating a dead speed reading.

This single correction is cheap to implement, easy to explain to a prosumer ("we use tonight's *actual* solar wind speed, not a one-size-fits-all guess"), and is the anchor of our accuracy story.

---

## 3. Data Sources (all public, no/low auth)

### 3.1 In-situ solar wind & geomagnetic (NOAA SWPC — `services.swpc.noaa.gov`)
Static JSON, no key, refreshed ~1 min. Auto-switches active spacecraft (DSCOVR↔ACE).
- Plasma (speed, density, temp): `/products/solar-wind/plasma-{5-minute,2-hour,1-day,7-day}.json`
- Magnetic field (Bx/By/Bz GSM, Bt, lat/lon): `/products/solar-wind/mag-*.json`
- Spacecraft positions: `/products/solar-wind/ephemerides.json`
- Planetary K-index (+forecast): `/products/noaa-planetary-k-index{,-forecast}.json`
- Kyoto Dst: `/products/kyoto-dst.json`
- NOAA scales (R/S/G): `/products/noaa-scales.json`
- Alerts/watches/warnings: `/products/alerts.json`
- F10.7 flux: `/products/10cm-flux-30-day.json`
- Flares directory: `/products/flares/`
> Note: SWPC is migrating to a new viewer; legacy DSCOVR/ACE plot is supported until ~June 30 2026, with SOLAR-1 and IMAP I-ALiRT coming online. Build the ingest layer source-agnostic.

### 3.2 Aurora forecast (NOAA SWPC OVATION — the consumer engine)
- **OVATION Prime grid**: `services.swpc.noaa.gov/json/ovation_aurora_latest.json` — a 360×181 grid of *visible-aurora probability (%)* by lon/lat, refreshed **every 5 min** for a **30-min-ahead** forecast. This is the single most important consumer feed.
  - Carries a `Forecast Time` and `Observation Time`; values are `[lon, lat, prob]` triples.
  - **We re-time-align it** using the real-delay correction (§2.1) instead of inheriting NOAA's fixed 30-min lag — this is where our forecast diverges from (and beats) the stock product.
- Hemisphere image loops (N/S, time-tagged, last 24 h) for a quick raster fallback.
- **Viewline note**: SWPC's "tonight/tomorrow night" experimental product existed but its viewline was *removed in May 2026* — so we compute our own viewline from the oval + observer geometry rather than depend on theirs.
- OVATION is driven by L1 solar wind + IMF, so its skill is inherently bounded by the ~30–60 min L1 lead time. CME propagation (§6) is what extends useful aurora lead time from ~1 hour to ~1–3 days out.

### 3.3 Flare & CME event catalog (NASA DONKI — `api.nasa.gov/DONKI`)
Register a free API key (DEMO_KEY works for dev, heavily rate-limited). Some mirrors need no key.
- `FLR` — solar flares (class, peak time, source region).
- `CME` — coronal mass ejections.
- `CMEAnalysis` — **the money endpoint**: speed (km/s), source longitude/latitude, **half-angle**, measurement type, primary flag, linked events. Filterable by `speed`, `halfAngle`, `catalog`.
  - e.g. `…/DONKI/CMEAnalysis?startDate=…&endDate=…&speed=500&halfAngle=30&api_key=…`
- `IPS` — interplanetary shocks (arrival confirmation at Earth/STEREO/Mars).
- `GST` — geomagnetic storms (Kp, linked CMEs) — **ground-truth for the RL loop**.
- `SEP` — solar energetic particles.
- `notifications` — human forecaster annotations (great for labeling).

### 3.4 Solar imagery
- **SDO NRT** (`sdo.gsfc.nasa.gov/assets/img/latest/latest_{res}_{wavelength}.jpg`)
  - res ∈ {512, 1024, 2048, 4096}; wavelengths ∈ {0094, 0131, 0171, 0193, 0211, 0304, 0335, 1600, 1700, HMIB, HMII, HMID, …}. Updated ~15 min. (Note: SDO had a recent storage-hardware incident — keep a fallback.)
  - Use **304Å** (chromosphere/prominences — pretty), **193Å** (corona/coronal holes), **HMI** (magnetogram/sunspots).
- **SOHO/LASCO C2 & C3 coronagraphs** — the only way to *see CME liftoff* (occulted disk). Source via Helioviewer.
- **GOES SUVI** + **CCOR-1** coronagraph (SWPC `/products/ccor1/`) — newer operational coronagraph.
- **Helioviewer API** (`api.helioviewer.org`) — unified tiled access to SDO/SOHO/STEREO with timestamps; ideal for the timeline scrubber and for pulling a **thumbnail at an event's eruption time**.
- **STEREO-A** (SECCHI) — off-Sun-Earth-line view; gives a second vantage for triangulating CME direction. (STEREO-B is dead.)
- **Routing & failover (v0.3 — resolves old open question #5):** all client-visible imagery is served **from our edge cache** (cron Worker fetch → R2/CDN), never hot-linked. This solves three problems at once: CORS for WebGPU texture upload, upstream volatility (SDO storage incident, LASCO gaps), and hot-link etiquette (the §4.3 good-citizen rule applied to pixels). Per-layer failover order: **Helioviewer (aggregator, primary) → direct SDO/SUVI → last-good-cached frame with a staleness badge**. Multi-source failover *is* a v1 requirement — but it's a routing table plus a badge, not a subsystem.

### 3.5 Model output (so we don't have to solve MHD live)
- **WSA-Enlil** cone-model runs (SWPC) — 3D heliospheric density/velocity, the canonical "CME hitting Earth" animation. Often image/movie output; ingest as overlay + parse run metadata.
- **CCMC** (`ccmc.gsfc.nasa.gov`) — runs-on-request, the **CME Scoreboard** (community arrival-time predictions vs actuals — directly reusable as eval baselines/ground truth), DONKI is co-located here.
- **DSCOVR/Geospace** propagated solar wind at 32 Earth radii (SWPC) — bridges L1 → magnetosphere.

### 3.6 Cloud cover & local viewing conditions (for the "go look" score, §7.1)
Clouds are the #1 "forecast was right but I saw nothing" failure mode, so this is load-bearing — and **low cloud is the killer** (high cirrus is often see-through for aurora; low stratus/fog is not). Two epistemically distinct legs, both feed the score:

**Forecast leg — multi-model consensus (default, no key):**
- **Open-Meteo** (`api.open-meteo.com`) is the spine: a free, no-auth, CC BY 4.0 aggregator of 30+ national models (ECMWF/AIFS, NOAA GFS/HRRR, DWD ICON, Météo-France AROME, JMA, UKMO, DMI, …), up to 1 km resolution, switchable by hostname/`models=` param. Exposes `cloudcover_{low,mid,high,total}`.
  - **Consensus, not a single model**: request the same point from several models in one call and compute agreement. Agreement → high confidence; disagreement → flag it. This *is* the honest error bar (same move as the space-weather scoreboard, applied to clouds).
  - **Low-cloud special-case**: DMI models 2 m cloud cover / fog unusually well — prefer it for high-latitude aurora zones (Scandinavia, Iceland) where it's available.
  - **Licensing (decided):** non-commercial product, so Open-Meteo's free tier is used directly — no commercial-tier cost. If the project ever goes commercial, self-host the (Dockerized, open-source) instance rather than re-architecting.

**Nowcast leg — satellite, observed (the "is it clear *right now*" answer):**
- **GOES ABI Clear Sky Mask (L2)** — derived, observed cloud/clear field, free on NOAA Open Data Dissemination (AWS S3 / GCS / Azure, free egress).
  - The CSM is ideal because the hard radiance→cloud interpretation is already done upstream — we just **spatially sample a derived field** at the user's point (§4.1, Tier 0).
  - **v1 "light nowcast" scope (decided):** GOES only (covers the Americas / early user base), **point-answer only — raster Tier 0, no preview tiles**, ~10–15 min refresh (we don't need 1-min freshness for "go outside tonight"). One backend sampler + a scalar field; no tile-rendering pipeline. *Deferred to later: edge-preview tiles (raster Tier 1), Himawari (Asia-Pacific) + Meteosat (Europe/Africa) for global coverage, sub-15-min cadence — all additive, none blocking.*
  - Gotcha: Open-Meteo's satellite-radiation product has *not* integrated NASA GOES yet (no North-America satellite via them) — the GOES nowcast integration is ours, off the AWS feed.

**Premium / BYO-key (optional):**
- Source registry also wires (but lazy-pulls — §4.1) premium providers: Tomorrow.io, Meteomatics (1 km EURO1k/US1k), Visual Crossing, AccuWeather. **Users can paste their own API key** for a service they already pay for; we route through it (key stored client-side/encrypted, never proxied anywhere it'd be logged). Premium accuracy, zero incremental cost to us.

### 3.7 Community alert services — independent forecasts & ground truth

- **The Glendale App (Aurora Alerts UK)** — `aurora-alerts.uk`, run by Andy Stables from Glendale, Isle of Skye; daily substorm research since 2012, 215k+ users (self-reported), still actively developed (V14.4, 2026). **Very high credibility** — the canonical community aurora-alert service for UK/Ireland, with alert reach mapped as far as southern Canada, Tasmania, and New Zealand.
  - **Why it matters to us — methodological independence:** alerts are driven by a real-time **substorm-phase tracker** (growth → expansion → recovery, strength in −nT) computed from Scandinavian/North-American magnetometer chains (Tromsø, FMI, Swedish IRF, USGS, CARISMA) + L1 solar wind. That's *measured geomagnetic response*, not a modeled oval — an epistemically distinct signal from OVATION, which is exactly what the scoreboard (§8.7) wants in a comparison source. Alert ladder: Onset → Yellow → Orange → Red → Major/Severe/Extreme, each level mapped to geographic visibility reach.
  - **Crowd sightings:** registered users file confirmed / faint / not-visible / clouded reports onto a live map — the most mature existing instance of precisely our §8.7 ground-truth stream. Use as corroboration for the per-location hit/miss metric (§8.4-G) in the UK/Ireland regime.
  - **Ingest reality check (verified 2026-06): no public API.** Distribution is web app + Telegram channel (`t.me/GlendaleApp`) + X (`@SkyeAuroras`). Practical paths: parse the public Telegram alert stream, and/or pursue a data partnership. Note the *underlying* magnetometer networks it reads are public feeds we can ingest directly. Slots into the lazy-pull registry (§4.1) like everything else.
  - **Sibling service — don't conflate:** **AuroraWatch UK** (Lancaster University, `aurorawatch.lancs.ac.uk`) — UK-magnetometer threshold alerts (green/yellow/amber/red) with a **free XML API (~3-min updates)**. Institutionally distinct, complementary (UK sensors vs Glendale's Scandinavian coverage), and trivially ingestable — score it on the §8.7 board too.

---

## 4. System Architecture

```
                 ┌─────────────────────────────────────────────┐
                 │            Ingest & Normalize (backend)       │
 SWPC JSON ─────▶│  pollers (1m/15m) · schema adapters · dedupe │
 DONKI    ─────▶│  source-agnostic Event model · unit harmonize │
 Helioviewer ──▶│  imagery fetch + thumbnail crop @ event time  │
 Enlil/CCMC ───▶│  model-run parser                             │
                 └───────────────┬──────────────────────────────┘
                                 │  (normalized events + timeseries)
                 ┌───────────────▼──────────────────────────────┐
                 │              Event Store + TSDB               │
                 │  events(id, kinematics, provenance, version)  │
                 │  timeseries(plasma, mag, indices)             │
                 │  predictions(event_id, model, eta, ci, …)     │
                 │  outcomes(event_id, observed arrival, Kp/Dst) │
                 └───────────────┬──────────────────────────────┘
                                 │
        ┌────────────────────────┼─────────────────────────┐
        ▼                        ▼                         ▼
 ┌─────────────┐        ┌──────────────────┐      ┌─────────────────┐
 │ Propagation │        │  Eval / RL loop  │      │   Realtime API   │
 │   engine    │        │  scorer+trainer  │      │ REST + R2 snaps  │
 │ (drag-based │        │ (closes the loop)│      │ + snapshot/hist  │
 │  + N-body   │        └──────────────────┘      └────────┬────────┘
 │  interaction)│                                          │
 └─────────────┘                                  ┌────────▼────────┐
                                                  │  3D Frontend     │
                                                  │ three.js/WebGPU  │
                                                  │ timeline · cones │
                                                  │ event thumbnails │
                                                  └──────────────────┘
```

**Stack** (v0.3 — reconciled with the Cloudflare hosting decision in §4.3; v0.2 listed tokio pollers + NATS JetStream, but there is no long-running server anywhere in this architecture to run them on):
- **Pollers / ingest:** Cloudflare **cron Workers in Rust via `workers-rs`** (Rust-first stack rule; the work is I/O-bound JSON reshaping, well within workers-rs's comfort zone, and it shares serde types with the physics crate). Escape hatch: if a specific binding fights workers-rs during launch week, a thin JS shim around the Rust WASM core is acceptable — shim, not rewrite. Cron → D1/KV **is** the event bus; no NATS, no queue in v1. If real fan-out is ever needed, Cloudflare Queues comes with the $5 plan.
- **Physics & scoring:** one shared **Rust → WASM crate** (`nalgebra`) — the DBM propagator, Newell/Dst coupling, the "go look" score. Compiled once, consumed by the browser client (primary) and importable by Workers for the nightly eval (paid plan). This is where Rust-first actually lives.
- **Timeseries math:** D1 SQL + small typed arrays. No `polars` — the windows are tiny (30 days × ~1-min scalars) and polars-in-WASM doesn't fit a 10 ms CPU budget.
- **Realtime delivery:** **no WebSockets in v1.** Cron writes versioned snapshot JSON; clients poll every 30–60 s with ETag. Snapshots are served as **R2 public-bucket objects on a custom domain behind the CDN cache**, so reads cost zero Worker invocations (§4.3). SSE/Durable-Object push is a later upgrade, not a v1 need — the freshest upstream data is ~1-min cadence anyway.
- Store: events + predictions + outcomes in **Cloudflare D1** (SQLite-backed; CME→shock→storm lineage as foreign-key graph); hot snapshots in **KV** (Worker-internal) and **R2** (public client reads); edge-preview tiles in **R2**. No SurrealDB — everything stays in Cloudflare's stack.
- Frontend: see §4.2 (client rendering & compute) — WebGPU-primary three.js + WASM.

### 4.2 Client rendering & compute (WebGPU-primary)

The client does the heavy lifting — both the 3D event visualization *and* the parallel sim/consensus math — so the GPU is the lever. As of January 2026 WebGPU is **Baseline across Chrome, Edge, Firefox, and Safari 26+**, so we ship it as the **primary path with a WebGL2 fallback for the ~5–10% tail** (mainly Linux Firefox and pre-A12 iPhones). three.js has a `WebGPURenderer` with automatic WebGL2 fallback, so this is near-free to adopt rather than two codebases. Feature-detect `navigator.gpu`; test on real devices (GPU-vendor/driver variance is real).

**The WASM ↔ WebGPU-compute ↔ WebGPU-render split (deliberate, not interchangeable):**
- **WASM (CPU)** — the *light scalar logic*: the "go look" score (oval prob × darkness × cloud × moon), source-registry orchestration, small per-event bookkeeping. Tiny inputs; GPU dispatch overhead would dwarf the work. This is where the §4.1 WASM invariant lives.
- **WebGPU compute shaders** — the *embarrassingly-parallel heavy sims*: the **particle system** for the CME/solar-wind mass (100k+ particles), **N-member ensemble propagation** (parameter-perturbed fronts whose spread *is* the §7.2 uncertainty cone — the user-facing ensemble *launcher* UI stays in §10), and **per-grid-cell coupling/oval fields**. This is the founding visualization and it's **in v1** (§7.2), not deferred. GPU compute is exactly the tool for these element counts.
- **WebGPU rendering** — the 3D scene itself (Sun, Earth, magnetosphere, event cones, volumetric particles), with the WebGL2 fallback for the tail.

WASM and WebGPU are explicitly designed to cooperate here (shared typed-array buffers between the scalar layer and GPU pipelines); the project counts on that pairing rather than treating GPU as optional.

**Text in the 3D/canvas layer:** event-ID tags, timeline chips, axis/metric labels, and the confidence-cone callouts all need crisp text composited with the GPU scene — a known weak spot for WebGL/WebGPU. Use **`pretext-rs`** ([github.com/MikeSchirtzinger/pretext-rs](https://github.com/MikeSchirtzinger/pretext-rs)) — Mike's Rust canvas-text-rendering crate, built for exactly this canvas-text need. It is the confirmed approach; compile to WASM and composite against the WebGPU canvas.

**Hosting fit:** every GPU cycle here runs on the *user's* device, so this is **free to the host regardless of how heavy the sim gets** — which is what makes the Cloudflare free/$5 story (§4.3) hold even with a rich particle visualization.

### 4.1 Source registry & the raster boundary (applies to clouds *and* imagery)

**Lazy-pull source registry (mirrors the space-weather source toggles).** Every external source — space-weather feeds, cloud models, satellite, premium weather — is *registered* (connector configured, schema known) but only *called when a user selects it*. We never pull more than needed. BYO-key sources (§3.6) slot into the same registry; the key is the only difference. This is one mechanism serving both domains: a source is a source.

**The raster boundary — three tiers, and we deliberately stop at Tier 1.** Science-grade rasters (GOES L1b/L2, full-disk imagery) are heavy and their bucket layouts are volatile. The client must never touch them directly. So:

| Tier | What | Where | Payload |
|---|---|---|---|
| **0 — point/ROI answer** (default, ~99%) | Sample a small window at the user's lat/lon from the Clear Sky Mask (or imagery), reduce to verdict + confidence + optional mini-sparkline | Backend | **kilobytes** — no raster moves |
| **1 — edge preview** (when user wants to *see* it) | Pre-rendered thumbnails/tiles + compact JSON manifests, published on a cadence to a CDN | Edge service publishes; client reads static artifacts | small tiles; client does at most a **manifest HEAD / tiny GET** for "latest timestamp" — metadata, never pixels |
| **2 — full scientific read** | L1b radiances etc. | Backend-only, on-demand | heavy — **explicit non-goal for v1**; a door we chose not to open, not an omission |

**Why stop at Tier 1:** an aurora prosumer never needs L1b radiances — the derived CSM answer (Tier 0) and a preview tile (Tier 1) cover the entire real use case. The edge-preview indirection means *we* absorb source volatility (CORS, credentials, bucket renames, egress) once, server-side, and publish a stable contract (manifest schema + tile URLs) the client depends on — the same reason imagery resilience (§3.4) sits behind our service rather than hot-linking. If Tier 2 ever becomes warranted, it's additive and backend-only; nothing above changes.

**WASM invariant (state it and hold it):** *the WASM client consumes derived scalars and short series only; all raster handling is server-side.* The on-device consensus engine (§7.1 "go look" score) ingests small derived inputs — multi-model cloud scalars from Open-Meteo, the Tier-0 satellite point-answer, darkness/moon — and does arithmetic. Every input is already a scalar or short array before WASM sees it. The client never parses a raster, ever.

**Observed vs predicted (the clouds' three-clocks discipline):** Tier 0 answers two different questions by source — satellite CSM = "clear *right now*?" (observed nowcast leg) vs multi-model = "clear at midnight?" (forecast leg). Both feed the "go look" score but are distinct epistemic objects; the UI labels them as such, exactly like observed-vs-projected on the space-weather side (§2).

### 4.3 Hosting — Cloudflare, free tier for v1, ~$5/mo for full poller set

The architecture (static client + on-device GPU/WASM compute + thin I/O-bound Workers + cached snapshots) is unusually well-matched to Cloudflare's free tier. Mapping:

| Piece | Cloudflare | Free-tier fit |
|---|---|---|
| Frontend (React/three.js/WASM bundle) | **Pages** | Static assets are free and unlimited |
| API / data reshaping | **Workers** | 100K req/day, 10ms CPU/invocation — but `fetch()` wait doesn't count as CPU, and our Workers are I/O-bound JSON proxies (~2–3ms CPU). Fine. |
| Hot cache (latest snapshots) | **KV** | 1GB, 100K reads/day, **1K writes/day** — fits *one cron writer, many readers*. Never write-per-request. |
| Eval store (predictions/outcomes/scoreboard) | **D1** | 5GB, 5M row-reads/day, 100K row-writes/day — dozens–hundreds of events/yr barely touches it |
| Edge-preview tiles (raster Tier 1) | **R2** | 10GB-month, zero egress fees |
| 3D / particle sim / propagator | **client GPU** | free to host (user's silicon, §4.2) |

**Free-tier budget math (v0.3 — the numbers that actually bind):**
1. **KV writes: 1K/day.** Per-feed writes at 1-min cadence = thousands/day ✗. Fix: one **combined snapshot write per cron tick** (all feeds in a single JSON object) at 5-min cadence = 288/day ✓. Consequence: on free tier the live loop runs at **~5-min granularity** — acceptable (OVATION itself refreshes at 5 min, and the Bz alert still leads arrival by 30–60 min). The $5 plan buys back ~1-min cadence.
2. **Workers requests: 100K/day.** A client polling once a minute through an 8-h evening ≈ 480 requests, so ~200 nightly actives would saturate the Worker — *if* reads went through it. They don't: snapshots publish to an **R2 public bucket on a custom domain behind the CDN cache**, so client reads are cache hits costing zero Worker invocations. The Worker serves only personalized calls (alert subscriptions, BYO-key routing).
3. **Cron triggers: 5/account**, and free-tier cron CPU is 10ms (too tight for the nightly eval refit). Our pollers (SWPC plasma, mag, OVATION, DONKI, GOES CSM, nightly eval…) exceed 5. *v1 workaround:* collapse polling into ≤5 fan-out cron Workers. *Proper fix:* the **$5/mo paid plan** lifts crons to 250 and gives 15-min cron CPU — that single upgrade unlocks the full poller set and the eval batch.
4. **Raster Tier-2 full scientific reads** — would blow the 10ms CPU ceiling, but it's already a non-goal (§4.1), and the propagator runs client-side anyway.

**Verdict:** v1 (both pillars — full 3D heliosphere + aurora answer) fits the free tier at 5-min cadence with R2-served snapshots. The complete product — ~1-min cadences, proper nightly eval refit, scoreboard — is **$5/month, not free**. Nothing forces a redesign or a different host.

**Good-citizen note:** poll NOAA/SWPC/Open-Meteo via cron at a fixed modest rate and have *users read our cache* — never wire user requests straight through to the upstream feeds. This respects their terms, keeps you off their rate limits, and stays inside the read budgets. Same rule for imagery (§3.4): everything client-visible is served from our edge, nothing hot-linked.

---

## 5. Event Model & ID/Tagging

```jsonc
Event {
  id: "2026-06-04T07:31Z-CME-001",   // DONKI-style stable ID; survives versioning
  type: "CME" | "FLR" | "IPS" | "SEP" | "FILAMENT",
  detected_at, peak_at, liftoff_at,
  source: { region (AR#), lon, lat, instrument },   // heliographic source
  kinematics: {                         // from CMEAnalysis, versioned
    speed_kms, half_angle_deg,
    direction: { lon, lat },            // apex direction
    type: "S"|"C"|"O"|"R"|"ER",         // SWPC CME type (speed class)
    measurement: "LE"|"SH"|...,
    is_halo: bool,                      // earth-directed indicator
    version: n, mostAccurate: bool
  },
  flare: { class: "X1.2"|"M5"|..., xray_peak_flux },
  thumbnail: { url, t, wavelength, crop_bbox },   // cropped at liftoff_at
  earth_bound_score: 0..1,              // see §6.3
  links: [event_ids],                   // CME↔flare↔shock↔storm graph edges
  predictions: [Prediction],
  outcome: Outcome | null
}
```

- **Thumbnail generation (v0.3)**: at `liftoff_at`, request the frame from **Helioviewer's screenshot API with the ROI specified** (layer + region + scale — the crop happens *upstream, server-side on their end*), store the small (e.g. 96×96) result in **R2** keyed to the event. **Workers never decode or crop pixels** — that's the §4.1 raster-boundary discipline applied to imagery, and it keeps every poller comfortably inside the 10ms CPU budget. Timeline chips render the R2 object.
- **ID strategy**: adopt DONKI's `YYYY-MM-DDThh:mmZ-TYPE-NNN` so we can join cleanly to NASA/CCMC ground truth, with our own UUID alias internally. Versioned kinematics because CME analyses get revised — keep all versions for the eval loop.

---

## 6. Propagation & Physics Engine

Three fidelity tiers; user/UX picks based on need.

### 6.1 Tier 1 — Fast analytic propagator (default, client+server)
Per-event particle "mass" represented as an expanding **spherical cap** (apex direction + half-angle) on a radially-propagating front.
- **Drag-Based Model (DBM)**: CME velocity relaxes toward ambient solar-wind speed via aerodynamic drag — `dv/dt = −γ (v − w)|v − w|`. Cheap, closed-form-ish, surprisingly competitive for arrival time. γ and ambient `w` become **learnable parameters** (§8).
- Front geometry: render as a translucent shell/cap expanding from the source longitude/latitude; widening with half-angle; thickness ∝ duration.
- Arrival = when the cap crosses 1 AU **and** the apex/flank intersects Earth's instantaneous heliographic position.

### 6.2 Tier 2 — Multi-event interaction
- **N-front interaction**: when a fast CME launched later overtakes a slower earlier one along overlapping cones → **CME cannibalism / merging**. Model as momentum-conserving merge producing a compound front with blended velocity and enhanced density (these compound events are the geo-effective ones).
- **Stream Interaction Regions (SIRs/CIRs)**: fast wind from coronal holes overtaking slow wind → compression bands; recurring at ~27-day solar rotation. Use 27-day recurrence data as a prior.
- **Preconditioning**: a leading CME "plows" the path, letting a trailing CME travel faster (lower drag in the rarefied wake) — a learnable wake term.
- Visualize overlaps explicitly: where two cones intersect, raise a flagged **interaction volume** with combined kinematics and a derived compound Event ID linked to its parents.

### 6.3 Earth-bound determination & magnetosphere coupling
- **Earth-bound score**: geometric (does the cone's angular span contain Earth's heliolongitude at predicted arrival, accounting for ~Parker-spiral offset and half-angle?) × kinematic confidence. Halo/partial-halo CMEs from near disk-center score high.
- **Geo-effectiveness** depends overwhelmingly on **Bz** (a first-class signal here): southward (negative) Bz reconnects with Earth's field and drives storms *and* the aurora; northward is largely benign. We can *measure* Bz at L1 (~30–60 min lead — our short-fuse, high-confidence aurora trigger), and only *estimate* it pre-arrival. **Flux-rope orientation modeling (predicting Bz sign/profile days ahead) is an explicit stretch goal** — v1 mines whatever pre-arrival signal the data already gives (e.g. source-region helicity, historical CME-orientation priors, CCMC fields) and is honest that pre-L1 Bz is a guess. Be explicit throughout: **arrival time is predictable days out; storm/aurora *strength* is not, until L1.**
- Coupling proxies to compute & display:
  - **Newell coupling** `dΦ/dt ∝ v^{4/3} Bt^{2/3} sin^{8/3}(θ/2)` → drives Kp/auroral power.
  - **Estimated Dst** via a Burton/OBrien-McPherron-type injection-decay ODE driven by `v·Bz`.
  - Map to **Kp / NOAA G-scale** for the alerting layer.
- Magnetosphere render: dynamic bow shock + magnetopause standoff distance that compresses with dynamic pressure (`ρv²`); dayside reconnection glow keyed to southward Bz; auroral oval intensity from Newell/OVATION.

### 6.4 Tier 3 — Ingest real MHD (overlay)
Consume WSA-Enlil/CCMC fields as a volumetric overlay rather than simulating. Use for "hero" visualization and as a model baseline in the eval loop.

---

## 7. Frontend / UX

The product has **two faces**: the **3D event visualization** (§7.2 — the founding feature, the thing you watch) and the **aurora answer** (§7.1 — the glanceable "can I see it tonight?" most prosumers act on). Neither is subordinate; they share one engine and both ship in v1. The aurora card is the fastest path to daily-useful; the heliosphere is the reason the project exists.

### 7.1 Aurora visibility — the front door
- **"Tonight" answer card** for the user's location (geolocated or set): a clear verdict — *Likely / Possible / Unlikely* — with the **probability %, our accuracy, and margin of error** (all eval-derived, §8.6), plus the **time window** when it's worth looking and how far north/south to look.
- **Our-vs-NOAA toggle**: show our delay-corrected forecast (§2.1) and, optionally overlaid, NOAA's stock OVATION and other public sources (e.g. **the Glendale App / Aurora Alerts UK**, §3.7) — with each source's **live track record** (§8.7) shown alongside, so the user sees *why* to trust ours.
- **Aurora map**: the OVATION oval rendered on a globe/polar projection, our-delay-corrected, with the **viewline** (equatorward visibility edge) we compute ourselves, the user's location pinned, and the terminator (aurora only visible in darkness).
- **Local viewing conditions mash-up** (this is what makes it prosumer-grade, not just a re-skinned NOAA map):
  - **Darkness/twilight** + **moon phase/altitude** (bright moon washes out faint aurora).
  - **Cloud cover** for the user's location — *two legs* (§4.1): satellite Clear Sky Mask for "clear right now" (observed) and multi-model consensus for "clear tonight" (forecast). Cross-model agreement *is* the confidence; low cloud weighted heaviest (it's what actually blocks aurora).
  - Combine oval probability × darkness × clear-sky × moon into a single honest **"go look" score** — computed **on-device in WASM** over derived scalars (§4.1 invariant), so it works without a round-trip once inputs are fetched.
- **Lead-time ladder**: the same location answered at three horizons — *now/next hour* (L1-driven, high confidence), *tonight/tomorrow* (OVATION + Kp forecast), *days out* (CME propagation, §6, wide error bars). Each labeled with its confidence so the prosumer learns to read them.
- **Alerts** (§7.5): "aurora likely from your location tonight" / "southward Bz just turned — go outside now."

### 7.2 The 3D event visualization (the founding feature)
- Heliocentric scene (WebGPU-primary, §4.2): Sun at origin (textured with the **selected-wavelength SDO image**, switchable 304/193/HMI), Earth at its real heliographic position, L1 spacecraft marker, optional inner planets, Parker-spiral grid. In-scene text via `pretext-rs` (WASM-compiled, composited against the WebGPU canvas — §4.2).
- Scale handling: true distances are 215 R☉ Sun→Earth — use a **toggle between true-scale and a log/compressed scale** so events are visible without losing intuition. Earth rendered at ≥ its real radius (per requirement) even when distances are compressed.
- Each tracked event = an expanding luminous cone/shell from its source, color-coded by speed, opacity by density/confidence, with the **uncertainty cone widening downrange** (lateral + arrival-time spread). The "we can't see it but here's the mass" effect is a **WebGPU-compute particle system** (100k+ particles, §4.2), flow-aligned — not a faked sprite cloud.
- Earth-impact prediction shown as a glowing footprint on the magnetopause + a countdown — and the **predicted auroral oval lights up on the globe** when a front couples in, tying the 3D view directly back to §7.1.

### 7.3 Timeline & time control
- Bottom **scrubber** spanning history ↔ now ↔ projected future (future segment visually distinct = projection, with confidence band).
- Event **chips** on the timeline carry the **thumbnail**; click → focus camera, spawn/replay that event's trajectory simulation Sun→past-Earth, show its metrics panel and prediction-vs-actual if resolved.
- Modes: **Live** (follows the L1/Sun clocks, auto-advancing), **Scrub** (any past instant — replays in-situ measurements + how the projection looked *at that time*, i.e. honest hindcast), **Project** (run propagator forward).
- "As close to real-time as we can get" indicator: a small per-layer clock badge (Sun ~15m / L1 ~30–60m / projection) so users see the three clocks of §2.

### 7.4 Panels
- Live metric strip: solar-wind **speed**, **density**, **Bt/Bz**, **proton flux**, **Kp**, **Dst**, NOAA R/S/G scales — sparklines, with threshold coloring. Bz southward gets prominent treatment (it's the aurora trigger).
- Event detail: kinematics, earth-bound score, predicted arrival window, predicted vs (if known) actual, links to parent/child events, source imagery loop.
- Alerts feed (SWPC alerts + our own earth-bound / aurora predictions).

### 7.5 Alerting
- **Aurora alerts (primary)**: "aurora likely from *your* location tonight" (oval + darkness + clear sky + moon all clear the bar); and the short-fuse **"southward Bz just turned at L1 — go outside in the next ~30–60 min."**
- Space-weather alerts: new CME with earth-bound score > τ; predicted Kp ≥ G1/G2/…; proton flux crossing S-scale.
- Channels **(v1: in-app + Web Push only)**: Web Push via VAPID from a Worker; subscriptions (endpoint, rounded lat/lon, thresholds) live in D1; a cron sweep evaluates them against the latest snapshot. Webhook + email are post-v1 (email needs a sending provider, webhooks need retry infrastructure — neither earns a slot in the five days). Location- and threshold-personalized (a prosumer in Ohio wants Kp≥6 alerts; one in Tromsø doesn't). Privacy note: precise location stays client-side; only the rounded alert location is stored.

---

## 8. The RL / Continuous-Improvement Loop  ← core ask

The job: turn each event into a *closed* record `observation → prediction → measured Earth impact`, score it, and use the residuals to improve the propagator's parameters and the earth-bound/geo-effectiveness models over time. This is fundamentally a **calibration + parameter-learning loop** (the "RL" framing fits as policy = parameter vector / model that we optimize against a reward derived from prediction accuracy).

### 8.1 Why "ground truth" is clean here
Space weather is unusually good for this: every prediction is **automatically labeled by nature within days**. L1 in-situ arrival (shock + speed/density jump), DONKI `IPS`/`GST`, and Kyoto Dst give objective outcomes. No human labeling needed → a genuine self-supervising flywheel.

### 8.2 What we predict (the action/output)
For each earth-bound event: **arrival time** (ETA + window), **arrival speed**, **peak Kp / G-scale**, **min Dst**, **hit/miss** (does it arrive at Earth at all).

### 8.3 Outcome capture (the label)
On arrival, detect at L1: sudden-commencement shock (step in speed/density/Bt), then storm metrics from Kp/Dst over the following 24–48 h. Auto-resolve each open prediction to an `Outcome`.

### 8.4 Eval metrics (the ones you asked to identify)

**A. Arrival-time accuracy** (the headline metric, matches CME Scoreboard convention)
- **ΔT_arrival** = predicted − observed shock arrival (signed, in hours). Report **MAE** and **mean(bias)** separately — bias tells you if you systematically run fast/slow.
- **RMSE** of arrival time; track the **standard deviation** (±x h) as the honest error bar to draw the cone.
- Reliability of the stated window: **PIT / calibration** — does the "80% arrival window" actually contain the truth 80% of the time? (Reliability diagram.)

**B. Hit/miss classification** (does an earth-bound-flagged CME actually arrive)
- Confusion matrix → **POD** (probability of detection), **FAR** (false-alarm ratio), **CSI/TS** (critical success index), **HSS** (Heidke skill score), **Brier score** for the probabilistic earth-bound score, plus a reliability curve.

**C. Arrival speed**
- MAE / RMSE on arrival `v` (km/s); correlation with observed.

**D. Geomagnetic-strength prediction**
- **Kp / G-scale**: MAE in Kp units, confusion matrix on G-class.
- **Dst**: RMSE (nT), error on **min-Dst** and on **timing of min-Dst**.
- Coupling sanity: correlation of predicted Newell coupling vs observed.

**E. Skill vs baselines** (so "improvement" means *beating something*, not vibes)
- Compare against: **persistence/climatology**, raw **DBM** with default γ, and the **WSA-Enlil / CCMC Scoreboard ensemble**. Report **skill score** = `1 − MSE_model/MSE_baseline`. Shipping value = positive skill vs Enlil and vs default-DBM.

**F. System/latency metrics** (real-time quality)
- Detection latency (eruption → event in our system), prediction freshness, data-gap coverage.

**G. Aurora-visibility accuracy** (the metric that matters most for *this* product)
- **Oval-position error**: predicted vs observed equatorward boundary latitude (from ground magnetometer chains / OVATION verification). MAE in degrees of latitude — this is "did we say the right people could see it."
- **Per-location hit/miss**: for an observer at lat/lon, did our *visible* verdict match reality? Crowd-sourced sightings (§8.7) + all-sky-cam networks as ground truth. POD/FAR/CSI on "aurora was actually visible from here."
- **Kp/G timing & magnitude** (from group D) is the upstream driver; oval error is the user-facing translation.
- **Delay-correction win**: directly score our delay-corrected nowcast vs NOAA's fixed-30-min baseline against measured ground response — this *quantifies the §2.1 claim* and is the number we headline.

**Accrual honesty (v0.3):** the metric groups fill at wildly different rates. Group G's delay-correction/onset-timing and per-location nowcast metrics accumulate **continuously** — every disturbed hour is a datapoint, so they're meaningful within weeks. Groups A–E need *resolved CME arrivals* — dozens per year — so they stay sparse for months after launch. The published-accuracy feature (§8.6) and the scoreboard (§8.7) therefore lead with nowcast metrics and show CME-arrival columns with their small n in plain sight.

### 8.5 The optimization (closing the loop)
- **Parameter learning**: γ (drag), ambient wind `w`, wake/preconditioning term, half-angle→width mapping, and the Bz-orientation prior are parameters θ. Define **reward** `R = −(w₁·|ΔT| + w₂·Brier + w₃·Dst_err + w₄·oval_err)` (negative weighted error, now including the aurora term). Optimize θ on the rolling labeled set.
  - Start with **Bayesian/online regression + calibration** (fast, interpretable, few-shot — there are only dozens–hundreds of geo-effective CMEs/yr, so data is *small*; resist over-parameterizing).
  - Graduate to **contextual bandit / policy-gradient** where the "policy" maps event features (speed, half-angle, source location, ambient state, preceding-CME context) → corrections on the physics prior. RL proper is justified for the **sequential** multi-CME case (each launch decision-conditions the medium for the next), but bootstrap from supervised residual-learning first to avoid sample-starvation.
- **Calibration as a first-class output**: isotonic/Platt-scale the earth-bound score and conformal-predict the arrival window so the cones we draw are *honest*. The reliability diagram is both an eval metric and a thing we actively fit.
- **Per-regime models**: error structure differs for fast halo CMEs vs slow streamers vs SIRs — segment and learn per regime; track skill per segment.
- **Leakage discipline**: strictly separate "what was knowable at prediction time" from post-hoc revised CMEAnalysis versions. The hindcast in Scrub mode must reconstruct the *then-available* inputs, or the eval is fiction.
- **Human-in-the-loop labels**: DONKI forecaster `notifications` and the CCMC Scoreboard give expert annotations to cross-check auto-resolved outcomes.

### 8.6 Published accuracy + margin of error (transparency as a feature)
Every forecast we surface ships with its own track record — not a static disclaimer, a *live* number from the loop:
- **Accuracy**: rolling skill/hit-rate for that prediction *type and regime* (e.g. "our tonight-aurora calls for your latitude have been right 78% of the last 90 days"). Pulled straight from §8.4 metrics, segmented by horizon and conditions.
- **Margin of error**: the conformal/calibrated interval (arrival window ±h, oval boundary ±° lat, probability ± band). Because we conformal-predict (§8.5), the stated interval has a *guaranteed* empirical coverage — we can honestly say "80% means 80%."
- **n and interval, always (v0.3)**: every published accuracy ships with its sample size and a Wilson/conformal interval — "right 78% of the last 90 days" is meaningless without n. Below a minimum n, show **"collecting"** instead of a number; an honest blank beats a noisy percent. (This is what makes the launch-week scoreboard tenable at all — see the §8.4 accrual note.)
- **Why-it-might-be-wrong**: surface the dominant uncertainty driver (e.g. "pre-arrival Bz unknown" vs "data gap at L1" vs "CME-CME interaction") so the prosumer understands the confidence, not just consumes it.
- Model-transparency is a stated product value: we'd rather show a humble, correct error bar than a confident wrong point estimate. This is also our trust moat vs. apps that just re-skin OVATION with no accountability.

### 8.7 Multi-source scoreboard (track everyone's accuracy, including ours)
A public, continuously-updated comparison — the same eval harness pointed at every forecaster:
- **Sources scored**: ours (delay-corrected), NOAA stock OVATION / SWPC Kp forecast, CCMC CME Scoreboard community predictions, **the Glendale App / Aurora Alerts UK** (§3.7 — methodologically independent: measured substorm onset, not modeled oval; Telegram-stream ingest, no API), **AuroraWatch UK** (§3.7 — free XML API), and any other public model we can ingest. Same ground truth (L1 arrival, GST/IPS, Kyoto Dst, crowd sightings), same metrics, same regimes.
- **What it buys us**: (a) honest proof we're better where we claim to be (§2.1), (b) a feature prosumers love — "who should I trust this week?", (c) a research signal — where a competitor beats us is a direct to-do for the loop.
- **Crowd-sourced sightings** as an additional ground-truth stream: let users confirm "saw it / didn't" with location+time; feeds group-G verification and the per-location hit/miss metric. (Moderate for noise; weight by corroboration — and cross-check against the Glendale App's live sighting map (§3.7), the most mature existing instance of exactly this stream.)
- Render it as the **public scorecard** of §10 — live arrival-time MAE, aurora hit-rate, and skill-vs-NOAA, out in the open.

### 8.8 Loop cadence
Nightly batch: resolve newly-arrived events → recompute metrics dashboard (ours + all tracked sources) → refit θ on rolling window → A/B the new θ against current in shadow mode → promote if skill improves and calibration holds. Long-horizon: re-evaluate per solar-cycle phase (activity is wildly non-stationary across the ~11-yr cycle).

---

## 9. Decisions made & still-open questions

**Decided (v0.2):**
- **v1 deadline: June 17, 2026.** Both pillars ship together; no MVP-without-3D.
- **Audience:** prosumer aurora-chaser. Realism *and* legible uncertainty; SWPC "not operational" disclaimer stays.
- **We publish our own forecast** with eval-derived accuracy + margin of error (§8.6); filter/compare other sources and **track their accuracy too** (§8.7).
- **Bz** is a first-class modeled signal; **flux-rope orientation is a stretch goal** — mine what signal the data gives first (§6.3).
- **History depth: 30 days** (matches DONKI default; SWPC in-situ JSON gives 7-day high-res, so 30-day in-situ comes from the 1-day/daily aggregates + cached pulls).
- **Cloud cover architecture (§3.6, §4.1):** Open-Meteo multi-model consensus (forecast leg, **free tier — non-commercial product**; self-host if that ever changes) + **light GOES Clear Sky Mask nowcast in v1** (point-answer only, Americas, ~15 min, no tiles). Lazy-pull source registry with BYO-key; **WASM does derived-scalar math only, all rasters server-side, stop at raster Tier 1 (point answer + edge preview), Tier 2 full reads are a non-goal for now.**
- **v1 scope = two parallel pillars (§11):** the **3D event visualization is a founding v1 feature**, not a later phase — it's the reason the project exists. It ships alongside the aurora answer; the eval loop follows.
- **Client rendering & compute (§4.2): WebGPU-primary** (Baseline Jan 2026) with WebGL2 fallback via three.js for the ~5–10% tail. **WASM for light scalar logic, WebGPU compute for the heavy parallel sims** (particles, ensembles, oval/coupling grids) — both in v1. Client GPU cost is free to the host.
- **Text in the GPU/canvas layer:** use **`pretext-rs`** ([github.com/MikeSchirtzinger/pretext-rs](https://github.com/MikeSchirtzinger/pretext-rs)) — compile to WASM, composite against the WebGPU canvas. Confirmed approach; no TBD.
- **Store: Cloudflare D1 + KV + R2** — events/predictions/outcomes in D1 (SQLite graph via foreign keys), hot snapshots in KV, edge tiles in R2. No SurrealDB.
- **Hosting (§4.3): Cloudflare** — Pages + Workers + KV + D1 + R2. Free tier covers v1 (collapse pollers into ≤5 cron Workers; keep GOES decode cheap); **~$5/mo** for the full poller set + nightly eval refit. No redesign needed; non-commercial keeps Open-Meteo free.
- **Top "extra" features (aurora layer, replay, confidence cones, backside CME, public scorecard) are in scope** — see §10, several now promoted into the core (§7.1, §8.7).

**Newly decided (v0.3):**
- **Default look: scientifically faithful** — accurate cones/scale/fields with restrained glow as the shipped default ("beautiful but honest"), full cinematic volumetrics behind a toggle. Faithful-by-default is the only choice consistent with the transparency moat (§8.6), and it's also the cheaper GPU path for launch week. *(was open #1)*
- **v1 stays Earth-focused.** "At least past Earth" is met; Mars/inner planets/STEREO vantage are post-v1 additions the scene graph already permits. *(was open #2)*
- **No server-side model runs.** v1 ingests *published* Enlil/CCMC output only (§6.4 overlay). Running/queueing our own runs is the one thing that breaks the $5 ceiling — parked until the eval loop proves the DBM is the binding error source, which is the only evidence that would justify the cost. *(was open #3)*
- **Imagery resilience: yes, hard v1 requirement — implemented as routing**, not a subsystem: all client imagery via our edge cache with per-layer failover (Helioviewer → direct SDO/SUVI → last-good + staleness badge), §3.4. *(was open #5)*
- **Data refresh & cost: resolved by §4.3** — cron → KV/R2 cache, users never touch upstreams, 5-min cadence free / ~1-min at $5/mo. *(was open #6)*

**Still open:**
1. **Multi-event interaction fidelity.** Recommendation: ship the momentum-merge heuristic + flagged interaction volumes in v1 *as visualization* (it's load-bearing for the founding view), and treat interaction *forecast* fidelity as an eval question — revisit only when §8.4-E shows interaction-regime residuals dominating the error budget. More physics before that evidence is speculation with extra steps.
2. **Crowd-sightings moderation.** Recommendation: launch with corroboration-weighted reports cross-checked against Glendale's sighting map (§3.7) and magnetometer ground truth; defer reputation/anti-gaming design until there's enough report volume to be worth gaming.

---

## 10. Additional feature suggestions

*(Aurora visibility, confidence cones, the public scorecard, the Bz-turn alarm, and crowd sightings have been **promoted into the core** — §7.1, §7.5, §8.6–8.7. What remains below is genuinely additive.)*

**High value**
- **Replay / "this day in space weather."** Scrub to famous events (2024 Gannon/Mother's Day G5, Halloween 2003, the 2012 near-miss) as guided tours + a sandbox to launch hypothetical CMEs and watch them propagate — great prosumer engagement + onboarding.
- **Backside/limb CME awareness.** Flag CMEs leaving the far side (via STEREO) that will rotate into geo-effective position in ~days — extends aurora lead time and is a real forecasting edge.
- **Stream Interaction Region tracking** with the 27-day recurrence overlay (last rotation ghosted in) — explains the recurring auroras that *aren't* from a CME (a thing aurora-chasers chronically misjudge).
- **Trip/aurora-planner mode.** "Where and when should I go in the next N nights to maximize my odds?" — combines oval forecast + darkness + cloud climatology + the user's reachable locations. A natural prosumer premium feature.

**Medium value**
- **Impact translation panel.** Map predicted Kp/G to plain-language consequences (aurora latitude, plus HF radio, GPS error, satellite drag, grid GIC) — makes the numbers mean something.
- **Solar-cycle context strip** (sunspot number / F10.7) so users see where we are in the ~11-yr cycle and why activity is high/low.
- **Sonification** of the solar-wind stream (Bz/density → audio) — surprisingly compelling and accessible.
- **Shareable aurora/event cards + permalinks** (`/event/2026-06-04T07:31Z-CME-001`, or "tonight from {place}") with thumbnail + outcome — natural growth loop.
- **"Was the forecast right?" recap** — push the morning after a predicted event: what we said, what happened, where you stood. Closes the loop *for the user*, builds trust, and harvests sightings.

**Speculative / later**
- **Magnetosphere "weather report"** subview (radiation belts, SAA, satellite-drag index).
- **Ensemble launcher** — perturb CME speed/direction/half-angle, run N propagations, render the spread (Monte-Carlo cone done right).
- **API/embeds** so others can drop the 3D view or pull our resolved-event/scoreboard dataset.
- **ML flare *forecasting*** from HMI magnetograms (active-region complexity → flare probability) — a research track, data's free, extends the loop upstream of eruption and could push aurora lead time out further.

---

## 11. Build order — agent-factory execution

**Execution model (v0.4):** this spec feeds a **parallel agent-loop factory** — fleets of agent loops, with humans only at a few taste/provisioning gates. That kills the v0.3 premise that engineering hours are the scarce resource. What's actually scarce, in order: (1) **dependency structure** — the few things that must serialize; (2) **machine-verifiable completion** — an agent loop is only as good as its done-signal; (3) **wall-clock externals** no fleet can compress (§11.5); (4) **human gates** (§11.3). So: v0.3's day-by-day human schedule is replaced by a contracts-first work-package DAG, the de-scope ladder is demoted to external-failure contingency, and **the full v1 feature set is the plan** — labor is never a reason to cut.

**v1 is still two pillars in parallel, not aurora-first.** The 3D visual tracking of the Sun's events is the *origin* of the project; both ship in v1. They share the ingest spine and meet at the B3 tie-in. The eval loop's *numbers* follow post-v1 because they need outcome history (§11.5) — but its *capture* requirements start day one (spine checklist), and its machinery is cheap enough for a stretch package.

### 11.1 v1 acceptance checklist (binary — every line is an agent loop's exit criterion)

**Harness rule (v0.4):** every line ships with a **machine-runnable verification harness** — fixture test, property test, or browser-QA story — so a loop can declare done without a human. Inherently-visual lines additionally emit screenshot/video artifacts routed to the canvas gate (§11.3). Atomic and binary; no vibes.

**Shared spine**
- [ ] SWPC plasma/mag/Kp/Dst + OVATION + DONKI polled on cron; one combined snapshot lands in KV/R2 on cadence (§4.3 math); client renders the live metric strip with per-layer clock badges (the three clocks, §2). *Bz front-and-center.*
- [ ] Every poll tick captured **append-only with its as-of timestamp** — the §8.5 leakage discipline starts day one because it **cannot be retrofitted**; without it the future hindcast eval is fiction.
- [ ] Contract tests pinned on every upstream feed shape (LearningTests-style) — SWPC's viewer migration lands ~June 30, *two weeks post-launch*; adapters must fail loudly, not silently.
- [ ] Event store: DONKI events land with stable IDs, versioned kinematics, link edges (§5).

**Pillar A — heliosphere**
- [ ] WebGPU scene: SDO-textured Sun (304/193/HMI switchable), Earth at true heliographic position, L1 marker, Parker grid, true↔compressed scale toggle; WebGL2 fallback boots on a non-WebGPU browser.
- [ ] Tracked CMEs render as expanding DBM-driven cones/shells with the uncertainty cone widening downrange; GPU particle system at ≥100k particles on at least one event — a **replayed historical event counts** if the Sun is quiet during launch week.
- [ ] Timeline scrubber: **30 days of history** (restored to the bar — backfill package W1-P9 runs in parallel: SWPC 7-day high-res + archive/aggregate sources for the rest) ↔ live ↔ **project**; event chips with thumbnails; click-to-focus.
- [ ] In-scene text via `pretext-rs` composites correctly over the WebGPU canvas (screenshot artifact → canvas gate).

**Pillar B — aurora answer**
- [ ] Geolocated "tonight" card: Likely/Possible/Unlikely + probability + time window, from the delay-corrected oval.
- [ ] §2.1 correction live: measured-speed L1→Earth delay applied, with the stale-feed fallback + "degraded" label.
- [ ] "Go look" score on-device in WASM with **both legs** (restored to the bar): Open-Meteo multi-model consensus *and* the GOES CSM Tier-0 nowcast point-answer, × darkness × moon.
- [ ] Web Push alert pair live ("aurora likely tonight" + "Bz just turned") — restored to the bar.
- [ ] Our-vs-NOAA toggle shows both ovals; track-record numbers display **"collecting"** until the eval has n (§8.6) — the toggle ships, the bragging waits for data.
- [ ] B3 tie-in: an Earth-coupled tracked event lights the predicted oval on the globe.

**Stretch (non-gating; factory-cheap — queue when loops free up):** interaction-volume visuals (§6.2 visual layer), outcome-capture + eval-dashboard *machinery* shipping dark ("collecting"), one replay/"this day" guided tour (2024 Gannon storm).

**Explicitly post-v1 (data-bound or genuinely additive):** published accuracy *numbers* + scoreboard go-live (§11.5), crowd sightings, parameter learning, physics-Tier-2 interaction *modeling*, Tier-3 Enlil overlay, alert channels beyond in-app/push, raster Tier-1 preview tiles, Himawari/Meteosat.

### 11.2 Work-package DAG (contracts first, then fan out wide)

With many loops running concurrently, the dominant risk shifts from "not enough time" to **integration churn and contract drift**. The DAG is built to kill that risk at the root:

**Wave 0 — contracts (serial; the only true bottleneck, hours not days).** Freeze: combined-snapshot JSON schema, Event schema (§5), the shared WASM crate's API surface (function signatures for DBM / coupling / §2.1 delay / go-look score / darkness-moon astronomy), R2 object layout + naming, and the scene↔data interface. Deliverable: a `contracts/` directory — JSON Schemas + **golden fixture files** + contract tests. Every downstream package develops and verifies **against fixtures, not against each other** — packages never block on packages. Post-Wave-0 contract changes are explicit versioned events, not drift.

> **Status: DRAFTED & GREEN, 2026-06-12** — `contracts/` lives in the project repo at `~/dev/helioverse/contracts/`: 3 JSON Schemas (snapshot, event+prediction+outcome, alert-subscription), the frozen `helio_core` WASM API surface with pinned numeric semantics, the R2 layout (incl. retention + free-tier budget math), 6 golden fixture instances, 5 vector files (57 cases incl. ephemeris anchors), and a runnable validator. Green light: `uv run contracts/tests/validate.py` → exit 0 (verified). Wave 1 is dispatchable.

**Wave 1 — wide fan-out (all packages independent once contracts exist; one loop each, more in parallel where noted):**

| Package | Contents | Done-signal (the harness) |
|---|---|---|
| W1-P1 pollers (×6 parallel loops, one per feed) | SWPC plasma/mag/indices, OVATION, DONKI, GOES CSM sampler; as-of capture; combined-snapshot writer | fixture round-trip + live pull validates against schema; as-of rows provably append-only |
| W1-P2 physics crate (Rust→WASM) | DBM, Newell/Dst, §2.1 delay, go-look score, darkness/moon | property tests + golden vectors (e.g. 400 km/s → ~62-min delay; published DBM arrival cases) |
| W1-P3 scene skeleton | WebGPU init + WebGL2 fallback, Sun/Earth/L1, camera, scale toggle | boots headless on both paths; screenshot artifacts emitted |
| W1-P4 imagery pipeline | edge cache + per-layer failover (§3.4), Helioviewer ROI thumbnails → R2 | failover drill: kill primary in fixture → staleness badge appears |
| W1-P5 aurora card + map | tonight card, oval render, our viewline, terminator, user pin | browser-QA story against fixture snapshots |
| W1-P6 timeline | scrubber (history↔live↔project), chips, click-to-focus | browser-QA story |
| W1-P7 alerts | Web Push (VAPID), D1 subscriptions, cron sweep | test subscription receives push on a synthetic threshold cross |
| W1-P8 panels | metric strip + sparklines + threshold coloring, event detail panel | browser-QA story |
| W1-P9 history backfill | 30-day in-situ + event/imagery backfill from archives/aggregates | row counts + spot-checks vs sources |

**Wave 2 — integration packages (each depends only on named Wave-1 outputs):**
- **W2-I1 particles-on-DBM** (P2+P3): 100k+ GPU-compute particle system driven by the propagator field; cones/shells + uncertainty widening from real CMEAnalysis params.
- **W2-I2 B3 tie-in** (P2+P3+P5): Earth-coupled event lights the predicted oval on the globe.
- **W2-I3 ours-vs-NOAA toggle + three-clocks badges** (P1+P5+P8).
- **W2-I4 scrub modes incl. honest hindcast** (P1 as-of data + P6): replaying the past shows what the projection looked like *then*.

**Wave 3 — verification fleet:** one loop per §11.1 checklist line running its harness; browser-QA stories per user flow; device-matrix runs on every reachable real device (WebGPU driver variance, §4.2); an **adversarial leakage pass** that actively tries to find any prediction-time read of post-hoc data (§8.5); and an integration **soak — 12–24 h wall-clock, not compressible** — watching poller/snapshot/scene stability before ship.

### 11.3 Human gates (the only points where a person serializes the flow)

1. **Provisioning (early, ~30 min):** Cloudflare account + custom domain + R2 public domain, NASA API key, VAPID keypair. Secrets never enter agent loops.
2. **Canvas taste pass (the reserved human work):** default-look grade — bloom level, palette, particle density/feel, label legibility over the scene. Reviews the screenshot/video artifacts from W1-P3/W2-I1; iterate agent-generates / human-approves until it passes taste.
3. **Real-device spot-check:** at least Mac + one Windows/Android + one iOS Safari 26 — automated matrices catch crashes, humans catch "looks wrong."
4. **Ship go/no-go** on the Wave-3 checklist sweep.

### 11.4 Contingency (formerly the de-scope ladder — external-failure only)

Labor is never the trigger; only an **external dependency failing** is. Pre-agreed mappings: GOES CSM bucket access fails → forecast-leg-only score, labeled "forecast only" (the §4.1 two-legs design makes it a clean amputation); Helioviewer ROI endpoint fails → direct-SDO thumbnails; archives too thin → 7-day history at launch + visible backfill note; a device class fails WebGPU → it gets the WebGL2 fallback, which is already the plan. **Floor unchanged:** delay-corrected tonight card + live 3D DBM cones + timeline. If an *external* failure threatens the floor by June 16, **the date moves, not the floor.**

### 11.5 What the factory cannot compress

- **Ground-truth accrual (§8.4):** CME arrivals come at nature's rate — dozens/yr. Published accuracy shows "collecting" until n is real, no matter how many loops run. (Hence: eval *machinery* may ship in v1 as a stretch package, dark; the *numbers* and parameter learning stay post-v1.)
- **Upstream cadences and latencies (§2):** the three clocks are physics, not engineering.
- **Platform budgets (§4.3):** the free-tier math binds regardless of who writes the code, and polling etiquette stays conservative — a thousand agents must not translate into a thousand pollers hitting SWPC.
- **Soak and bake time:** a 24-h stability soak takes 24 h; schedule it to overlap the canvas-taste iterations, not after them.

### 11.6 Then — the eval loop & beyond (post-v1; data-bound or additive)

1. **Published accuracy/MoE numbers + scoreboard go-live** as n accrues (machinery may already exist dark from the stretch package) — nowcast metrics first per the §8.4 accrual note, delay-corrected vs NOAA baseline, arrival-time MAE/bias, oval-position error, per-location hit/miss.
2. **Crowd sightings + Glendale/AuroraWatch ingest** (§8.7) — prove "better, here's why," start harvesting ground truth.
3. **Parameter learning / calibration refit** (optimization half), shadow-mode A/B, promote-on-skill. Loop closed end-to-end.
4. **Physics-Tier-2 multi-event interaction modeling** (§6.2) + magnetosphere coupling viz + backside/limb CME awareness + replay/"this day" mode (if not landed as stretch).
5. **Physics-Tier-3 Enlil/CCMC overlay** (§6.4), ensemble launcher, trip-planner, API/embeds. *Cloud extras land here too: edge-preview tiles (raster Tier 1), Himawari + Meteosat for global coverage.*

*(Note: "physics-Tier-N" = propagator fidelity, §6. The separate "raster Tier 0/1/2" in §4.1 is the cloud/imagery data-movement boundary — same word, unrelated axis.)*
