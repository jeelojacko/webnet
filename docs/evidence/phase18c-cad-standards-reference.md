# Phase 18C — CAD layer/property standards reference (Open CAD Studio)

## Purpose

Read-only reconnaissance of a mature, DWG-native CAD application's layer and
object-property model, gathered as **behavior input only** for the WebNet Phase
18C drawing-standards work (`docs/evidence/phase18c-spec.md`). This is a concept
inventory and a comparison, not a port plan, not a dependency decision, and not
a source of code.

## Provenance and license boundary

- Repository: https://github.com/HakanSeven12/OpenCADStudio
- Application license: GNU GPL-3.0 (repo `LICENSE`; GPL badge in `README.md`).
- Inspected revision: `472bb9883dab1d88f44ae674975658b1cb45f58f`
  ("Merge pull request #1337 …", committed 2026-09-17), shallow clone,
  read-only, placed **outside** the WebNet working tree (`/tmp`).
- Architecture: Rust; one shared editing core serves an `iced` desktop app and a
  wasm/web build.
- The DWG/DXF document model is the author's sibling crate `acadrust` (a git
  dependency of `HakanSeven12/cadcodec` pinned to `8a28c21`), which is
  **MPL-2.0**, not GPL. The layer-table, lineweight-enum, transparency, and
  layer-state types originate there. Neither that crate nor Open CAD Studio is
  vendored, linked, or copied into WebNet by this task.
- **No code was copied, adapted, or imported.** This brief contains only prose
  descriptions of observed behavior, interface/state names, and persisted-field
  concepts. No source lines or code blocks from either repository appear here.
- Facts below are direct observations of the cloned source. Statements that are
  reasoned rather than directly observed are labelled **inference**.

## Method

Primary-source inspection of `src/` at the revision above: the layer-manager UI
(`src/ui/window/layers.rs`), the named-layer-state UI
(`src/ui/window/layer_state_manager.rs`), the object Properties panel
(`src/ui/properties.rs`), the render-time appearance resolver
(`src/scene/view/render.rs`), the plot/paper path (`src/scene/paper.rs`), the
plot-style reader (`src/io/plot_style.rs`), the linetype catalog
(`src/io/linetypes.rs`), and the layer commands (`src/app/commands/layers.rs`,
`src/app/commands/layerprops.rs`, `src/modules/draw/layers/`).

## 1. Layer table

**Observed.** A drawing owns a layer table; the manager mirrors each table row
into a UI struct with these persisted fields:

- unique name (string, case-insensitive lookup; the reserved base layer is `0`)
- colour — indexed ACI, true RGB, or a named "book" colour, plus optional colour
  book/name labels
- linetype — stored as a name string, resolved against the drawing's linetype table
- lineweight — an enumerated value (see §3)
- transparency — a percentage (the editor range is 0…90 %)
- flags: on/off, frozen, locked, and a separate plottable bit
- per-viewport freeze bits, parallel to the paper-layout viewports

The default base layer is `0`: colour index 7 (white), continuous linetype,
Default lineweight, 0 % transparency, on / thawed / unlocked / plottable.

WebNet Phase 18C §1 keeps `visible` as "on", adds `frozen`, `transparency`
(0…1 float), and `description`, and reserves a protected default layer named
`general` (not `0`). The field set below the name/colour/linetype/lineweight
core is otherwise close, minus the colour-book fields and the per-viewport
freeze dimensionality.

## 2. Property inheritance (ByLayer / ByBlock / Default)

**Observed.** Object appearance is stored as *intent*, never as a resolved value:

- an object's colour is one of ByLayer, ByBlock, no-colour, an ACI index, or a
  true RGB; the Properties panel renders ByLayer/ByBlock as labelled swatches
  and offers the ACI palette inline
- an object's linetype is a name string; empty or `ByLayer` means inherit, and
  `ByBlock` is a third state
- an object's lineweight is an enum with ByLayer / ByBlock / Default variants
  alongside explicit weights
- transparency carries ByLayer / ByBlock intents plus a concrete alpha value
- material and plot-style each carry ByLayer / ByBlock / Global-or-Normal intent
  flags (plot style additionally has an explicit handle)

