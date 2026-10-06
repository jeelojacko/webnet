# Phase B2 — Validation

All counts below were produced by running the suites in this worktree on branch
`feat/cad-circle-construction-command-dock-b2`. The implementation is landed
but uncommitted; docs are landed; browser QA / higher tiers are pending.

## 1. Focused Phase B2 suites — 5 files, 85/85 passed

Command:

```
npx vitest run tests/cad_circle_2p3p_b2.test.ts \
  tests/cad_circle_construction_b2.test.ts \
  tests/cad_circle_tangent_b2.test.ts \
  tests/cad_command_dock_b2.test.tsx \
  tests/cad_ribbon_icon_manifest.test.tsx
```

Result: `Test Files 5 passed (5)`, `Tests 85 passed (85)`, ~1.3 s.

Breakdown:

| Suite | Tests | Scope |
|---|---|---|
| `tests/cad_circle_2p3p_b2.test.ts` | 13 | 2-Point diametral builder (midpoint/half-distance, asymmetry vs Center/Diameter, degenerate/non-finite/overflow cases) + 3-Point circumcircle (shared arc convention, collinear/duplicate/ill-conditioned rejection) |
| `tests/cad_circle_construction_b2.test.ts` | 20 | engine transactions (CIRCLE2P/3P/TTR/TTT one-undo, fail-closed degenerate), sessions (staging, commit, collinear/coincident/repeat/background reasons, `sessionExpectsPointPick`), previews (builders/solver parity, ghost shapes), ribbon + registry wiring + autocomplete keys |
| `tests/cad_circle_tangent_b2.test.ts` | 19 | TTR branches/failure/ambiguity, TTT incircle/excircles/permutation-invariance/Descartes/Soddy/degenerate/parallel, `resolveCadTangentSource` |
| `tests/cad_command_dock_b2.test.tsx` | 27 | single-buffer rule, idle first-key capture, autocomplete + ARIA, history fallback/log/dedupe, compact collapsed/expanded layout, layout persistence/reset |
| `tests/cad_ribbon_icon_manifest.test.tsx` | 6 | real 16/32 px PNG per manifest id, registry/tool-family id resolution, rendered-tab ids, Circle variant icon pin, no `local-assets` reference from `src/` |

Circle construction coverage is therefore **52 tests across 3 files**; the dock
suite is **27**; the icon manifest is **6/6**. `52 + 27 + 6 = 85`.

## 2. Modified neighbouring suites — 5 files, 70/70 passed

Command:

```
npx vitest run tests/cad_dock_polygon_mode_v1.test.tsx \
  tests/cad_ribbon_controls.test.tsx \
  tests/cad_shell_layout.test.ts \
  tests/cad_shell_panels.test.tsx \
  tests/cad_ribbon_tool_families.test.ts
```

Result: `Test Files 5 passed (5)`, `Tests 70 passed (70)`. These are the
pre-existing suites updated for the B2 contract (all-six-live Circle family,
`I`-alias dock priority, layout persistence, shell type additions).

## 3. Typecheck

```
npm run typecheck   # tsc --noEmit
```

Result: clean (no diagnostics), exit 0.

## 4. Icon verification

`magick identify` / `magick compare -metric AE` for all 12 PNGs: pixel-identical
to the cited local sources, native 16/32 px, `srgba 4.0`, no text metadata.
Details in `icon-sources.md` §3.

## 5. Repository invariants

- Stashes intact: **14** (`git stash list` stashes 0–13, unchanged).
- No engine/parity regression was measured here; existing `CadCircleEntity`
  geometry and persistence shape are unchanged (the commit path only appends a
  B1 circle). Parity/industry-reference and WASM tiers were not run in this
  scope.

## 6. Pending (not run here)

- Browser QA: no run yet — see `browser-qa.md` (PENDING, exact flows listed).
- Lint: owned by Husky at commit (`npm run test:agent`, `lint`, `typecheck`).
- `npm run build` production build.
- `npm run test:agent` agent tier.
- Independent review.

## 7. Review fix (B2 findings 3 + 4)

Two review findings were fixed after the initial evidence run; this section
claims only the focused suites re-run below.

**Finding 3 — CIRCLETTR repick law.** An AMBIGUOUS or NO_SOLUTION radius
submission now opens a UI-only repick window (`awaitingSecondRepick` on the
`CIRCLETTR` session, never persisted): the next distinct tangent-object click
replaces the second tangent, clears the error and radius input, and prompts for
the radius again. Retrying the same tangent pair with another radius stays
valid. A repick of the first or the current second primitive is rejected.
Escape still cancels the whole session and no Circle entity is committed until
a solve succeeds, so there is no partial undo. Ordinary third tangent clicks
before a failed solve keep the existing "has both tangents" prompt and never
replace the second source.

**Finding 4 — history chevron direction.** The dock chevron was reversed;
collapsed now renders the down chevron (`⌄`) and expanded the up chevron
(`⌃`), while the `Show`/`Hide command history` labels and `aria-expanded` are
unchanged. The component test pins the glyph text in both states, not just the
label.

Re-run validation:

```
npx vitest run tests/cad_circle_construction_b2.test.ts tests/cad_command_dock_b2.test.tsx
npx vitest run tests/cad_circle_tangent_b2.test.ts tests/cad_circle_command_sessions_v1.test.tsx \
  tests/cad_circle_2p3p_b2.test.ts tests/cad_ribbon_tool_families.test.ts \
  tests/cad_circle_transactions_v1.test.ts tests/cad_circle_consumer_v1.test.ts \
  tests/cad_circle_reviewfix_v1.test.ts
npm run typecheck
```

Result: `51/51` (construction + dock), `99/99` (7 neighbouring suites),
`tsc --noEmit` clean. `tests/cad_circle_construction_b2.test.ts` now holds 24
tests (four added for the repick law); `tests/cad_command_dock_b2.test.tsx`
remains 27 (glyph assertions added to the existing chevron test).

This document claims only what was executed in this worktree; it makes no
product-completeness or browser-behaviour claim.
