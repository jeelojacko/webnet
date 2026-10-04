# Subpath Browser QA — GitHub Pages `/webnet/` deployment

- Date: 2026-10-04T02:12:12.423Z
- Server: static http on `http://127.0.0.1:5199/webnet/` (mount-only, mimics GH Pages project site; unknown routes fall back to index.html, missing assets 404, anything outside /webnet/ 404).
- Browser: Playwright chromium (headless), viewport 1440x900.
- Flows passed: 9/9
- Screenshot: `docs/evidence/pages/subpath-boot.png`

## Per-flow results

### F1 — Boot /webnet/ (theme, startup example, logo/favicon): **PASS**
- data-theme=gruvbox-dark
- document.styleSheets=1
- body background=rgb(29, 32, 33)
- startup input length=47340, combined tokens present=true
- screenshot written: docs/evidence/pages/subpath-boot.png
- LOGO2.png responses from browser: none (headless does not fetch favicons)
- favicon link href=/webnet/LOGO2.png
- GET http://127.0.0.1:5199/webnet/LOGO2.png -> 200 (image/png)

### F3 — Run normal Combined adjustment to completion (worker + WASM): **PASS**
- worker responses (Playwright): adjustmentWorker-Bo2PrMGd.js=200
- wasm responses (Playwright): none
- server access log WASM fetches (captures in-worker subrequests): none
- note: the Combined case runs 3D with GNSS baseline observations, so the worker sparse WASM route fails closed to the TypeScript solver; real WASM load over /webnet/ is verified in F8.
- processing summary shows convergence/iterations: true

### F5 — Export download produces a non-empty file: **PASS**
- export button="Export Adjusted points" file=webnet-adjusted-points-2026-10-04.csv bytes=1697

### F6 — Map & Ellipses open (basemap external requests, no CSP/mixed errors): **PASS**
- external request origins: https://overpass-api.de
- new CSP/mixed-content console errors: 0
- any same-origin 4xx/5xx so far: 0

### F2 — Permanent examples 200 (direct fetch x3 + one UI open): **PASS**
- fetch preanalysis: status=200 bytes=13432
- fetch combined: status=200 bytes=64140
- fetch combined-split: status=200 bytes=64297
- UI open of Combined example: project name visible=true

### F4 — New Project + IndexedDB save/reopen roundtrip: **PASS**
- Create New Project -> "Local project created"
- Save Local Project -> "Local project saved"
- Reopen from IndexedDB -> "Local project opened" (QA Subpath Project)
- named-project backend: Backend: indexeddb / Autosave: idle
- reopen notice visible after closing Project Options: true

### F7 — CAD direct-load /webnet/cad + in-app navigation: **PASS**
- direct /webnet/cad renders=true (text len 1668)
- CAD assets: survey-cad-BKDrppfi.js=200, survey-cad-BKDrppfi.js=200, CadApp-BZOtozcF.css=200, CadApp-DvGFvhVs.js=200
- CAD asset failures: 0
- in-app CAD navigation URL=http://127.0.0.1:5199/webnet/cad rendered=true

### G — Direct-load /webnet/study (fallback routing): **PASS**
- /webnet/study renders=true (text len 677)
- /webnet/ renders adjustment shell (F1)
- /webnet/cad renders CAD shell (F7)

### F8 — GNSS/raw asset status (rtklib + webnet_core): **PASS**
- GET /webnet/rtklib-rnx2rtkp.js -> 200 (text/javascript; charset=utf-8)
- GET /webnet/rtklib-rnx2rtkp.wasm -> 200 (application/wasm)
- GET /webnet/webnet_core.js -> 200 (text/javascript; charset=utf-8)
- GET /webnet/webnet_core.wasm -> 200 (application/wasm)
- instantiate webnet_core.js: OK (21 exports)
- instantiate rtklib-rnx2rtkp.js: OK (12 exports)

## Same-origin failed requests (status >= 400)

None. Zero same-origin 4xx/5xx responses were observed across all flows.

## Console errors

None.

## Page errors

None.

## WASM / worker asset statuses

Playwright-observed (page/main-thread requests):
- adjustmentWorker-Bo2PrMGd.js -> 200 (script)
- adjustmentWorker-Bo2PrMGd.js -> 200 (script)
- webnet_core.js -> 200 (script)
- webnet_core.wasm -> 200 (fetch)
- rtklib-rnx2rtkp.js -> 200 (script)
- rtklib-rnx2rtkp.wasm -> 200 (fetch)

Server access log (includes dedicated-worker subrequests):
- GET adjustmentWorker-Bo2PrMGd.js -> 200
- GET adjustmentWorker-Bo2PrMGd.js -> 200
- GET rtklib-rnx2rtkp.js -> 200
- GET rtklib-rnx2rtkp.wasm -> 200
- GET webnet_core.js -> 200
- GET webnet_core.wasm -> 200
- GET webnet_core.js -> 200
- GET webnet_core.wasm -> 200
- GET rtklib-rnx2rtkp.js -> 200
- GET rtklib-rnx2rtkp.wasm -> 200

## Routing verdict

- `/webnet/` -> adjustment shell (F1).
- `/webnet/cad` -> CAD shell via SPA fallback + in-app nav (F7).
- `/webnet/study` -> Study shell via SPA fallback (G).

## External requests seen (map/basemap, informational)

- https://overpass-api.de
- https://tile.openstreetmap.org
