# Phase 18D QA Results — fixtures, browser/export QA, performance evidence

Date: 2026-09-17 · Branch: `feat/cad-survey-point-styles` · No src edits (fixture + test + evidence only).

## 1. Fixture

`tests/fixtures/cadSurveyStyleQaDrawing.ts` — deterministic 12-point drawing:

- C1 control/monument (base style + F2F-full label), IP1/IP2 boundary (`IP*` group),
  IP2 manual-override-beats-group, T1/T2 trees (`TREE*` group), UP1 utility,
  B1 building, E1 edge, TOE1 toe, U1 unmapped `ZZZ`, ND1 No-Display,
  NL1 No-Label (no label entity), 6 derived labels.
- `buildSurveyStyleQaCatalog()` — IP/MON/TREE/UP/BLDG/EP/TOP/TOE (+ TREE-OAK/PINE
  aliases), every code mapped to a known point + label style.
- Pins: `tests/cad_survey_style_qa_18d.test.ts` (10/10 green).

## 2. Browser QA (real Chromium, zero console errors)

Script: `docs/evidence/phase18d-qa/capture.mjs` (F2F sample → commit → select
`pt:C1` → Properties override → clear → label None → clear).

| Leg | What | Method | Verdict |
|-----|------|--------|---------|
| A | Style assign | Browser: Properties “Point Style Override” → Monument commits `SURVEY_POINT_OVERRIDE`, Effective updates | PASS |
| A | Style/group CRUD | Engine: `cad_survey_display_commands_18d` suite | PASS |
| B | Label switch dynamic | Browser: Label Override → None reads “Effective: No Label — Source: Manual override”, cleared after | PASS |
| C | Associativity (desc/elev change) | Engine: existing F2F style/regen goldens (derived labels) | PASS |
| D | Manual offset persists + text updates | Engine: existing `cad_draft_labels_auto` manual-wins | PASS |
| E | `TREE*` group count + display | Engine: new test pins T1+T2 membership + tree style | PASS |
| F | Reorder changes effective | Engine: new overlap test (priority 5 wins → demoted to 50, Trees wins back) | PASS |
| G | Manual-beats-group + clear restores | Browser: “Effective: Monument — Source: Manual override” → clear → “Effective: Standard — Source: Base style”; engine mirror in new test | PASS |
| H | F2F generate + regen + override survives | Browser: commit = 13 entities, ids identical to baseline; regen/override-survival via existing regen goldens | PASS |
| I | Layer OFF hides despite group | Engine: existing 18C OFF-semantics tests | PASS |
| J | Locked layer blocks MOVE, allows inspect | Engine: `action_guards` (MOVE block) + new locked-resolve test (Boundary style resolves on locked point) | PASS |
| K | Save/reopen retains | Engine: new WNCAD exact round-trip (entities + styles + groups) | PASS |
| L | Legacy visual equivalence | Browser: F2F review line, 13 entities, 13 render ids byte-identical to `phase18d-baseline`; viewport/labels/colors/positions unchanged | PASS |

Screenshots: `qa-01-viewport.png`, `qa-02-properties.png`, `qa-03-override.png`
(3 PNGs). Console/page errors: none.

## 3. Export matrix (new engine test + screenshots)

| Format | Result |
|--------|--------|
| SVG | Markers render with distinct effective shapes + all 6 labels; `C1` present |
| PDF | Same scene pipeline; `C1` present |
| DXF | `POINT` + `TEXT` present, labels correct (`C1`) |
| WNCAD | Byte-exact model round-trip (entities, pointStyles, pointGroups) |
| LandXML | No visual pollution (no `point-style`), `C1` present |
| Adjustment outputs | Parity suite 25/25 (see §5) — untouched |

## 4. Performance (honest numbers, no gate)

- 10k points × 52 groups membership + full resolution: **335.8 ms**
  (vs 296 ms engine smoke on fewer groups — linear O(N·G) scan, no caching by
  design; Toolspace counts ride the same resolver, no separate measurement taken).
- Style edit → render refresh: not separately timed (same resolver path; no gate).
- 100 point styles × 100 label styles single resolve: **0.08 ms** — table size is
  a non-issue for resolution (id-set lookups); manager usability at 100×100 is a
  DOM-list concern only, no virtualization added (not needed for evidence).

## 5. Legacy parity

- Old side (read-only): `docs/evidence/phase18d-baseline/` (pre-18D UI capture:
  same F2F sample, same 13 entities / 13 render ids, `03-point-properties.png`
  shows NO style rows).
- New side: `docs/evidence/phase18d-qa/` (identical review line, entity count,
  render ids; Properties now exposes Base/Override/Effective + matching groups).
- Engine: legacy `survey_plan_sample.wncad` opens, reserializes losslessly, and
  every survey point resolves to a known style (migration additive only).
- Allowed diffs: Properties style rows (new), markers resolving through point
  styles (intended 18D change). Positions/labels/colors/layers/visibility: equivalent.

## 6. Bugs

- None found in src (zero src edits this phase).
- Test-only catch: first SVG assertion failed because the reused 18C QA viewport
  (centered 50,50) clipped the new fixture bounds — fixed with a centered
  viewport helper in the test, not a product change.
