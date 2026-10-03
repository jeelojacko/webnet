# Browser QA (pre-analysis polish)

## Automated
- `tests-browser/toolbar-responsive-layout.spec.ts`: 8/8 pass (real Chromium)
  across 1920/1366/1280/1100/980/768 + 480 report-wrap; zero new console errors
  in covered flows.
- Focused unit/component batch (10 files): 64/64 pass.
- `tests/resultIntegrity/`: full pass incl. new presentation coverage.
- MapView batch: 20 files / 57 pass.

## Full gates
- `npm run test:agent`: 7778 pass / 1 skip / 3 fail — all 3 are pre-existing
  study-desktop frozen-corpus drift (`study_ai_unit_calibration`,
  `study_ai_unit_calibration_v5`, `study_ai_unit_preflight`), untouched by
  these waves; fail on real-data corpus independent of this branch.
- `typecheck` clean; `lint` 0 errors (2 pre-existing warnings);
  `build` clean; `check:portable-paths` 0 violations;
  `npm audit` / `npm audit --omit=dev` 0.

## Firefox (Gecko) — done
- Playwright `firefox-toolbar` project (`playwright.config.ts`, Firefox 1522
  already cached, no download): `toolbar-responsive-layout.spec.ts` **8/8**.
- Reviewer reproduced 113 px page overflow at 768px running toolbar pre-fix
  (metrics row of `whitespace-nowrap` spans could not break); fixed via
  `flex flex-wrap` metrics container + `min-w-0 break-words` detail span —
  verified by reverting only the AppToolbar change (fails) vs fix (passes).
- Chromium same spec: 8/8 (no regression).

## Manual / residual
- Firefox wheel/pinch zoom *gesture feel*: transform sync verified at
  DOM/attribute level under both engines, not pixel-level; manual Firefox
  check on the 1080p laptop still recommended for gesture feel. Raster-tile
  resampling shimmer may remain.
