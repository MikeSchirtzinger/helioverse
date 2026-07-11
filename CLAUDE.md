# Helioverse — working agreement for AI agents

Helioverse is an **educational space-weather instrument**, not a sci-fi visual.
Its job is to help a human understand REAL heliophysics through accurate visual
representation and ML methods. **Credibility is the product.** A single fake or
unsourced element poisons trust in the whole dashboard.

## Prime directive: everything ties to real, verifiable data

**Every visual element and every encoded attribute — position, size, colour,
brightness, motion, count, opacity, label — must map to a specific, named
real-world quantity from a named, verifiable source.** If you cannot name the
source AND the field/column it comes from, it does not ship.

No fake, mock, placeholder, "for now", default-constant, or
decorative-that-looks-like-data elements. **A fallback that *looks* like real
data is worse than an honest empty state.** When real data is unavailable, show
an explicit "unavailable / no frame / no measurement" state — never a synthetic
stand-in a viewer could mistake for reality. The Sun is always the real Sun.

### Current NOAA upstream contract (effective 2026-06-30)

NOAA SCN 26-21 removed the legacy `products/solar-wind/mag-1-day.json` and
`plasma-1-day.json` feeds. Use `json/rtsw/rtsw_mag_1m.json` and
`json/rtsw/rtsw_wind_1m.json`; select only `active: true`, sort by `time_tag`,
and preserve `source`, `overall_quality`, and the instrument timestamp in the
UI. SOLAR-1 is currently primary; ACE and IMAP rows may appear. DSCOVR
processing has stopped, so older research notes that name it as the live source
are historical rather than the production contract.

## The ONE allowed synthesis

The only synthetic thing we add is **visual interpolation/extrapolation between
real data points or data sets**, purely to aid human visual understanding (e.g.
smoothing a CME front between a *measured* launch speed and a *measured* arrival
ETA via the drag-based model; tweening between two real imagery frames). Rules:

- It must be **anchored on both ends by real measurements or model output.**
- It must be **labelled** interpolated/modelled — never presented as measured.
- It must **not invent structure** that the anchoring data doesn't imply.

## Provenance vocabulary — always show it

Every number and visual carries its provenance, in consistent language:

- **measured** — direct instrument/feed value (NASA DONKI, GOES X-ray, NOAA SWPC
  active RTSW spacecraft, Helioviewer/SDO, OVATION Prime).
- **modelled** — physics model output (DBM CME propagation, Shue-1998
  magnetopause, WSA-Enlil Kp/arrival).
- **estimated** — derived with stated assumptions (e.g. CME mass from angular
  width — DONKI carries no mass).
- **interpolated** — visual tween between real anchors (see above).

Cite it inline ("Speed (DONKI)", "modeled from activity", "~… (est.)"). This
pattern already exists in `scene-events.tsx` / `SceneStage.tsx` — keep it
everywhere.

## Flag, don't hide

If anything is NOT tied to real data, or could blur measured vs
modelled/interpolated, **FLAG it** — both in the UI (a visible label) and in a
`// PROVENANCE:` code comment — or remove it. Surfacing "visual aid / not
measured" is mandatory, never optional. The audience is here to learn what is
real; confusing reality is the cardinal sin.

## Production truth constraints (verified 2026-07-11)

- **Sun:** only real Helioviewer/SDO imagery is rendered. Missing imagery becomes
  an explicit unavailable state; there is no procedural solar disk fallback.
- **Solar wind:** particles and Parker geometry are shown only when current RTSW
  speed and density exist. A neutral construction seed may exist internally,
  but it is hidden and never surfaced as a measurement.
- **Earth:** the bundled NASA Blue Marble texture is authoritative. No synthetic
  continents or clouds are substituted while it loads or fails.
- **Aurora:** the Earth overlay comes from the current OVATION probability grid.
  When that latest-only grid is absent or the clock is historical, the overlay
  is withheld; there is no synthetic aurora torus.
- **CME fronts:** launch parameters are measured DONKI analysis; propagation is
  labelled DBM/modelled; the near-Sun launch leg is labelled interpolated.
- **Magnetosphere:** live mode requires measured wind, density, and Bz for the
  Shue boundary. Historical replay may use its explicitly labelled event proxy.
- **Time:** current RTSW/OVATION values are never painted onto a scrubbed event.
  Historical views show the event clock and withhold latest-only inputs.

## Before adding or changing any visual, answer (in a comment + the PR):

1. What real source + field backs this? (name it)
2. What does each visual attribute encode, and in what units?
3. Is anything synthetic? If so, is it labelled measured/modelled/estimated/
   interpolated and anchored on real data on both ends?
4. Could a viewer mistake this for a measurement it isn't? If so, flag or remove.

Then **verify it in a real browser against the live feed** before claiming it
works. Mocks and fallbacks do not count as working.
