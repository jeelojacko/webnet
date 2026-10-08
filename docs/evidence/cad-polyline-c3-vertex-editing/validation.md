# Phase C3 — Validation

## Focused C3 suites (71 tests, all green)

| Suite | Tests | Proves |
| --- | --- | --- |
| `tests/cad_polyline_vertex_topology_c3.test.ts` | core | pure insert/delete topology, arc split/merge, widths, labels, closed ring |
| `tests/cad_polyline_vertex_topology_c3_commands.test.ts` | commands | engine transactions, one history entry, zero mutation on refusal, undo/redo |
| `tests/cad_polyline_vertex_editing_c3_grips.test.ts` | 14 | grip matrix (open N+N-1, closed N+N, no dup closure), line midpoint, true arc midpoint, projection preserves path, vertex move unchanged, non-polyline grips unchanged, Properties rows + `runPolylineVertexRowAction` dispatch |
| `tests/cad_polyline_vertex_editing_c3_commands.test.ts` | 11 | registry keys + collision-free `PIV`/`PDV` aliases, no `PEDIT`, point-pick + typed submit, target resolution |
| `tests/cad_polyline_vertex_editing_c3_ui.test.tsx` | 2 | Properties panel renders Delete/Insert actions, disabled reason title, click routing |

Command: `node scripts/runVitest.mjs run <files>` → `5 passed, 71 passed`.

## Regression suites run

- C1: `cad_polyline_close_backstep_c1`, `cad_polyline_close_backstep_c1_workspace`, `cad_dock_polyline_close_c1` — updated the two grip-count assertions to account for the new per-course insert grips (vertex grips are filtered; insert grips are asserted separately).
- C2: `cad_polyline_bulge_width_c2_core`, `_consumers`, `_preview`, `_session` — green after the same grip-count filter update in `_consumers`.
- Line L1: `cad_line_l1_batch`, `_construction`, `_coordinate_context`, `_entity`, `_on_source`, `_parsers`, `_sessions`, `_survey` — green.
- Circle B2: `cad_circle_2p3p_b2`, `_construction_b2`, `_tangent_b2`, `cad_circle_consumer_v1`, `cad_circle_transactions_v1` — green.
- Renderer / DXF / feature lines: `cad_renderer_labels`, `cad_export_dxf`, `cad_draft_dxf_layout`, `cad_feature_line_20a`, `_commands_20a`, `_geometry_20a`, `_snapshot_20a` — green.
- Properties: `cad_properties`, `cad_properties_appearance` — green.

`tsc --noEmit` clean; `eslint` clean on all touched files.

## Browser

`npx playwright test cad-draw-polyline-c3 --config=playwright.prod.config.ts` → **10 passed** (flows A–J). See `browser-qa.md`.

## Deferred / not covered here

Z, line-chaining, right-click finish, command repeat, raw direct bulge-entry
UI, width grips, destructive arc↔line conversion, full mixed-segment
trim/extend/fillet, and general DXF import remain out of scope for C3.
