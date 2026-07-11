# Heliospheric Flow Mode — design contract

> Status: **proposed** (awaiting sign-off before implementation).
> Born from the `solarwind.webp` reference: a top-down, true-scale, black-body
> heliosphere where every particle is a real simulation tracer.
> Governed by `CLAUDE.md` (prime directive) and the SpaceWeather skill.

## 1. The thesis

The `solarwind.webp` aesthetic — millions of additively-blended particles on
pure black, a black-body (Planck/Wien) colour ramp — is **gorgeous AND honest
in the same gesture**, because the incandescence ramp (deep red → orange →
white-hot) is a real physical encoding: hotter = whiter. That lets one palette
carry a *measured* quantity (speed or temperature) instead of being decoration.

The place this look belongs is the **true-scale top-down ecliptic view** — the
regime where true-scale is already honest and legible (the heliosphere is
genuinely a thin disk). It is the flow-field version of the existing true-scale
minimap. Done right it is breathtaking *and* correct: a living true-scale
heliosphere where **brightness = density, hue = speed, CME shocks ripple out as
real expanding rings**.

## 2. What each visual attribute encodes (the prime-directive table)

Every attribute must name its source + field. This table is the contract; an
attribute not on it does not ship.

| Visual attribute       | Encodes                          | Source (named field)                         | Provenance tag            |
| ---------------------- | -------------------------------- | -------------------------------------------- | ------------------------- |
| particle position      | plasma flow along Parker spiral  | parker-grid driven by live L1 `speed_kms`    | modelled (flow field)     |
| particle colour (hue)  | solar-wind bulk speed            | active SWPC RTSW `proton_speed` row at L1     | **measured**              |
| particle brightness    | proton density                   | SWPC plasma `density` (protons/cm³)          | **measured**              |
| particle count (local) | local plasma density             | SWPC `density` → sampling weight             | measured (visualized)     |
| expanding rings        | CME shock fronts                 | DONKI CME + DBM `cme-propagation.ts`         | modelled (DBM), interpolated front |
| bright core            | the Sun                          | SDO / GOES (existing real disk)              | measured                  |
| spiral arm geometry    | Parker spiral φ = φ₀ − (Ω/v)(r−r₀)| live L1 speed → Ω/v                          | modelled from measured L1 |
| the disk plane         | the ecliptic, top-down           | true-scale (1 AU = 1 AU)                     | — (view frame)            |

**Reserved colours (do not violate):**
- **Green (557.7 nm) / red (630 nm) / pink (N₂⁺)** → auroral emission ONLY.
  This palette must **never** touch the aurora oval. (See trap 1.)
- **Black-body red→orange→white** → heliospheric flow speed/temperature only.

## 3. The three traps (where this becomes a lie) — and the fences

### Trap 1 — putting the black-body palette on the aurora.
Real aurora is emission-coloured by altitude (green 557.7 nm low, red 630 nm
high). Black-body red over the pole repeats the exact colour-collision bug the
2026-06-17 audit flagged as the #1 offender.
**Fence:** the aurora oval (Earth-impact view) keeps its single-aurora-green
probability encoding (fixed this session in `canvas-effects.ts`). The flow mode
is a **separate top-down heliosphere view**; the two palettes never share a
frame. Code guard: the flow-mode renderer must not render any aurora/oval
geometry, and the Earth-impact view must not render flow particles.

### Trap 2 — particle count outrunning data.
4 M particles is 4 M chances to imply structure nobody measured. A pretty
uniform field reads as "the solar wind looks like this everywhere," which is
false (it has stream structure, CIRs, holes).
**Fence:** position from a real flow model only (Parker spiral / DBM / MHD);
brightness from measured density; colour from measured speed; density itself
drives the *local* particle density (more sprites where plasma is denser).
Anything tweened between real anchors gets the **interpolated** label. Where L1
data is absent, the field hides — same rule as the existing solar-wind stream
(`setSolarWindConditions` returns false → hidden, never a fabricated default).

### Trap 3 — borrowing accretion-disk grammar.
MRI turbulence, relativistic jets, a central singularity, radial spokes — these
are black-hole structures that do not exist in the heliosphere.
**Fence:** take the *rendering* (additive particles, black-body ramp, pure-black
bg), never the *grammar*. No radial spokes, no jets, no turbulent vortex. The
only structures are: radial/Parker-spiral flow, CME shock rings (real DBM
fronts), and density brightness. A provenance comment on each structure names
the physics it represents.

## 4. Implementation shape (sketch — not yet built)

- **Renderer:** WebGPU primary (three.js `WebGPURenderer` already wired in
  `scene-setup.ts`), compute-shader particle advection; WebGL2 fallback degrades
  to the existing `Points`-based solar-wind stream (cap ~1200).
- **Camera mode:** a new `interactionMode: 'heliosphere-flow'` — top-down
  ecliptic, true scale (`ScaleMode === 'true'`), 1 AU legible with Earth held to
  `EARTH_MIN_SCENE_RADIUS`. This is the opt-in "Real distances" wide view the
  scale discussion called for.
- **Particle field:** seeded along Parker-spiral streamlines
  (`computeParkerSpiral`), advected radially at measured L1 speed; per-particle
  colour from speed (black-body ramp, same `SPEED_STOPS` family as the CME ramp
  in `cme-style.ts` — reuse so the whole heliosphere shares one speed→colour
  law); per-particle brightness/size from density. Density missing → hide.
- **CME shocks:** existing `cmeFrontRadiusKm` / DBM front as an expanding ring
  (additive torus or particle shell), labelled "DBM front (modelled)".
- **Scale readout:** persistent quantitative compression/true multiplier on
  screen ("true scale — 1 AU = 1 AU; Earth marker ×N enlarged"). True scale needs
  no compression note, but Earth's min-size floor must be labelled.
- **Provenance X-ray:** optional toggle tinting every element by provenance
  (measured/modelled/estimated/interpolated) — the whole scene becomes a
  credibility map. Pairs with the reserved-colour discipline so tints stay
  unambiguous.

## 5. Acceptance against the prime directive (must pass before shipping)

1. Can you name the source + field behind each visual attribute? (table §2)
2. Is anything synthetic? If so, is it labelled and anchored on real data both ends?
3. Could a viewer mistake this for a measurement it isn't? (esp. uniform field
   implying measured structure — trap 2.)
4. Does any element borrow the aurora palette, or accretion-disk grammar? (traps 1, 3)
5. Does it hide (not fake) when L1 data is absent?
6. Verified in a real browser against the live feed — not against mocks.

## 6. Production foundations already in place

Already landed:
- **① Aurora probability ramp** → single aurora-green, alpha ∝ probability
  (`canvas-effects.ts`). Red reserved for future altitude-curtain.
- **② CME speed ramp** → black-body red→orange→white-hot, green removed
  (`cme-style.ts`). This is the *same* palette the flow mode will use, so the
  whole heliosphere shares one speed→colour law and green stays aurora-only.
- **④/⑤ Silent dark Sun** → explicit "Sun — SDO imagery unavailable" DOM label
  when real-imagery is on but no disk loaded (`HelioCanvas.tsx`).
- **⑥ Parker spiral seed** → live geometry is driven from the active RTSW
  speed; when no current speed exists the wind field is hidden instead of
  exposing the neutral construction seed (`HelioCanvas.tsx`).

Still open for this proposed mode: the compute-shader flow field itself, a
density/speed legend, provenance X-ray, isolate-on-select, and an altitude-true
aurora curtain that remains visually separate from heliospheric flow.
