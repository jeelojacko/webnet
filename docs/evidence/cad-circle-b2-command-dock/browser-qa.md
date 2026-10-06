# Phase B2 — Browser QA results (STATUS: RUN — 7/7 green)

Superseded the earlier PENDING plan in this file. Spec:
`tests-browser/cad-draw-circle-b2.spec.ts` (419 lines, 7 tests), run against a
fresh production build:

```
npx playwright test cad-draw-circle-b2 --config=playwright.prod.config.ts
```

Result: **7 passed, 0 failed** (`7 tests using 1 worker`, ~25 s). Every test
asserts **0 page errors, 0 console errors, 0 unhandled rejections** at the end
(the 7 tests are A, B1, B2, C, D, E1, E2; there is no separate flow F).

## Environment

- Playwright 1.60.0; bundled headless Chromium 148.0.7778.96.
- Config `playwright.prod.config.ts`: `npm run build` + `vite preview` on
  127.0.0.1:4175 (`/cad`).
- Production build served: `dist/index.html` sha256 `245b53b2…`;
  emitted chunks `CadApp-DqfA5WKg.js`, `survey-cad-DX9nmdDL.js`.
- Blank disposable drawings; permanent fixtures untouched.
- Viewports: 1366-wide and 1920-wide (900 high) for the compact/history flow;
  the remaining flows run at the config default 1366×768.

## Flow results (brief A–F)

- **A — Circle flyout/icons (PASS).** Circle flyout shows 6 rows, all live
  (`aria-disabled` absent), with 6 distinct curated icon `src`s and the
  expected `data-cad-command` per row. Choosing 2-Point, 3-Point, and Tan-Tan-
  Radius updates the primary face's icon, label and command
  (`CIRCLE2P` / `CIRCLE3P` / `CIRCLETTR`). 4 PNGs.
- **B1 — 2-Point / 3-Point viewport construction (PASS).** CIRCLE2P endpoints
  (10,20) & (40,20) → one circle center (25,20), radius 15. CIRCLE3P
  (150,200),(100,250),(50,200) → center (100,200), radius 50, with a live
  preview before the third point. Menu Undo/Redo round-trips each. 2 PNGs.
- **B2 — Tan-Tan-Radius / Tan-Tan-Tan construction (PASS).** CIRCLETTR on two
  perpendicular line bodies (picks in the first quadrant) + typed radius 10 →
  center (10,10), radius 10. CIRCLETTT on three triangle line bodies → the
  Apollonius incircle (29.289321881345…, 29.289321881345…) radius
  29.289321881345…, selected from the solver's four candidates. Content-box
  Undo/Redo verified for TTR. 2 PNGs.
- **C — command-input regression (PASS).** Start Center-Radius, pick the
  center, then type `5` on the viewport without focusing the dock: the bottom
  input shows `5` before Enter (screenshot) and Enter commits a radius-5
  circle. 2 PNGs.
- **D — idle autocomplete (PASS).** Viewport-typed `cir` focuses the one dock
  buffer and shows 7 suggestions (≤ 8). ArrowDown highlights one row and Enter
  launches it; a separate run double-clicks a suggestion to launch; with a
  session active a typed radius `5` shows 0 suggestions. 2 PNGs.
- **E1/E2 — compact + history layout at 1366 and 1920 (PASS).** Collapsed
  default: exactly **two rows** (status + input), no history panel, height
  54 px. One real command (`LINE`) plus one unknown command (`ZZZ`) run while
  collapsed keep the completion echo in the status row and the height at
  54 px. Chevron expands to 148 px and shows a scrollable history (18+
  entries, scrollHeight 371, auto-scrolled to the newest). Collapsing returns
  to 54 px, equal to the pre-use baseline (the pre-fix 74 px persistent third
  echo row is gone). 4 PNGs per width set, 8 total
  (`E-collapsed`, `E-collapsed-after-use`, `E-expanded`, `E-reclaimed`).
- **F — error gates (PASS).** 0 page errors, 0 console errors, 0 unhandled
  rejections across all 7 tests.

## Evidence

- **20 PNGs** + `geometry.json` in
  `docs/evidence/cad-circle-b2-command-dock/` (PNG names: `A-circle-flyout`,
  `A-face-2point`, `A-face-3point`, `A-face-ttr`, `B-2point`, `B-3point`,
  `B-ttr`, `B-ttt`, `C-typed-before-enter`, `C-committed`, `D-suggestions`,
  `D-doubleclick`, `E-collapsed-1366`, `E-collapsed-after-use-1366`,
  `E-expanded-1366`, `E-reclaimed-1366`, `E-collapsed-1920`,
  `E-collapsed-after-use-1920`, `E-expanded-1920`, `E-reclaimed-1920`).
- `geometry.json` carries the asserted numeric values (2P / 3P / TTR / TTT /
  C circle geometry, flow-A icon mapping, flow-D suggestion count, flow-E
  collapsed/after-use/expanded/reclaimed heights at both widths).

## Final correction rerun

The two-row dock law (echo folded into the status row, no third row) was
re-run on the final-correction commit: same spec, **7 passed, 0 failed**
(~25 s, production build). Flow E now asserts the two-row law directly and
compares pre-use vs post-collapse heights rather than a hard-coded value:
1366 and 1920 both measured collapsed 54 px → after-use 54 px → expanded
148 px → reclaimed 54 px, with 0 page / 0 console / 0 unhandled errors.

## Not covered by this run

The earlier plan's extra flows were not part of this run: exact
coincident/collinear/duplicate/ambiguous pick guards, zero/negative radius
rejection, arc/circle tangent-source variants, TTT pre-third-pick guide-line
preview, history dedupe/recall, Tab/Ctrl+Enter/ARIA details, save/reopen
persistence, DXF round-trip, and 2560×1440. No browser behavior is claimed
beyond the flows listed above.
