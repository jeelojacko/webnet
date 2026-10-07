# Phase C1 — validation

## Focused suites

| Suite | Tests | Result |
|---|---|---|
| `tests/cad_polyline_close_backstep_c1.test.ts` (engine + session helpers + preview + consumers + distinct-position law) | 31 | green |
| `tests/cad_polyline_close_backstep_c1_workspace.test.tsx` (open finish, backstep A,B,C→U→D, Close 3-ring + closing segment + grips, guards, relative-after-backstep) | 5 | green |
| `tests/cad_dock_polyline_close_c1.test.tsx` (C/U stay in the dock buffer, autocomplete hidden) | 2 | green |
| `tests/cad_polygon_closing_segment_v1.test.ts` (+1 closed-polyline pin; open N-1 law kept) | 4 | green |
| Neighbouring: `cad_shapes_transactions_v1`, `cadCommandHistory.01`, `surveyCadWorkspace.12/.14`, `cad_dock_polygon_mode_v1` | 32 | green |

## What each pin proves

- Engine: omitted/false `closed` = open; `true`+3 = closed; `true`+2 is
  rejected with zero mutation; `[A,B,C,A]` stores `[A,B,C]` with aligned
  labels; adjacent duplicate dedupe keeps labels; open `[A,B,A]` is
  unchanged; one undo entry; undo/redo round-trip; layer/selection.
- Session helpers: option parsing (case-insensitive, no `B`, point strings
  untouched), backstep counts and messages, Close gate, session-local Undo
  with no history write, open-gate refusal.
- Consumers: N-edge iterator with correct closing labels, spatial-index snap
  on the closing edge, tangent source on the closing edge, one grip per
  vertex, N property rows, persistence clone, DXF closed bit.
- Workspace: end-to-end typed flows with entity counts and committed
  geometry.
- Dock: `C`/`U` visible in the single buffer and routed to the session; no
  autocomplete list while the session is active.

## Not run in this scope

`npm run typecheck` / lint / full agent tier / production build are owned by the parent pre-PR gate (Husky owns lint+typecheck
at commit). LSP diagnostics were clean while editing. Browser spec
`tests-browser/cad-draw-polyline-c1.spec.ts` executed by the parent pre-PR gate: 5/5 green headless Chromium (flows A-E); see `browser-qa.md`.
