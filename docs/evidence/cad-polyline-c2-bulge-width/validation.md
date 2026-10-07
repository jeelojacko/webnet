# Phase C2 — validation

## Focused suites (new)

| Suite | Tests | Result |
|---|---|---|
| `tests/cad_polyline_bulge_width_c2_core.test.ts` (normalizer, validator, arc math, width math, PLINE transaction, clone, moved-vertex revalidation) | 34 | green |
| `tests/cad_polyline_bulge_width_c2_consumers.test.ts` (renderer/band, spatial refs, snaps, intersections, tangent source, bounds, properties, grips, transforms, blocks, persistence, DXF, edit-safety) | 39 | green |
| `tests/cad_polyline_bulge_width_c2_session.test.ts` (options, width grammar, arc completion, modes, typed drafting, arc legs, backstep, WIDTH, commit/close wiring, prompts) | 26 | green |
| `tests/cad_polyline_bulge_width_c2_preview.test.ts` (true 3-point arcs, no fabricated chord, no closure segment, model-space width edge guides + taper, draft-order CW taper) | 9 | green |

## C1 regression suites (kept green)

| Suite | Tests |
|---|---|
| `tests/cad_polyline_close_backstep_c1.test.ts` | 31 |
| `tests/cad_polyline_close_backstep_c1_workspace.test.tsx` | 5 |
| `tests/cad_dock_polyline_close_c1.test.tsx` | 2 |

## Neighbouring suites (kept green)

- `tests/cad_shapes_transactions_v1.test.ts` (13), `tests/cad_dock_polygon_mode_v1.test.tsx` (3)
- `tests/cadCommandHistory/cadCommandHistory.01.test.ts` (5)
- `tests/surveyCadWorkspace/surveyCadWorkspace.12.test.tsx` (6), `…14.test.tsx` (5)
- The wider `surveyCadWorkspace` set (55 files), dock, and command suites were
  reported green by the implementation slice.

## What the focused pins prove

- Normalizer: legacy paths stay byte-clean; metadata length/shape law; all-line
  and all-zero canonicalize to absent; redundant-final strip owns its outgoing
  entry (real arc/width there fails closed); fail-closed interior duplicates;
  shared-seam arcs (CCW/CW, semicircle, major, 3-point round-trip, collinear
  reject, near-full-circle block); width interpolation/finiteness; transaction
  validation-before-mutation + one undo entry; verbatim clone + malformed-load
  throw; moved-vertex revalidation.
- Consumers: native arc primitives (never chords) with preserved course order;
  one band primitive; arc band edges offset radially (never tangentially, so a
  constant-width semicircle stays between R-half and R+half); long wide band
  outlines stay closed under a per-course tessellation budget (no assembled-
  polygon slicing); arc-midpoint/nearest/intersection/tangent/Circle-TTR
  resolve on the true arc; true arc extrema + width envelope bounds; properties
  rows + true total length; grips carry metadata and fail closed on collapse;
  uniform scale/reflection/affine refusal; block uniform/reflection/nonuniform
  refusal; persistence deep-copy; DXF 42/40/41 + legacy 10/20 byte equivalence +
  block-table parity + non-uniform INSERT over a bulged/wide polyline child
  omitted with a warning; trim/extend/fillet refusal on arc/width metadata.
- Session: option parsing (no `B`, points survive); width grammar; 3-point arc
  completion law; mode switching + pending refusal; arc-leg through/END law;
  backstep priority (width prompt → pending → vertex+metadata); WIDTH default
  persistence; commit/close wiring incl. arc-without-pending refusal and
  redundant-final strip.
- Preview: true 3-point pending arc, fail-closed degenerate handling, native
  completed arcs, no implied closure, model-space width edges/taper in draft
  start→end order (a CW leg keeps startWidth at the draft start, not the
  builder-reversed endpoint).

## Browser QA

`tests-browser/cad-draw-polyline-c2.spec.ts` flows A–G: **7/7 green** on the
production build in headless Chromium, with zero page errors, zero console
errors, and zero unhandled rejections across all flows. Evidence: 9 PNGs plus
`geometry.json` under `docs/evidence/cad-polyline-c2/`; see `browser-qa.md`.

## Standing suite note

`npm run test:agent` retains the known, pre-existing, unrelated study-desktop
trio failures (`study_ai_unit_calibration`, `study_ai_unit_calibration_v5`,
`study_ai_unit_preflight`) — none reference CAD PLINE C2. Typecheck/lint are
owned by Husky at commit (LSP diagnostics were clean while editing); the
browser fast path uses the production build.

## Docs pass scope

This docs-only pass ran `npm run check:portable-paths` (required for the new
evidence directory); no engine/session/browser tests were run from the docs
worker. The suite counts above are the implementation slice's recorded
results, not re-executed here.
