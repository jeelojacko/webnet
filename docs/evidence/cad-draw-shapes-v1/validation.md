# CAD Draw Shapes V1 — Validation Record

Every number below was produced by a command run on this worktree during this
evidence pass. Gates the parent orchestrator owns are marked `PENDING_FULL`;
they are **not** claimed.

## Focused suites (run here)

`node scripts/runVitest.mjs run <files>`:

| File | Tests |
|------|-------|
| `tests/cad_geometry_shapes_v1.test.ts` | 15 / 15 |
| `tests/cad_polygon_closing_segment_v1.test.ts` | 3 / 3 |
| `tests/cad_shapes_command_sessions_v1.test.tsx` | 18 / 18 |
| `tests/cad_shapes_transactions_v1.test.ts` | 13 / 13 |
| **Shapes subtotal** | **49 / 49** |
| `tests/cad_ribbon_tool_families.test.ts` | 9 / 9 |
| Combined run (5 files) | 58 / 58 |

The "48 focused tests" figure is exactly the four shape suites; the ribbon
manifest suite is a modified neighbor file and is listed separately.

## Browser (run here)

`npx playwright test cad-draw-shapes-v1 --config=playwright.prod.config.ts`
→ **8 / 8 passed**, 20.6 s, 1 worker. Each case asserts `errors` (pageerror +
console error) is `[]`, so 0 page errors / 0 console errors. 9 PNGs and
`geometry.json` regenerated. See `browser-qa.md`.

## Static / build gates (run here)

| Gate | Command | Result |
|------|---------|--------|
| Typecheck | `npm run typecheck` | clean, no output |
| Lint | `npm run lint` | 0 errors, 2 warnings (both pre-existing: `tests/evidence/phase10m_correction_stage_audit.test.ts:253:7`, `tests/gnssBaseline/gnssBaselinePerformance.test.ts:55:5`) |
| Build | `npm run build` | `vite build` succeeded in **10.04 s** (only pre-existing chunk-size warnings) |
| Portable paths | `npm run check:portable-paths` | **5836** tracked paths, **0** violations |

The two lint warnings are unused `eslint-disable` directives in files this
branch does not touch; they are not introduced here.

## Owned by the parent orchestrator (NOT claimed)

| Gate | Status | Reason |
|------|--------|--------|
| `npm run test:agent` | `PENDING_FULL` | parent runs the broad regression tier |
| `npm run test:wasm` | `PENDING_FULL` | engine TypeScript changed (`cadTransactions.ts`, `cadProperties.ts`); parent runs |
| `npm run parity:industry-reference` | `PENDING_FULL` | parent decides parity-sensitivity and runs |
| `npm run test:release` / build certification | `PENDING_FULL` | parent runs the release certification gate |

## Scope confirmations (verified by read + focused tests)

- `Circle` / `Best Fit` / `Ellipse` / `Hatch` stay planned with **no** engine
  command: `cad_shapes_transactions_v1.test.ts` asserts each family's
  variants are all `planned` and `CAD_COMMAND_REGISTRY` has no
  `CIRCLE` / `BESTFIT` / `ELLIPSE` / `HATCH` key.
- `Line` / `Polyline` / `Arc (3-Point)` neighbors unaffected: presence in the
  registry plus a committing LINE/PLINE assertion; browser case I exercises
  all three.
- Closing-segment fix is contained to `cadProperties.ts` polygon rows; the
  polyline test pins the unchanged `N-1` open-edge behavior.
- 14 stashes preserved (`git stash list | wc -l` = 14).
- Baseline `HEAD == main == e3f75550`; branch `feat/cad-draw-shapes-v1`.

## Review-fix round (2026-10-05)

- MAJOR: dock `I` priority guard — in POLYGON `mode` phase `I` reaches the
  session; idle `I` still resolves to INSERT. New
  `tests/cad_dock_polygon_mode_v1.test.tsx` **2 / 2**.
- MAJOR: degenerate-ring rejection is one O(N) pass over consecutive edges
  **including the closing edge** (`cadGeometryShapeBuilders.ts`).
- Offset regression: `tests/cad_geometry_shapes_v1.test.ts` "rejects
  precision-collapsed rings far from the origin"; geometry now **15 / 15**.
- MINOR: preview asserted pre-commit — `tests-browser/cad-draw-shapes-v1.spec.ts`
  case B asserts **4** preview line elements before commit; spec **8 / 8**
  re-green.

Counts re-verified here by running the suites (`58 / 58` combined).

## Merge status

**DO NOT MERGE** — pending external review.
