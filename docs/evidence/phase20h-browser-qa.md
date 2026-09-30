# Phase 20H — mixed-analytic grading groups: browser QA

Status: **RUN — 9 passed / 0 failed (fix round: 9/9 in 12.4 s).** Real
Chromium against the fresh production bundle. Spec fixes during the runs:
(1) Flow C composer must select the `relative-elevation` method before
filling its value field; (2) dialog-internal scroll reveals before shots
(criteria form, inquiry report, group row + status-column scroll-right).
Reran green on the rebuilt bundle.

## Identifiers

| item | value |
|---|---|
| Branch | `feat/cad-grading-mixed-analytic-groups` |
| Base | `d364174bbcd21b2b00cea047de861720159d023f` (PR #136 merge) |
| Tested tree | Phase 20H working tree (engine + UI + tests), pre-commit |
| Final spec fix | Flow C selects composer method `relative-elevation` before fill |
| Spec | `tests-browser/cad-grading-mixed-analytic-20h.spec.ts` |
| Playwright | 1.60.0 (`@playwright/test`) |
| Chromium | Google Chrome for Testing 151.0.7922.34 (`ms-playwright/chromium-1234`) |
| Bundle | fresh production `npm run build` → `dist/assets/CadApp-AE9RTDlr.js` (sha256 `50696e9b50350676…`) served by `vite preview` on 127.0.0.1:4174 |
| Viewports | 1366×768, 1920×1080, 2560×1440 |
| Screenshots | `docs/evidence/phase20h/` (≤10 new PNGs, no extras) |

## Exact commands

```bash
npm run build                                     # fresh production bundle
npx vite preview --host 127.0.0.1 --port 4174     # Playwright reuseExistingServer picks this up
npx playwright test tests-browser/cad-grading-mixed-analytic-20h.spec.ts --reporter=list
```

`playwright.config.ts` sets `reuseExistingServer: true`, so the production
`vite preview` server is used instead of the dev server.

## Flows

| flow | viewports | asserts |
|---|---|---|
| A — analytic editor | 1366 / 1920 / 2560 | composer offers Distance + Elevation + Relative Elevation, never a cross-domain lock; create → UNBUILT → Calculate → CURRENT |
| B — products | 1366 | mixed closed square Calculate → `Mixed Analytic` row + `Not applicable` target → Inquiry → CSV → Extract + Bake → one Undo each |
| C — failure | 1366 | incompatible-Z override → FAILED / `CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z`, Extract/Bake disabled, stable on retry |
| D — gates + persistence | 1366 | cross-domain edit rejected; wrong-sign rejected inline; save + reopen → mixed overrides preserved, UNBUILT |
| Shell regression | 1366 / 1920 / 2560 | ribbon ≤ 130 px, one band, no page scroll, one Properties + one command input, viewport > 300 px |

## Error contract (asserted empty in every test)

| counter | expected |
|---|---|
| unexpected page errors | 0 |
| console errors | 0 |
| unhandled promise rejections | 0 |

## Result

**9 passed / 0 failed in 12.4 s** (`npx playwright test
tests-browser/cad-grading-mixed-analytic-20h.spec.ts --reporter=list`,
final fix-round run; initial run 9 passed / 0 failed in 12.3 s before the
scroll-reveal recapture, Flow C method-select fix 8/9 → 9/9):

| # | test | time |
|---|---|---|
| 1–3 | 20H Flow A analytic composer @ 1366×768 / 1920×1080 / 2560×1440 | fast |
| 4 | 20H Flow B calculate + inquiry + CSV + extract/bake | 1.7 s |
| 5 | 20H Flow C incompatible-Z FAILED | 1.4 s |
| 6 | 20H Flow D wrong-sign + persistence | 1.5 s |
| 7–9 | 20H shell regression @ 1366 / 1920 / 2560 | ~1.2 s each |

Flow outcomes: A — composer offers exactly Distance / Elevation /
Relative Elevation, rows read `Mixed Analytic` + `Not applicable` +
`Unbuilt`; B — Calculate → `Current`, `20.00–20.00 m`, `9600.0`,
Inquiry `Termination: Mixed Analytic · Methods: Distance + Elevation +
Relative Elevation`, CSV agrees, Extract +1 Feature Line / Bake +1
explicit-TIN each removed by one Undo; C — Δ=-12 recalc → `Failed` +
`CORNER_NO_SOLUTION` / `GRADING_ANALYTIC_CORNER_Z`, Extract/Bake
disabled, stable diagnostic on retry; D — wrong-sign standalone rejected
inline before mutation, save/reopen preserves default + overrides as
UNBUILT with no target id. Shell — ribbon 120 px single band,
docScroll == viewport (no page scroll) at all viewports (see
geometry.json). Zero unexpected page errors, zero console errors, zero
unhandled rejections in every test (asserted `errors` empty).

## Screenshot inventory (9 PNGs, cap 10)

| file | dims | sha12 |
|---|---|---|
| `1366-mixed-create.png` | 1366×768 | `ff161849cc66` |
| `1366-mixed-current.png` | 1366×768 | `2ccd9e63ba0f` |
| `1366-mixed-failed.png` | 1366×768 | `5722cd965ba0` |
| `1366-mixed-group.png` | 1366×768 | `257bf2e2af16` |
| `1366-mixed-inquiry.png` | 1366×768 | `3637c64df1a3` |
| `1920-mixed-create.png` | 1920×1080 | `c1bdfc630ad3` |
| `1920-mixed-group.png` | 1920×1080 | `444b2cc59261` |
| `2560-mixed-create.png` | 2560×1440 | `802878b0a434` |
| `2560-mixed-group.png` | 2560×1440 | `4062e5004085` |

Supplementary: `geometry.json` (viewport/ribbon/manager box audit).
No Phase 20F/20G frames touched.
