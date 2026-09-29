# Phase 20F.4 Browser QA — production Chromium revalidation (20F.4 + 20F.5)

Source: `/tmp/20f4-browser-rerun.md` (Step 2B). No product source modified, no commits by that run.

## Environment (historical 20F.4 run)

- Branch `fix/phase20f4-visual-evidence-finalization`, HEAD `c444f0a7` (= `origin/main` at the time, PR133 merge).
- Chromium **148.0.7778.96** (Playwright **1.60.0** bundled, headless). Measured at runtime.
- Fresh `npm run build`: exit 0, **11.5 s** (vite "built in 11.13s) →
  `dist/assets/index-BFrZan0G.js` (1,763.32 kB, gzip 398.02 kB;
  sha256 `01fa028d…4e631de8215`). Served via `vite preview --host 127.0.0.1 --port 4174`;
  `/cad` HTTP 200, served entry matches fresh `dist/` (no dev server).
- Screenshot protection: `docs/evidence/phase20f3/` backed up to `/tmp/20f4-evidence-backup` before
  the run (spec writes PNGs + `geometry.json` unconditionally) and restored byte-for-byte after
  (`diff -rq` clean).

## Result

`npx playwright test tests-browser/cad-grading-20f3-qa.spec.ts --reporter=list` →
**16 passed / 16**, exit 0, **25.0 s**. Zero page errors, zero console errors, zero unhandled
rejections (every test collects `pageerror` + console errors from before `goto` and asserts empty).

| # | Test | Time |
|---|------|------|
| 1–3 | Flow A one-click ribbon Calc @ 1366/1920/2560 | 956ms / 1.4s / 1.5s |
| 4–6 | Flow B FAILED after stale @ 1366/1920/2560 | 1.9s / 1.9s / 2.0s |
| 7–9 | Flow C ribbon gates + products @ 1366/1920/2560 | 1.7s / 1.8s / 1.9s |
| 10 | Typed `GG` opens manager, `INQ` fails closed empty | 1.1s |
| 11–13 | Flow D Cut/Fill defaults @ 1366/1920/2560 | 1.5s / 1.5s / 1.6s |
| 14–16 | §22 shell regression @ 1366/1920/2560 | 1.2s × 3 |

Flows: A — exactly one `GRADINGGROUPCALC` click, observation-only after (row `Unbuilt → Building
→ Current`, Toolspace `BUILDING → CURRENT`). B — 25/20 asymmetric corner → stale → recalc →
`FAILED` / `CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z`, Extract/Bake disabled. C —
no-selection all disabled; UNBUILT Calc-only; ribbon Calc builds exact group; Extract +1 feature
line / Bake +1 TIN surface, each removed by one Undo. D — untouched defaults `2:1`/`3:1` valid;
reopened `2H:1V`/`3H:1V` valid (input-value DOM assertions — PNGs show rows/summary, not the
literal edit-field values), layout-only unclipped check. Shell §22 — ribbon 120px one band `nowrap`, no page
overflow at any width, 1 Properties + 1 command input, viewport 814×345 @1366 usable,
Toolspace/manager internally scrollable.

Focused unit tests (vitest 4.1.11, one combined run, 1.70 s): **116/116** across
`cad_grading_group_shell_20f3` (20), `cad_grading_group_commands_20c` (9),
`cad_grading_group_ui_20c` (16), `cad_shell_snapshot_contract` (32), `cad_shell_panels` (39).
Static: `npm run lint` exit 0 (0 errors, 2 pre-existing unused-disable warnings);
`npm run typecheck` exit 0.

## Fresh 20F.5 rerun on merged HEAD (preferred execution record)

- Branch `fix/phase20f5-review-record-merge-state`, execution SHA `699e9ff9c76d05395e4c3d82514490da57cf363e`
  (= live `origin/main`, PR #134 merge). No tracked files edited, no commit, evidence restored byte-for-byte.
- Fresh `rm -rf dist && npm run build`: exit 0, built in **11.22 s** →
  `dist/assets/index-BFrZan0G.js` (1,763.32 kB, gzip 398.02 kB;
  sha256 `01fa028de567c7f7bb7acc2889b63242cc86f28b85c365cee093f4e631de8215`).
  Served via `vite preview --host 127.0.0.1 --port 4174`; `/` and `/cad` HTTP 200, served entry
  byte-identical to fresh `dist/` (no dev server).
- `npx playwright test tests-browser/cad-grading-20f3-qa.spec.ts --reporter=list` →
  **16 passed / 16**, exit 0, **25.1 s**. Zero page errors, zero console errors, zero unhandled
  rejections. Playwright **1.60.0**, bundled Chromium **148.0.7778.96** (headless).
- Static on the same tree: `npm run lint` exit 0 (0 errors, 2 pre-existing unused-disable warnings);
  `npm run typecheck` exit 0.

Both runs (historical `c444f0a7` + fresh `699e9ff9`) are recorded; the `699e9ff9` rerun above is the
authoritative execution record for the merged state. Docs-only delta between the two SHAs, so no
behavioral difference is expected — and the fresh rerun confirms it.

## Recapture inventory (this phase)

- `docs/evidence/phase20f3/`: 33 PNGs + `geometry.json`, preserved byte-for-byte (not overwritten).
- `docs/evidence/phase20f4/`: 2 PNGs — `1366-cutfill-defaults.png` (the Step-3 recapture; see
  `phase20f4-visual-qa.md` replacement section) + `1920-failed-manager.png` (fix-round recapture
  of the falsely-PASSED 1920 FAILED frame; same section). No other recaptures required.

## Pixel-vs-assertion split

All 16 flows assert legibility-adjacent DOM state (values, summaries, `disabled`, clipping rects),
and all pass — yet the 20F.4 pixel review FAILED two carried PNGs for framing defects the
assertions cannot see (1366 dialog bottom behind the dock; 1920 pre-recalc moment with the settled
FAILED row out of frame). Pixel review and DOM assertions are
complementary gates; neither subsumes the other. Failed-manager disabled styling is additionally
low-contrast in pixels — the `disabled` DOM assertion remains the gate for that sub-requirement.