Resolution for ordinary (non-block) objects, observed in the renderer:

```
named colour-book entry  >  explicit object colour
                         >  per-viewport colour override
                         >  layer colour        >  WHITE
```

and independently for linetype (`object name > viewport override > layer
linetype > "Continuous"`), lineweight (`object weight > viewport override >
layer weight > Default`), and transparency (`object alpha > viewport override >
layer transparency > object default`). Effective linetype scale is one global
drawing scale multiplied by a per-object scale.

Block children add one extra rule set: ByBlock properties inherit the containing
INSERT's resolved style; a child on layer `0` whose properties are ByLayer
inherits the INSERT's *layer* style (the classic layer-0 rule); explicit child
properties still win. Xref-merged `xref|0` layers get the same treatment.

WebNet Phase 18C §2/§4 stores the same intent shape but deliberately omits
ByBlock (no block model) and omits per-viewport overrides (§12 non-goal). Its
precedence inserts one WebNet-specific tier OCS does not have — a legacy
`CadStyle` value between the explicit entity value and the layer value — because
WebNet already persists a style library, whereas OCS stores appearance directly
on objects (its *named* style tables cover text, dimension, mline/mleader, and
plot styles, not a generic entity style). Built-in fallback colour differs: OCS
falls back to white; WebNet falls back to `#94a3b8`. That is an intentional
WebNet product choice, not a standards rule.

## 3. Lineweights

**Observed.** Lineweight is an enum: ByLayer, ByBlock, Default, or an explicit
value stored in hundredths of a millimetre and displayed as `X.XX mm`. The
manager dropdown exposes exactly:

`ByLayer, ByBlock, Default, 0.00, 0.05, 0.09, 0.13, 0.15, 0.18, 0.20, 0.25,
0.30, 0.35, 0.40, 0.50, 0.53, 0.60, 0.70, 0.80, 0.90, 1.00, 1.06, 1.20, 1.40,
1.58, 2.00, 2.11 mm`.

Rendering converts a resolved millimetre weight through a fixed metric screen
scale (`96 px / 25.4 mm`) with a 1-pixel floor. The LWT-style lineweight display
toggle is applied in the wire shader as a uniform, so toggling it does **not**
retessellate or alter stored weights — it is a display preference only.

WebNet Phase 18C §7 uses the same physical-mm model, the same `Default` sentinel,
and the same "LWT is workspace-only, never dirties the drawing" contract, which
this inspection corroborates. The WebNet explicit list is close but not
identical (it keeps `0.00` and drops `1.06`; its exact ordering is normative in
§7). WebNet defines a resolved `Default` as 0.25 mm; OCS exposes `Default` as its
own enum state and resolves it like ByLayer, with the concrete fallback defined
by its document library (**inference**: not read directly at this revision).

## 4. Linetypes

**Observed.** Linetypes are a drawing-owned table seeded from a bundled `.lin`
catalog (QCAD-derived metric patterns plus an ISO 128 set). Entries include
Continuous, Dashed, Hidden, Center, Dash-dot, Dot, Phantom, Border, Divide, the
`.5x`/`2x` variants, and ISO dash/point families. A linetype can be *simple*
(dash/gap elements) or *complex* (embedded shapes or text). Simple patterns are
dashed in the shader; complex patterns and mline patterns are walked on the CPU.
The table is coupled to a linetype service that parses embedded text and shape
references.

WebNet Phase 18C §8 deliberately restricts the library to simple dash/gap
patterns (`continuous`, `dashed`, `hidden`, `center`, `center2`, `dash-dot`,
`dotted`, `phantom`), declares pattern units = drawing units, keeps one global
`linetypeScale`, defers per-entity scale, and explicitly forbids complex
linetypes and an LIN parser. The inspection shows what that deferral buys
(complex shapes/text, `.5x`/`2x` families) and corroborates the coupling WebNet
already knows about: a global scale times a per-object scale, and the linetype
table as a first-class, user-editable drawing table rather than a hardcoded
enum.

## 5. Visibility, lock, plot semantics

**Observed.**

