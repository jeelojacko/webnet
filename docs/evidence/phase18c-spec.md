# Phase 18C — Drawing Standards Spec (normative for all 18C workers)

Baseline `8a0107d6`. Background: `docs/evidence/phase18c-appearance-map.md`.

## 1. Layer schema (conservative upgrade, `cadTypes.ts`)

Keep every existing `CadLayer` field with its meaning. `visible` KEEPS meaning ON
(no rename, no migration churn). Add three optional fields (absent = default):

```ts
frozen?: boolean;        // default false
transparency?: number;   // 0 (opaque) .. 1 (fully transparent), default 0
description?: string;    // default ''
```

`printable` (default true), `lineweightMm` (undefined = Default), `color`,
`lineTypeId`, `role`, `defaultStyleId`, `locked` unchanged. Mirror defaults in the
draft sanitizer (`cadDraftTypes.ts:459-490`). No schema-version bump required for
optional additive fields; document if a bump is actually taken.

## 2. Entity appearance intent (new, `cadTypes.ts`)

```ts
export interface CadEntityAppearance {
  color?: string;            // hex; undefined = ByLayer
  lineTypeId?: CadLineTypeId; // undefined = ByLayer
  lineweightMm?: number;     // mm; undefined = ByLayer
  transparency?: number;     // 0..1; undefined = ByLayer
}
// on CadBaseEntity:
appearance?: CadEntityAppearance;
```

Absent field = ByLayer. **No ByBlock representation** (no block model exists;
ByBlock is honestly deferred — see §8). Store intent only, never resolved values.

## 3. Current layer (drawing-owned, `CadProject`)

```ts
currentLayerId?: CadLayerId;  // absent = default layer (see §4)
```

Protected default layer: existing layer id **`observation-lines` is NOT the default**.
New default layer added to `DEFAULT_CAD_LAYERS`: id **`general`**, name `General`,
color `#e2e8f0`, role `planning`, ON / thawed / unlocked / plot / Continuous /
Default lineweight / 0 transparency. It cannot be deleted or renamed; if missing on
load (legacy files), backfill deterministically; if `currentLayerId` is missing or
unusable, fall back to `general`. Current layer must exist, be ON, not frozen to be
selectable; locked may remain current (creation then fails with LAYER_LOCKED).

## 4. Precedence (locked by tests)

For ordinary entities, per property (locked by tests):

```
color / linetype:  explicit entity appearance  >  legacy style value  >  layer value  >  built-in default
lineweight:        explicit entity appearance  >  layer value  >  legacy style value  >  built-in default
transparency:      explicit entity appearance  >  layer value  >  built-in default (0)
```

Built-in defaults: color `#94a3b8`, linetype `continuous`, lineweight Default
(resolves 0.25mm), transparency 0. Legacy style value = `CadStyle.color /
lineTypeId / strokeWidth` (strokeWidth is the legacy lineweight fallback, used only
when layer lineweight is undefined AND entity has no explicit lineweight).
New generic entities default `appearance` to **absent (= ByLayer)** — never copy
layer color into the entity. Changing layer color immediately recolors ByLayer
entities; explicit overrides survive layer changes.

## 5. Authoritative resolver (new file `src/engine/cad/cadAppearance.ts`)

Pure + deterministic + independently testable:

```ts
resolveCadEntityAppearance({ entity, layer, styleLibrary? })
  => { visible, selectable, editable, color, lineTypeId, lineweightMm,
       transparency, printable }
```

- `visible = entity.visible && layerVisible !== false && !layer.frozen`
  (unknown/missing layer = visible; entity.visible=false still works standalone).
- `selectable = visible` (locked entities remain selectable for inspection).
- `editable = selectable && !entity.locked && !layer.locked`.
- `printable = layer.printable !== false`.
- color/linetype/lineweight/transparency per §4.
- `resolveEffectiveColor` becomes a thin wrapper over the resolver (no fork; keep its
  frozen-precedence comment true). Renderer, Properties, and exporters consume the
  resolver — no independent inheritance logic.

## 6. Visibility / lock / plot contracts

