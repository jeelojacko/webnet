# GitHub Pages Deployment

Production URL (after first deploy): <https://jeelojacko.github.io/webnet/>

## Architecture

Static Vite + React app. No backend, no secrets, no telemetry. `npm ci` +
`npm run build:pages` emits `dist/`; the Pages workflow uploads only `dist/`.

## Base contract

- Local dev: base `/` → <http://localhost:5173/> (unchanged).
- Pages production build: base `/webnet/` via `VITE_BASE_PATH`.
- `vite.config.js` normalizes `VITE_BASE_PATH` (leading + trailing slash).
- Runtime asset/route URLs go through `src/appBasePath.ts`
  (`resolveAppAssetUrl`, `resolveAppRoutePath`, `stripAppBasePrefix`).
  External (`https://`, `//`, `data:`, `blob:`) URLs are never prefixed.
- `index.html` favicon/public refs are rewritten by Vite with the base.
- Deep routes (`/webnet/cad`, `/webnet/study`) work via `dist/404.html`,
  a build-time copy of `index.html` (SPA fallback, queries preserved).
- Future custom domain at root: build with `VITE_BASE_PATH=/` and
  re-validate before changing. No `CNAME` is committed now.

## Local Pages build

```sh
npm run build:pages          # == VITE_BASE_PATH=/webnet/ vite build + assert
node scripts/checkPagesArtifact.mjs dist
```

PowerShell:

```powershell
$env:VITE_BASE_PATH="/webnet/"; npm run build
node scripts/checkPagesArtifact.mjs dist
```

## Local subpath preview

Serve `dist/` so the app lives at `/webnet/`, not root
(`vite preview` serves root and does NOT prove subpath safety).
Any static server with a `/webnet/` mount plus index fallback works, e.g.
the QA harness in `docs/evidence/pages/subpath-qa-summary.md`
(mount-only `/webnet/`, unknown routes → `index.html`, port 5199).

## Deployment workflow

`.github/workflows/pages.yml`: push to `main` + `workflow_dispatch` only
(never PRs). Build job (`checkout@v5`, `setup-node@v5` Node 24,
`configure-pages@v5`, `npm ci`, `npm run build:pages`, artifact check,
upload `dist/` only) → deploy job (`pages: write`, `id-token: write`,
environment `github-pages`, concurrency `group: pages`).
Normal CI is untouched and remains the pre-merge gate.

Base is derived dynamically: `VITE_BASE_PATH` comes from the
`configure-pages` `base_path` output (`/webnet/`); local default matches.

## One-time enablement (required, manual)

Pages is NOT yet enabled for this repo. A repo admin must do this once:

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
2. Push to `main` (or dispatch the workflow) to run the first deployment.

The workflow token cannot enable Pages itself (`configure-pages`
`enablement` needs a non-`GITHUB_TOKEN` credential), so this step is manual.

Inspect status: Actions tab → “Deploy to GitHub Pages” runs; each deploy
job links its `page_url`. Recent deliveries are also under Settings → Pages.

## WASM note (v1 limitation)

`cpp/build-wasm/*` and `public/rtklib-rnx2rtkp.*` are local build outputs,
not committed. The v1 workflow runs no emsdk step (same contract as core
CI): sparse-WASM auto-routes fail closed to the TypeScript solver and raw
GNSS shows its staged-asset diagnostic. Subpath QA verified both WASM
modules instantiate over `/webnet/` when staged, and the Combined
adjustment converges via the TS path. Deterministic emsdk staging in the
workflow is a future enhancement, not a v1 blocker.

## Browser storage origin note

Projects live in browser IndexedDB/OPFS only — no data is uploaded to
GitHub by using the app. Storage is origin-specific: projects created at
`http://localhost:5173` do NOT appear at
`https://jeelojacko.github.io/webnet/` (and vice versa). Move projects
between origins with portable export/import.

## Rollback

Revert the offending commit(s) on `main` (or `git revert`) and push —
the workflow redeploys the reverted tree. For a broken deploy with good
code, re-run the last green “Deploy to GitHub Pages” workflow from the
Actions tab.