- **Off** and **Frozen** are separate bits. Both remove geometry from display and
  from plot; both are applied as a scene-level filter (`off || frozen`) before
  tessellation and before picking, and both are ignored on a missing/unknown
  layer (the entity stays visible). Frozen additionally carries per-viewport
  variants. Off is the everyday on/off; freeze is the heavier state.
- **Locked** changes *editability only*. Locked-layer objects remain visible,
  snappable, and selectable; mutation paths consult a single layer-locked helper
  and skip them. WebNet §6 "LOCKED = visible + selectable, all mutation paths
  reject via one central gate" matches this contract exactly.
- **Plot / plottable** is a layer bit consulted only in the plot/paper path, not
  in model display. A false value removes geometry from plotted output while
  leaving it on screen. WebNet §6 splits the same behavior by format (SVG/PDF
  exclude; DXF preserves; WNCAD preserves; LandXML semantic).
- **Layer states** (adjacent, observed): a drawing can store named layer states,
  each a set of layer-property values plus a mask naming which properties the
  state owns. The mask vocabulary is On/Off, Freeze, Lock, Plot, New-VP-Freeze,
  Colour, Linetype, Lineweight, Plot-style, Transparency. States are saved,
  listed, restored (bulk apply), and deleted.
- **Per-viewport overrides** (adjacent, observed): colour, linetype, lineweight,
  and alpha can be overridden per layer per paper viewport through extension
  records, and per-viewport freeze is a separate manager column.

WebNet Phase 18C §1 adds a `frozen` bit whose *viewport* result is deliberately
identical to Off (§6 documents the currently small difference honestly), because
§12 rules out per-viewport freeze/overrides. The OCS model makes the eventual
upgrade path obvious (frozen → per-viewport freeze + overrides) without WebNet
taking it now.

## 6. Layer management UI and operations

**Observed.** The manager is a sortable table with columns Status, Name, On,
Freeze, Lock, Plot, Colour, Linetype, Lineweight, Transparency, plus one freeze
column per paper viewport. Header clicks sort (flip direction on re-click); the
default order is alphabetical by name. A live name-search box filters rows.
Multi-row selection drives bulk property edits. The toolbar has New, Delete, and
Set Current; the current layer is highlighted, its "Set Current" control is
disabled, and Delete is disabled for the reserved `0` layer.

Command/intent operations observed: `LAYER` opens the manager; `LAYER LIST /
NEW / ON / OFF / FREEZE / THAW / LOCK / UNLOCK / COLOR / SET` mutate the table;
`LAYMCUR` makes a selected object's layer current and keeps the drawing header's
current-layer name/handle in sync; `LAYISO`/`LAYUNISO` isolate by selected
layers; `LAYOFF/LAYFRZ/LAYLCK/LAYULK/LAYON/LAYTHW` operate on selection or all;
`LAYDEL` deletes a layer and erases its objects; `LAYMRG` merges one layer's
objects into another. Reserved-layer rules are observed in code paths: layer `0`
cannot be deleted or merged away, and the current layer cannot be deleted or
merged away (repoint current first). Locking a layer marks the drawing dirty
even though it changes only editability.

WebNet Phase 18C §10 specifies the same column set minus per-viewport freeze,
plus a Description column and an entity count; the same sort + name-filter; the
same New/Delete/Set-Current toolbar; and the same protected-default rule
(WebNet's `general` plays the role of OCS's `0`). OCS shows one extra safety
pattern WebNet §10 also adopts: delete is blocked (with a message) rather than
silently erasing contents, and blocked outright for the default and current
layers.

## 7. Plot styles and layer translation (adjacent, out of WebNet 18C scope)

Observed, recorded only so the boundary is explicit:

- **Plot styles**: a separate CTB/STB subsystem maps ACI colour or a named style
  to pen colour, lineweight, and screening percentage, with bundled tables
  (monochrome, grayscale, screening levels). The object property is a
  ByLayer/ByBlock/Normal intent flag. WebNet §12 excludes CTB/STB.
- **Layer translation**: a command maps one drawing's layers onto another
  (standards) drawing's layers, optionally forcing moved objects back to ByLayer
  so the target layer's properties actually show. WebNet has no equivalent in
  18C and does not claim one.

