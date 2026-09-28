# Phase 21A Wave 1D — viewport background unification + pan anisotropy fix

Branch: `feat/cad-compact-icon-ribbon-viewport-cleanup`
Baseline: `c29a2499`
Scope: presentation only. No projector contract change, no geometry/equations change.

## 1. Element-by-element paint inventory

Bottom of the stacking order first. "Resolves to" is the effective painted
colour before this wave.

| Layer | Location | Paint declaration | Resolves to (before) |
| --- | --- | --- | --- |
| CAD shell frame / page | `src/cad-app/shell/cadShell.css:3-15` (`.cad-shell`) | `background: var(--cad-bg)` | `#0b1220` (fixed token) |
| CAD shell viewport wrapper | `src/cad-app/shell/cadShell.css:252-257` (`.cad-shell-viewport`) | none (transparent) | shell `#0b1220` shows through |
| Dedicated page wrapper | `src/components/SurveyCadWorkspace.tsx:2594` (`[data-survey-cad-dedicated-page]`) | `bg-slate-950` | themed slate-950 `#1d2021` (occluded by the preview) |
| Workspace inner wrapper | `src/components/SurveyCadWorkspace.tsx:2611` | `bg-slate-950` | themed slate-950 `#1d2021` (occluded by the preview) |
| Preview shell div | `src/components/surveyCad/SurveyCadPreview.tsx:269` (`[data-survey-cad-preview-shell]`) | `bg-slate-950` | themed slate-950 `#1d2021` |
| SVG root | `src/components/surveyCad/SurveyCadPreviewCanvas.tsx:139-140` (`viewBox 0 0 900 520`, `[data-survey-cad-preview]`) | `bg-slate-950` | themed slate-950 `#1d2021`; paints the **entire element box**, including the `xMidYMid meet` letterbox bands |
| Drawing background rect | `src/components/surveyCad/SurveyCadPreviewCanvas.tsx` (`[data-survey-cad-background]`) | `fill="#020617"` (hardcoded) | `#020617`; paints only the 900x520 viewBox content area |
| Small CAD status message | (§63 surface) | untouched | — |

## 2. Root cause (proven)

The SVG root and the preview shell painted the *themed* `slate-950` class while
the drawing rect painted a *hardcoded* `#020617`. Under the SVG's implicit
`preserveAspectRatio="xMidYMid meet"`, the viewBox content is scaled to fit and
centred, leaving letterbox bands on the long axis. Those bands are painted by the
**SVG element's own CSS background** (the whole element box), not by the rect.
So the bands showed `#1d2021` while the drawing area showed `#020617` — a visible
seam at the 900x520 content boundary whenever the shell viewport aspect differed
from 900:520 (which it always does in the real, wide shell).

### Theme coupling note

`bg-slate-950` is remapped in `src/index.css` (`--theme-slate-950: 29 32 33` under
the default theme, i.e. `#1d2021`). Switching `data-theme` changes those RGB
triples, so the letterbox bands and the shell div changed colour with the theme,
while the hardcoded rect fill never did. Consequently the seam was
theme-dependent: a different theme produced a different band colour against the
same `#020617` drawing rect.

## 3. Decision — unify on ONE token, without touching projection

Introduce `--cad-model-bg: #020617` in `.cad-shell` (`cadShell.css`) and consume it
at every layer that represents the *model* background:

- `.cad-shell-viewport` → `background: var(--cad-model-bg, #020617)`
- preview shell div (`.tsx:269`) → `bg-[var(--cad-model-bg,#020617)]`
- SVG root (`.tsx:140`) → `bg-[var(--cad-model-bg,#020617)]`
- drawing background rect (`[data-survey-cad-background]`) → `fill="var(--cad-model-bg,#020617)"`

The wrapper layers at `SurveyCadWorkspace.tsx:2594/2611` are deliberately left on
`bg-slate-950`: they are fully occluded by the `h-full w-full` preview, and they
belong to page chrome rather than the model surface. The `#020617` fallback keeps
the token correct even on the non-shell Survey CAD page where `.cad-shell` (and
therefore the token) is absent.

The token is a fixed presentation constant, not theme-coupled, so both the
letterbox bands and the drawing area stay `#020617` in every theme.

**No projection math changes.** The side regions are purely visual: the SMIL/CSS
letterbox is undone for input by `screenPointFromClientPoint`
(`SurveyCadPreview.geometry.ts:73-95`), which already reverses the same
`min(w/900, h/520)` meet-and-centre transform. The background token never enters
the pointer path.

## 4. Pan anisotropy fix (minimal)

