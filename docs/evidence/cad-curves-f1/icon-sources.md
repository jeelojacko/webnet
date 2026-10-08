# CAD Curves F1 — Icon Sources (UI half)

Verdict: **no new icons wired; all six F1 rows keep the text face.** No icon
manifest change was made (`cadRibbonIcons.ts` untouched, no `draw-spline`
wiring of any kind).

## What was searched

- Local curated families under `src/cad-app/assets/icons/` (201 files,
  `*-16.png` / `*-32.png` pairs) and the `CadRibbonIconId` union in
  `src/cad-app/assets/icons/cadRibbonIcons.ts`.
- Queries: `curve`, `tangent`, `fillet`, `offset`, `subdiv`, `reverse`,
  `compound`, `multiple`, `through`, `between`, `from-end`, `point-on`,
  `calcul`, `c3d`, `civil`.

## Findings

| Wanted | Nearest local asset | Verdict |
| --- | --- | --- |
| Curve Calculator (`curves-calculator`) | none (`calcul*` → no hits) | KEEP TEXT FACE |
| Between Two Lines | `modify-fillet` (a fillet corner, not a two-line tangent curve) | REJECTED (would mislead) |
| On Two Lines | same as above | REJECTED |
| Through Point | none | KEEP TEXT FACE |
| Multiple Curves | none | KEEP TEXT FACE |
| From End of Object | `draw-line-from-end` (a LINE tool: straight continuation, wrong semantics for a curve) | REJECTED (would mislead) |
| Reverse or Compound | none (`reverse`/`compound` → no hits) | KEEP TEXT FACE |
| Existing `curves-tangent` face | `snap-tangent` (pre-existing, kept) | KEPT (unchanged, truthful snap mark) |

Adoption rule applied: adopt only an exact 16/32 family whose depicted
semantics match the command. Near-misses (`modify-fillet`,
`draw-line-from-end`) were rejected because wiring them would mislead
operators about what the command builds. No draw-spline wiring exists or was
added (spline tooling is explicitly out of scope for F1).
