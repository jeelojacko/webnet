# CAD Best Fit E1 — icon sources and provenance (Worker C)

Three curated PNGs back the three Best Fit construction variants. The
variants are **live** (each carries a real command key); this file records
the exact local source path for each committed PNG and the verification
performed. Sources are gitignored local-only reference art; only the
stripped copies are committed.

Contrary to the pre-implementation scout note (which found only the
`BEST_FIT_FIXED_*` audit-text references), the `c3d-icons.json` manifest
does contain three exact best-fit families, verified by rendering the
frames: a best-fit line glyph (points + fitted line), a best-fit curve
glyph (points + fitted arc), and a best-fit parabola glyph (points +
fitted parabola). No provenance was invented: the mapping below is
family-exact, and the audit-text-only `ALIGNMENT_BEST_FIT_CREATE` /
`PROFILE_BEST_FIT_CREATE` families were NOT used (alignment/profile scope,
not Draw best-fit scope).

## 1. Policy gate (unchanged from Phase 21A/21B and CAD Draw Phase L1)

`local-assets/AGENTS.md` permits adding/committing assets once they are
stripped of all identifying text/properties. The pipeline is per-icon, never
bulk:

1. Copy exactly one source frame per size.
2. `magick SRC -strip PNG32:DEST` (drops tEXt/zTXt/iTXt/eXIf and normalizes
   to 8-bit RGBA).
3. Semantic WebNet rename (`draw-best-fit-line-16.png`), never an Autodesk
   family name.
4. Register in `CadRibbonIconId` + `CAD_RIBBON_ICONS` (presentation only;
   dispatch stays in `cadCommandRegistry`).

No `local-assets/` bytes are staged or tracked. `local-assets/` is
gitignored. No `src/` file references `local-assets/` outside comments.

## 2. Per-row source table

All source paths are relative to the repo root. `dark` is the theme matching
the dark CAD shell; no light-theme frame is used. Following the L1
convention, the directory (not the `_16`/`_32` filename suffix) is the real
pixel size (verified: every frame below opens at its directory size), so
both destinations use the `_16`-named frame from their size directory.
Semantics is EXACT for all three rows.

| # | Variant id | Command key | Civil family | 16px source (used) | 32px source (used) | 16px destination | 32px destination | Sizes | Semantics |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `bestfit-line` | `BESTFITLINE` | `BEST_FIT_FIXED_LINE` | `local-assets/civil3d-icons/png/dark/16/BEST_FIT_FIXED_LINE_16.png` | `local-assets/civil3d-icons/png/dark/32/BEST_FIT_FIXED_LINE_16.png` | `src/cad-app/assets/icons/draw-best-fit-line-16.png` | `src/cad-app/assets/icons/draw-best-fit-line-32.png` | 16x16 (225 B) / 32x32 (326 B) | EXACT |
| 2 | `bestfit-arc` | `BESTFITARC` | `BEST_FIT_FIXED_CURVE` | `local-assets/civil3d-icons/png/dark/16/BEST_FIT_FIXED_CURVE_16.png` | `local-assets/civil3d-icons/png/dark/32/BEST_FIT_FIXED_CURVE_16.png` | `src/cad-app/assets/icons/draw-best-fit-arc-16.png` | `src/cad-app/assets/icons/draw-best-fit-arc-32.png` | 16x16 (316 B) / 32x32 (569 B) | EXACT |
| 3 | `bestfit-parabola` | `BESTFITPARABOLA` | `BEST_FIT_PARABOLA` | `local-assets/civil3d-icons/png/dark/16/BEST_FIT_PARABOLA_16.png` | `local-assets/civil3d-icons/png/dark/32/BEST_FIT_PARABOLA_16.png` | `src/cad-app/assets/icons/draw-best-fit-parabola-16.png` | `src/cad-app/assets/icons/draw-best-fit-parabola-32.png` | 16x16 (294 B) / 32x32 (467 B) | EXACT |

The manifest contract test pins every Best Fit variant to its curated icon
plus file existence plus the live command key (`pins every Best Fit variant
to its curated icon` in `tests/cad_ribbon_icon_manifest.test.tsx`), and the
`never references the gitignored local-assets tree` test stays green.
