# Phase 18G — surface worker bundle audit

Method: `npm run build` on the mission branch, then inspection of
`dist/assets/`. Bundle layout is unchanged by this slice (the only src
change here is the `buildPath` snapshot marker + data attribute).

## Chunk evidence (production build)

| chunk | size | gzip | contents |
| --- | --- | --- | --- |
| `surfaceWorker-<hash>.js` | 40,051 B | — | surface worker, fully self-contained |
| `survey-cad-<hash>.js` | 885.7 KiB | 231.5 KiB | all of `src/engine/cad/` + CAD UI (one chunk) |
| `engine-core-<hash>.js` | 766.3 KiB | 220.9 KiB | adjustment engine (no CAD) |

Worker chunk internals (`surfaceWorker-CyS0tzud.js` in the audited build):

- **Zero `import` statements** (static or dynamic): delaunator
  (`halfedges`/`hull`/`update`), robust-predicates (expansion cascade),
  constrained recovery (`legalize`, `constrained`), revision (`srev1`),
  Steiner handling, and `SURFACE_*` reason codes are all inlined.
- **No CAD UI leaks**: zero matches for `react`, `jsx-runtime`,
  `createElement`, `cad-app`, `surveyCad`, `CadSurfaceManager`,
  `runSurveyCommand`, `localStorage`.
- **No network imports**: zero `http(s)://` URLs. The survey-cad chunk
  references the worker by relative asset URL
  (`surfaceWorker-CyS0tzud.js`), so offline/portable builds work with no
  configuration — the worker file sits beside the other hashed assets.
- Triangulation is **duplicated, not shared**: the TIN subset lives in
  both `survey-cad` (sync fallback + tests) and the worker chunk. That is
  the correct tradeoff (worker must not fetch the 885 KiB CAD chunk), and
  the 40 KiB cost is ~4.5% of the CAD chunk.

## Lifecycle

- Lazy-until-needed holds: the worker is constructed only inside the
  build service's `createTransport`, which runs on the first production
  rebuild (or rebuild-all), never at module load or drawing open. The
  worker asset is therefore fetched on first rebuild, not on `/cad` load.
- Disposal: the service disposes the transport (and clears the session
  cache) when the drawing session ends; no worker outlives its drawing.

## Verdict

Package (delaunator + robust-predicates in the worker chunk), offline /
portable (relative hashed asset, zero remote imports), UI-leak-free, and
lazy construction all PASS. No bundle changes recommended.