`SurveyCadPreviewCanvas.tsx` pan branch (was `:236-243`) converted the client
delta separately per axis:

```
panX += (dx / rect.width) * 900
panY += (dy / rect.height) * 520
```

When `rect.width/900 != rect.height/520`, horizontal and vertical pan rates
diverge, so a diagonal drag drifts off the cursor. It now derives **one** uniform
client→view factor, the same `sf` concept used by `screenPointFromClientPoint`:

```
const clientToView = Math.min(rect.width / 900, rect.height / 520);
panX = startPanX + dx / clientToView
panY = startPanY + dy / clientToView
```

Direction and sign are identical (`startPan + delta`); only the scalar changes.
The factor is always defined here because `screenPointFromMouseEvent` has already
returned non-null, which guarantees `rect.width > 0 && rect.height > 0`.

### Untouched (acceptance)

`useProjector` / `project` / `unproject` / `baseScale`, `visibleWorldBoundsFromViewport`,
the wheel zoom anchor equations, `screenPointFromClientPoint`, and the 900x520
constants are byte-identical.

## 5. Manual reasoning — behavior unchanged

Because the projector is unchanged, every derived quantity is unchanged:

- **Circles/arcs**: SVG radius = `primitive.radius * scale`; `scale` unchanged.
- **45° / constructions**: projected coordinates unchanged.
- **Snap tolerance**: `snapToleranceScreenUnits / scale`; unchanged.
- **Selection**: `intersectsSelectionBox(primitiveBounds(primitive, project, scale), box)`
  uses the same projection and the same selection-box view coordinates from
  `screenPointFromClientPoint`.
- **Wheel zoom anchor**: unchanged; still unprojects the cursor before rescaling.

The pan factor change only alters the `panX/panY` delta produced by a middle-button
drag, and only when the element aspect differs from 900:520. In the jsdom harness
`mockElementRect` is exactly 900x520, so `clientToView === 1` and no existing
assertion moves.

## 6. Token adoption list

| Site | Adoption |
| --- | --- |
| `cadShell.css` `.cad-shell` | defines `--cad-model-bg: #020617` |
| `cadShell.css` `.cad-shell-viewport` | `background: var(--cad-model-bg, #020617)` |
| `SurveyCadPreview.tsx:269` preview shell | `bg-[var(--cad-model-bg,#020617)]` |
| `SurveyCadPreviewCanvas.tsx:140` SVG root | `bg-[var(--cad-model-bg,#020617)]` |
| `SurveyCadPreviewCanvas.tsx` background rect | `fill="var(--cad-model-bg,#020617)"` |

`tests/surveyCadWorkspace/surveyCadWorkspace.01.test.tsx` previously pinned the
shell's `bg-slate-950` class; updated deliberately (with an explanatory comment)
to pin `bg-[var(--cad-model-bg,#020617)]` so the token stays wired.

## 7. Validation

- `tests/surveyCadWorkspace` — **52 files / 141 passed + 1 skipped** green.
- `tests/cad_shell_layout.test.ts`, `tests/cad_shell_panels.test.tsx`,
  `tests/cad_shell_registry.test.ts` — **3 files / 40 passed** green.
  (Combined focused run: 55 files / 181 passed + 1 skipped, 10.76 s.)
- `npm run typecheck` — clean.
- `npx eslint` on the three touched source/test files — clean (0).
- `npm run build` — clean; the Tailwind arbitrary utility compiled to
  `.bg-\[var\(--cad-model-bg\,\#020617\)\]{background-color:var(--cad-model-bg,#020617)}`
  and `--cad-model-bg: #020617` / the `.cad-shell-viewport` rule are present in the
  emitted CSS.
- `SurveyCadPreview.geometry.ts` — **zero diff** (projector equations, `project`,
  `unproject`, `visibleWorldBoundsFromViewport`, `screenPointFromClientPoint`, wheel
  anchor math, and the 900x520 constants all untouched).

## 8. Diff stat (this wave only)

```
 src/cad-app/shell/cadShell.css                       |  6 +++
 src/components/surveyCad/SurveyCadPreview.tsx        |  2 +-
 src/components/surveyCad/SurveyCadPreviewCanvas.tsx  | 23 ++++++++++++------
 tests/surveyCadWorkspace/surveyCadWorkspace.01.test.tsx | 8 +++++-
 docs/evidence/phase21a-viewport-background-audit.md  | new
```

Untouched per scope: `CadRibbon.tsx`, command registry, `CadPropertiesPalette`,
`SurveyCadPreview` mount wiring, snap tolerance, and the whole projector/geometry
module.
