# Phase B2 — Circle construction modes + global command dock (architecture)

Branch `feat/cad-circle-construction-command-dock-b2`. Worktree baseline is the
Phase B1 Circle v1 tree; Phase B2 adds four Circle construction modes and
reworks the bottom command dock. No schema bump, no migration, and no change to
the geometry/parity of existing `CadCircleEntity` values.

## 1. Scope

- Circle construction commands `CIRCLE2P`, `CIRCLE3P`, `CIRCLETTR`, `CIRCLETTT`
  (first-class B1 Circle entity; Center/Radius `CIRCLE` and Center/Diameter
  `CIRCLECD` already shipped in B1).
- Global command dock: one input buffer, idle first-key capture, registry
  autocomplete, bounded history log, compact collapsed layout, persisted
  expanded state.
- 12 curated Circle variant icons (see `icon-sources.md`).
- Evidence docs only; end-to-end browser QA is still pending (see
  `browser-qa.md`).

Out of scope: schema/version changes, DXF changes, block/DXF contract changes,
B1 behavior changes, any new epsilon authority.

## 2. Engine modules

- `src/engine/cad/cadGeometryShapeBuilders.ts` — adds `buildCircleTwoPoint`
  (2-point diametral: center is the midpoint, radius is half the distance;
  rejects coincident/non-finite/sub-floor) and `buildCircleThreePoint`
  (circumcircle via the shared `cadBuildArcFromThreePoints` convention plus a
  scale-relative conditioning guard `isWellConditionedTriangle`). Reuses
  `CAD_XY_DEGENERATE_FLOOR`; no new epsilon.
- `src/engine/cad/cadGeometryCircleTangentSolvers.ts` (new) — pure TTR/TTT
  solvers and entity→tangent-source resolution; see `tangent-solver.md`.
- `src/engine/cad/cadTransactions.types.ts` — adds command keys and four
  `CadCommand` variants (`CIRCLE2P` two points; `CIRCLE3P` three points;
  `CIRCLETTR` two `CadTangentSource` + `radius`; `CIRCLETTT` three sources).
- `src/engine/cad/cadTransactionsShapeCommands.ts` — four
  `CadCommandDefinition`s committing through the existing
  `commitCircleEntity`, with metadata `createdBy` (`CIRCLE2P`/`CIRCLE3P`/
  `CIRCLETTR`/`CIRCLETTT`) and entity-name prefixes (`CIR2P`/`CIR3P`/`CIRTTR`/
  `CIRTTT`); fail closed to `null` (zero mutation) on solve failure.
- `src/engine/cad/cadTransactions.ts` — registers the four keys in
  `CAD_COMMAND_REGISTRY` via `shapeCommandDefinitions`.

Existing Circle entity shape is unchanged: the commit writes only
`id/type/layerId/visible/locked/centerX/centerY/radius/metadata`.

## 3. Session + hook wiring

- `useSurveyCadCommandTypes.ts` — `ActiveCommandKey` + four `CommandSession`
  variants (`CIRCLE2P {first}`, `CIRCLE3P {points[]}`,
  `CIRCLETTR {first,second}`, `CIRCLETTT {picks[]}`).
- `useSurveyCadCommandStarters.ts` / `.types.ts` — four starters.
- `useSurveyCadCommandSession.ts` — all four keys expect point picks.
- `useSurveyCadConsumePoint.ts` — `handleCircleConstructionPointPick`:
  - CIRCLE2P: stage first, commit second, reject coincident with a reason.
  - CIRCLE3P: stage two, commit third, reject collinear/coincident.
  - CIRCLETTR/TTT: resolve the picked entity + pick point to a
    `CadTangentSource`; background picks and repeated primitives are rejected
    with a readable reason; TTR waits for typed radius; TTT commits on the
    third distinct pick.
- `useSurveyCadShapeSubmit.ts` — typed point/radius submit for the four keys.
- `useSurveyCadCommandPreview.ts` — live ghosts; CIRCLE2P/3P reuse the builders,
  CIRCLETTR reuses the TTR solver at the typed radius, CIRCLETTT shows a guide
  line until the third pick (never a fabricated circle).
