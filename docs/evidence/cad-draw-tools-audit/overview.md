# CAD Draw Ribbon — Capability Audit Overview (baseline main 5478ccf4)

Read-only audit of all 11 Home > Draw tools. Zero src/ changes. Method: 5
parallel code scouts (graft-assisted) + live headless-Chromium validation
(blank in-memory drawing, Esc-cancelled activations, 0 console/page errors).

## Headline counts (of 11)

- PRODUCTION_READY: 1 (Arc)
- USABLE_BUT_INCOMPLETE: 5 (Point, Line, Traverse, Polyline, Curves)
- ENGINE_EXISTS_UI_MISSING: 1 (Shapes)
- UI_STUB_ENGINE_PARTIAL: 1 (Ellipse)
- PLACEHOLDER_ONLY: 3 (Circle, Best Fit, Hatch)
- ABSENT: 0

## Why grey looks grey

All six greyed families are the hardcoded `planned: true` manifest flag plus a
missing `commandKey` (`src/cad-app/shell/cadRibbonToolFamilies.ts`; enforced
`CadRibbonSplitButton.tsx:114-117,54-59`; selectable rule manifest:211-215).
It is a declaration, not a runtime capability probe. Grey styling is disabled
opacity (shell css 0.38, flyout 0.45), not missing icons. Curves is the
exception that proves the rule: its primary face is grey only because the
default variant is planned, while 10 flyout rows are runnable commands.

## Architecture in one paragraph

Registry (`cadCommandRegistry.ts`) → shell starters
(`SurveyCadWorkspace.tsx:1480-1569`) → session state machines
(`useSurveyCadCommandTypes.ts:142-489`) → `CadCommandDefinition.execute` →
snapshot-based `runCadCommand` (`cadUndoRedo.ts:58`) → `cadProjectState` →
SVG/DOM render with oversized transparent hit pads
(`SurveyCadPreviewPrimitive.tsx:56-300`) → `.wncad` JSON persist with
`migrateV1ToV2` + fail-closed sanitize → DXF **export-only** (no DXF/DWG
import exists). Undo is one whole-snapshot step per command. Snaps: exactly
14 `CadSnapKind` (`cadTypes.ts:976`), all 2D; no grid/ortho/free-polar/Z.
No right-click finish, no command repeat. Persistent kinds live in the
`CadEntity` union (`cadTypes.ts:720-737`): no circle, no drafting ellipse
(only derived error-ellipse), no spline, no hatch.

## Per-tool verdicts (detail in per-tool.md)

| Tool | Ribbon | Class | Confidence | Biggest gap |
|---|---|---|---|---|
| Point | EN | USABLE_BUT_INCOMPLETE | HIGH | Z entry, symbol-at-creation (creates survey-point+text, 2D typed only) |
| Line | EN | USABLE_BUT_INCOMPLETE | HIGH | chain mode, Z (single segment, full snaps/grips/trim/DXF) |
| Traverse | EN | USABLE_BUT_INCOMPLETE | MED-HIGH | LSQ integration; backsight label-only (commits points+lines+polyline, 3 adjustments) |
| Polyline | EN | USABLE_BUT_INCOMPLETE | HIGH | vertex insert/delete, Z (close/backstep C1 and bulge/width/arc C2 delivered) |
| Arc | EN | PRODUCTION_READY | HIGH | only Z + standalone bulge round-trip (11 modes, fail-closed degeneracy) |
| Circle | DIS | PLACEHOLDER_ONLY | HIGH | everything (no entity/command/primitive; 360° arc explicitly blocked) |
| Best Fit | DIS | PLACEHOLDER_ONLY | MEDIUM | design first: inputs/output entity/residuals undefined; zero fit functions |
| Curves | DIS face / 10 live rows | USABLE_BUT_INCOMPLETE | HIGH | wire tangent-between-two-lines; planned Civil rows (circular-arc COGO complete) |
| Ellipse | DIS | UI_STUB_ENGINE_PARTIAL | HIGH | generic entity + Center command (error-ellipse pipeline proves the path) |
| Shapes | DIS | ENGINE_EXISTS_UI_MISSING | HIGH | 2 draw sessions on existing polygon entity (zero schema) |
| Hatch | DIS | PLACEHOLDER_ONLY | HIGH | engine entirely (fill exists only on point markers) |

## Recommended next slice (detail in dependency-roadmap.md)

Shapes v1: Rectangle (two-corner) + Polygon (inscribed/circumscribed) as
closed-`CadPolygonEntity` factories. Zero new schema; entity, render, pick,
transforms, props, persist, DXF polyline all exist. Risk LOW. Browser QA
required. Everything else (Circle entity decision, Ellipse entity, BestFit
design, Hatch engine) is larger or needs policy first.
