# PERF-183.1 — validation and performance counters

All numbers below are deterministic counts from
`tests/cad_pointer_perf_183.test.tsx` and
`tests/cad_pointer_culling_183.test.tsx` (jsdom, agent tier, sub-second; no
wall-clock thresholds) plus `tests-browser/cad-pointer-perf-183.spec.ts`
(headless Chromium). Timings are observational only.

## BEFORE (baseline `fd89d599` render path)

Baseline `SurveyCadPreviewCanvas` called `scene.primitives.map(renderPrimitive)`
inline and `updatePointerWorldPoint` set fresh pointer/snap state on every move.
Measured with a temporary control test (non-memo, no-cull full map, same input
as the AFTER test): **1540 primitives = 1500 offscreen + 40 visible**.

| Scenario | Static `renderPrimitive` calls |
| --- | --- |
| Mount | 1540 |
| One unrelated parent re-render | 1540 (total 3080) |
| One idle no-snap pointer move | 1540 (root commit + full map) |

Root hook committed on every pointer move because `setPointerWorldPoint` used a
fresh object.

## AFTER

### Unit (jsdom) — `tests/cad_pointer_perf_183.test.tsx`

Same 1540-primitive input:

| Scenario | Static `renderPrimitive` calls |
| --- | --- |
| Mount | **40** (culled) |
| Unrelated parent re-render | **0 additional** (memo bail-out) |
| Selection Set change | re-maps (invalidates correctly) |
| 1000-visible real `SurveyCadPreview` + 3 idle `mousemove`s | mount 1000, **+0** on moves |

Snapping hook root-commit counts (real hook, 1 line-pair + 1 point project):

| Scenario | Root commits |
| --- | --- |
| Mount | 1 |
| 3 idle no-snap moves | **0 additional** (ref + channel only) |
| Endpoint snap | +1 (genuine change) |
| Identical endpoint snap re-resolve | **0 additional** (semantic dedupe) |
| Midpoint snap | +1 |
| Intersection resolve | +1 |
| `cycleActiveSnap` | +1 |
| `updatePointerWorldPoint(null)` leave | +1 then reset |
| `reactivePreview: true` move | +1 per move (command preview only) |

### Culling parity (`tests/cad_pointer_culling_183.test.tsx`, 8 cases)

Crossing line both-endpoints-outside retained; fully offscreen dropped;
near-edge thick stroke retained; point marker halo retained/dropped;
off-viewport-anchored text box retained; CW/CCW arc and rotated ellipse
conservative; non-finite/NaN/empty-band **fail open**; pan/zoom restores a
dropped primitive.

### Browser (headless Chromium)

`tests-browser/cad-pointer-perf-183.spec.ts` — two 512-gon polygons
(1024 rendered edges), zero page/console errors.

| Flow | Measurement | Value |
| --- | --- | --- |
| A | rendered elements | 1024 |
| A | 40 idle pointer moves | count unchanged (1024), 0 errors |
| B | box-select + pan | selection preserved, count unchanged |
| B | zoom past geometry (`browser-counts.json`) | **zoomedIn = 0** |
| B | zoom back out | **restored = 1024**, selection kept |

## Snap parity preserved

`tests/cad_pointer_perf_183.test.tsx` pins endpoint / midpoint / intersection
resolution with exact `sourceSegmentId` (`line:1#0`), `computedScale`,
`viewportGeneration`, `cycleActiveSnap` movement, and null/leave + project-reset
behavior. `tests/cad_snap_state_dedupe_183.test.ts` pins the equality contract
field-by-field. Full snap math remains covered by
`tests/cadSpatialIndex/*`; pointer-to-commit coordinates are unaffected because
`consumeInteractionPoint` still receives the fresh unprojected click point and
the armed/active snap.

## Commands run

- `npx tsc --noEmit` — clean.
- Focused: `cad_snap_state_dedupe_183`, `cad_pointer_culling_183`,
  `cad_pointer_perf_183`, `tests/surveyCadWorkspace/*`, `tests/cadSpatialIndex/*`,
  dock/shell/preview neighbours — green.
- Browser: new spec 2/2; `cad-draw-curves-f1`, `cad-draw-polyline-c3` green.
  `cad-shell-compact-ribbon-21a` viewport sweep fails on a stale baseline
  (actual viewport 439 vs recorded 345 at 1366x768); the 94 px delta is shell
  layout, untouched by PERF-183, and reproduces identically with the new spec
  loaded — recorded as environmental/pre-existing.
- `npm run test:agent`, `npm run build` — see PR body.

## Risks

- Culling is conservative; worst case it keeps extra elements (never drops
  visible geometry). Fail-open covers bands, parcel labels, and non-finite
  geometry.
- `reactivePreview` is the only pointer path that commits root state; commands
  that need a live cursor preview keep it. Command clicks/commits use fresh
  coordinates, not the reactive state.