## 8. WebNet Phase 18C comparison summary

| Concern | Open CAD Studio (observed) | WebNet 18C spec | Direction |
|---|---|---|---|
| Layer fields | name, colour(+book), linetype, lineweight, transparency %, on/off, frozen, locked, plottable, per-VP freeze | visible(=on), colour, linetypeId, lineweightMm, transparency 0…1, frozen, locked, printable, description, role, defaultStyleId | WebNet adds description; drops book colour + per-VP |
| Default layer | `0`, white, protected from delete/merge | `general`, §3, protected from delete/rename | Same idea, different name |
| Entity intent | ByLayer/ByBlock/explicit for colour, linetype, lineweight, transparency, material, plot-style | `appearance` with absent = ByLayer for colour, linetype, lineweight, transparency; **no ByBlock** | WebNet defers ByBlock (§8/§12) |
| Precedence | book > explicit > viewport > layer > white | explicit > legacy style > layer > `#94a3b8` | WebNet inserts legacy-style tier; no viewport |
| Fallback colour | white | `#94a3b8` | Product choice |
| Lineweight | enum, 1/100 mm, fixed screen scale, LWT = shader uniform (display only) | float mm, explicit list, Default = 0.25 mm, LWT workspace-only | Same model; list + exact Default differ |
| Linetype | drawing table, simple + complex, global × per-entity scale | drawing library, simple dash/gap only, global scale, entity scale deferred | WebNet is a strict subset by design |
| Off vs Frozen | distinct; both hidden; freeze has per-VP dimension | distinct bits; identical viewport result now; upgrade path noted | WebNet honest about the small gap |
| Locked | visible/selectable/snappable; mutation skipped centrally | visible/selectable; `LAYER_LOCKED` via one gate | Matches |
| Plot | layer plottable bit consulted only in plot path; CTB/STB | printable excludes SVG/PDF; DXF/WNCAD preserve; no CTB/STB | Matches where both cover it |
| Layer states | named states + property mask, save/restore/delete | not in 18C | Deferred, not contradicted |
| Layer translation | standards-drawing mapping, force-ByLayer option | not in 18C | Deferred |
| Manager UI | sortable table, search, multi-select, New/Delete/SetCurrent, `0` protected | same columns (+description, entity count), sort+filter, same toolbar, `general` protected | Aligned |

Net read: the Phase 18C spec is a deliberately conservative subset of a mature
DWG-native model. It agrees on the load-bearing contracts (ByLayer intent, layer
colour/linetype/lineweight/transparency inheritance, off/frozen vs locked vs
plottable separation, LWT as display-only, protected default layer) and it is
explicit about every place it declines the fuller model (ByBlock, per-viewport
overrides/freeze, CTB/STB, complex linetypes, layer states, translation).

## 9. Licensing boundary (explicit)

- Open CAD Studio is **GPL-3.0**. Under no circumstances may its source be
  copied, adapted, translated, linked, or vendored into WebNet; doing so would
  impose GPL obligations on WebNet.
- This task performed a **read-only inspection** of a shallow clone placed
  outside the WebNet working tree. It produced **concepts and observations
  only**. No file from Open CAD Studio (or its `acadrust`/`cadcodec` dependency)
  was added to the WebNet repository, and no expression from it was reproduced
  in this document. WebNet source is otherwise unchanged by this note.
- The `acadrust`/`cadcodec` layer model used by the application is MPL-2.0 (a
  sibling crate, not GPL). It is mentioned for provenance; nothing from it is
  copied either. MPL-2.0 is file-level copyleft; regardless, WebNet takes no
  code from it.
- The behavior ideas recorded here are standards-level concepts shared across
  CAD applications (ByLayer inheritance, layer tables, lineweight values,
  on/freeze/lock/plot flags). They are not protected as ideas, and WebNet's
  implementation is written independently from the Phase 18C spec.
- If future work wants to reuse actual Open CAD Studio code, it must not be done
  on this branch or under WebNet's current license without an explicit, reviewed
  licensing decision.
