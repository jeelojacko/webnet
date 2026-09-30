# Phase 20H — mixed-analytic grading groups: browser QA

Status: **RUN — 9 passed / 0 failed.** Real Chromium against the fresh
production bundle. One spec fix during the run (Flow C composer must select
the `relative-elevation` method before filling its value field); reran green.

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
| Bundle | fresh production `npm run build` → `dist/assets/CadApp-DZF3wmsd.js` (sha256 `b71e82ce5dd8d314…`) served by `vite preview` on 127.0.0.1:4174 |
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

**9 passed / 0 failed in 12.3 s** (`npx playwright test
tests-browser/cad-grading-mixed-analytic-20h.spec.ts --reporter=list`):

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
| `1366-mixed-create.png` | 1366×768 | `2c7b8d895dad` |
| `1366-mixed-current.png` | 1366×768 | `9ba9931645ea` |
| `1366-mixed-failed.png` | 1366×768 | `f6b908276e50` |
| `1366-mixed-group.png` | 1366×768 | `82c402eb02a4` |
| `1366-mixed-inquiry.png` | 1366×768 | `a169639a1363` |
| `1920-mixed-create.png` | 1920×1080 | `f4cb64eab4c2` |
| `1920-mixed-group.png` | 1920×1080 | `3f2b9009884a` |
| `2560-mixed-create.png` | 2560×1440 | `c622b51c5b01` |
| `2560-mixed-group.png` | 2560×1440 | `b98de66c6663` |

Supplementary: `geometry.json` (viewport/ribbon/manager box audit).
No Phase 20F/20G frames touched.