- OFF (`visible=false`): view-layer filter at scene consumers
  (`SurveyCadPreviewCanvas`, sheet viewport surfaces) — **NOT inside
  `buildCadDisplayScene`** (trap #1). Not rendered, not viewport-selectable
  (selection cleared for newly hidden ids; no floating grips), excluded from
  display-scene production where practical.
- FROZEN: same viewport result as OFF via the same filter path; persists as
  drawing-standard state (`frozen`), intended for stronger exclusion / future
  viewport overrides. Document the (currently small) difference honestly.
- LOCKED: visible + selectable; **all** mutation paths (move/erase/trim/fillet/
  extend/properties geometry+appearance edits, layer-move) reject via ONE central
  gate (`editable` from the resolver or a single `assertLayerEditable` helper)
  returning stable code `LAYER_LOCKED`. Never just disable the manager button.
- PLOT (`printable=false`): excluded from SVG/PDF plot output (already true via
  export scene — keep). DXF: retain entities + layer state (no plot filtering).
  WNCAD: always preserve. LandXML: semantic policy, no plot filtering.

## 7. Lineweight

Stored physical mm. Supported set (exact list, UI dropdown order):
`Default, 0.00, 0.05, 0.09, 0.13, 0.15, 0.18, 0.20, 0.25, 0.30, 0.35, 0.40, 0.50,
0.53, 0.60, 0.70, 0.80, 0.90, 1.00, 1.20, 1.40, 1.58, 2.00, 2.11`.
Undefined = Default = resolves 0.25mm. LWT status-bar toggle is **workspace-only**
(display preference, never dirties drawing): OFF = normalized thin display, ON =
stable screen mapping of relative weights (clamped, never zoom-absurd). Stored and
exported weights never depend on LWT. PDF/SVG reflect resolved weight; DXF 370 where
the writer supports it, else documented restriction.

## 8. Linetypes

Drawing-owned library (`styleLibrary.lineTypes`), seeded with: `continuous`,
`dashed`, `hidden`, `center`, `center2`, `dash-dot`, `dotted`, `phantom` — simple
dash/gap patterns only, no text/SHX. **Pattern units = drawing units**; one global
drawing linetype scale (`CadProject.linetypeScale?`, default 1.0; entity scale
deferred). Viewport pattern stable under pan/zoom, no per-frame phase jitter;
polyline phase: continuous across segments if reasonably achievable, else document
restart behavior. Keep `dash-short` as deprecated alias → remap to `dashed` on load
(error-ellipses default + existing drawings). Every new id added to
`DXF_LINETYPE_CATALOG` the same change. Manager UI: Layer Manager linetype cell
dropdown; Linetypes list (name + preview + create-simple + rename + delete-only-
when-unused/with-replacement). No LIN parser.

## 9. Transactions (wire, don't duplicate)

Use the existing `LAYER_*` command family; add keys only for new mutations:
`LAYER_COLOR`, `LAYER_LINETYPE`, `LAYER_LINEWEIGHT`, `LAYER_TRANSPARENCY`,
`LAYER_FROZEN`, `LAYER_DESCRIPTION`, `LAYER_SET_CURRENT`, and enforce unique names
on `LAYER_CREATE`/rename (case-insensitive). Route the two `replaceActiveDrawing`
layer-mutation paths through these transactions (fixes undo-wipe + selection-steal).
Entity appearance edits + layer-moves go through `EDIT_ENTITY`-adjacent undoable
paths. Every persisted mutation sets dirty; LWT toggle must not.

## 10. UI scope

- Layer Manager (upgrade `LayerPanel`): columns Status/Current, Name, On, Freeze,
  Lock, Plot, Color, Linetype, Lineweight, Transparency, Description (+ entity
  count); sort + name filter; inline edits; new/rename/delete (delete blocked for
  `general`, current layer, or layers with entities — entity count + message, no
  silent erase). No VP-freeze / plot-style / override columns.
- Ribbon HOME Layers group: current-layer dropdown (color chip + name), set-current,
  open manager. Command `LAYER` opens/focuses manager. Status bar: real LWT toggle.
- Properties: Layer (now editable = move), Color, Linetype, Lineweight,
  Transparency — each ByLayer-or-explicit (+ effective value as secondary text);
  multi-select COMMON/`*VARIES*`; edits undoable; locked-source edits rejected.
- Toolspace Settings: real Layers + Linetypes groups (no fake panels). Entity
  context menu additions only via the same registry paths.
- New generic entities take `currentLayerId` + ByLayer appearance (no hardcoded
  layer except domain-required specials: labels→`labels`, adjusted import, F2F).

## 11. F2F / styles / text / parcels / ellipses

F2F keeps its catalog; created layers use the real model (keep hashed colors, keep
`printable:true`); entities ByLayer where appropriate; reruns must not reset
user-edited layer-table properties. `CadStyleLibrary` stays; clarify: lineTypes are
drawing-owned table, `styles[]` are legacy appearance fallbacks (§4). Point symbols,
text styles, parcel semantics: no redesign — only color/visibility/lock/plot
inheritance applies. `role` preserved, never a display override.

## 12. Non-goals (enforced)

No per-viewport freeze/overrides, no CTB/STB, no complex linetypes, no block
editor, no multi-document manager, no MATCHPROP, no Adjustment/solver/statistics/
GNSS/CRS/units changes (parity 25/25 stays green). Transparency 0..1 canonical
(entity/layer); SVG/PDF apply where supported; DXF only if writer-safe, else
documented. ByBlock: **DEFERRED-NO-REAL-BLOCK-CONTEXT** (no selectable ByBlock in
ordinary Properties; no fake semantics).
