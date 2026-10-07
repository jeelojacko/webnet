# Phase C1 — browser QA

Spec: `tests-browser/cad-draw-polyline-c1.spec.ts` (flows A–E), evidence
directory `docs/evidence/cad-polyline-c1-close-backstep/`. Production build,
headless Chromium, blank disposable drawings:

```
npx playwright test cad-draw-polyline-c1 --config=playwright.prod.config.ts
```

Flows:

- **A** — open PLINE finishes on empty Enter with 3 vertices (status text,
  entity count, saved geometry `closed:false`), then Edit ▸ Undo/Redo.
- **B** — session `U` drops the newest vertex with no entity and one undo
  entry for the whole draft; typing `40,0` then Enter commits `A,B,D`.
- **C** — `C` commits a closed 3-vertex ring (`closed:true`, exactly 3
  stored vertices), the closing segment `#2` is present as a hit target, 3
  vertex grips render, then Undo/Redo.
- **D** — Close below 3 distinct vertices stays active with the gate message
  and no entity; `U` at 0/1 guards; Escape leaves no entity.
- **E** — typed relative input after a backstep derives from the new last
  vertex.

Each flow asserts zero page/console/unhandled-rejection errors. PNG evidence
is written under this directory by the spec run.

Status: executed and green. Production build, headless Chromium,
`tests-browser/cad-draw-polyline-c1.spec.ts` 5/5 (flows A–E), with zero page
errors, zero console errors, and zero unhandled rejections across all flows.