- `useSurveyCadCommandHelpText.ts`, `useSurveyCadCommandText.ts` — prompts and
  help text.
- `useSurveyCadCommandConstruction.ts` — snap-construction context.
- `useSurveyCadWorkspace.ts` / `useSurveyCadCommands.types.ts` /
  `useSurveyCadWorkspace.types.ts` — surface the four starters to the shell.

## 4. Shell + ribbon wiring

- `cadCommandRegistry.ts` — four session rows with labels/aliases:
  Circle (2-Point), Circle (3-Point), Circle (Tan, Tan, Radius),
  Circle (Tan, Tan, Tan).
- `cadRibbonToolFamilies.ts` — the six `circle` variants are all live
  (`planned` removed), each with `commandKey` and `icon`; default remains
  `circle-center-radius` (sticky).
- `cadRibbonIcons.ts` — six new `CadRibbonIconId`s + manifest entries.
- `CadApplicationShell.tsx` — passes `historyExpanded` / `onToggleHistory`.
- `useCadShellLayout.ts` + `cadShellTypes.ts` — new persisted
  `commandHistoryExpanded` layout flag (default `false`) and
  `setSessionInputValue` action.
- `SurveyCadWorkspace.tsx` — routes the four new command keys to their
  starters and forwards direct dock edits to `setCommandInputValue`.
- `CadRibbonShared.tsx` — one comment-only line updated (the stale claim that
  Circle primaries keep a text face); zero behavior.

## 5. File map

| Area | File |
|---|---|
| Builders | `src/engine/cad/cadGeometryShapeBuilders.ts` |
| Solvers | `src/engine/cad/cadGeometryCircleTangentSolvers.ts` (new) |
| Commands | `src/engine/cad/cadTransactionsShapeCommands.ts`, `cadTransactions.types.ts`, `cadTransactions.ts` |
| Sessions/hooks | `src/hooks/surveyCad/useSurveyCadCommand*.ts`, `useSurveyCadShapeSubmit.ts`, `useSurveyCadConsumePoint.ts`, `useSurveyCadWorkspace*.ts` |
| Registry/ribbon | `src/cad-app/shell/cadCommandRegistry.ts`, `cadRibbonToolFamilies.ts`, `cadRibbonIcons.ts`, `CadRibbonShared.tsx` |
| Dock | `src/cad-app/shell/CadCommandDock.tsx` (see `command-dock-ux.md`) |
| Layout | `src/cad-app/shell/useCadShellLayout.ts`, `cadShellTypes.ts`, `CadApplicationShell.tsx` |
| Icons | `src/cad-app/assets/icons/draw-circle-*-{16,32}.png` (see `icon-sources.md`) |
| Tests | `tests/cad_circle_2p3p_b2.test.ts`, `cad_circle_construction_b2.test.ts`, `cad_circle_tangent_b2.test.ts`, `cad_command_dock_b2.test.tsx` |

## 6. Data flow

1. Ribbon/typed/dock command → registry key (`CIRCLE2P` …).
2. Starter opens a `CommandSession`; picks flow through
   `handleSurveyCadConsumePoint`; typed text flows through
   `handleSurveyCadShapeSubmit`.
3. On commit, the hook calls `runCadCommand` with the typed `CadCommand`; the
   engine transaction builds the entity through the shared builder/solver and
   appends it in one history step.
4. Preview uses the same builder/solver as commit, so the ghost equals the
   committed circle where the ghost can be resolved.

## 7. Known limitations (documented, not defects)

- CIRCLETTT preview cannot show the finished circle before the third pick
  because the hovered point is not a resolved primitive; only a next-pick
  guide line is drawn.
- TTR/TTT select the minimum pick-distance candidate in a local frame anchored
  at the picked-geometry bounding-box centre, so branch selection is
  independent of absolute world coordinates, and report `AMBIGUOUS` on a
  symmetric tie instead of guessing.
- Line/polyline tangency follows the existing FILLET/TANGENT_CURVE
  infinite-extension law; the finite segment identity is recorded only.
