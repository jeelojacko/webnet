# PERF-183.1 — CAD pointer-move render architecture

Branch `perf/issue183-cad-pointer-render`. Scope: the CAD pointer-move render
storm only (#183). Everything else in the CAD workspace is unchanged.

## Root cause

Every `mousemove` over the CAD preview called
`onPointerWorldPointChange` → `useSurveyCadSnapping.updatePointerWorldPoint`,
which unconditionally:

1. `setPointerWorldPoint(freshObject)` — a root-hook state change on every
   pointer move (even with no command active);
2. `setNearbySnaps(freshArray)` / `setActiveSnap(freshObject)` — fresh object
   identities even when the resolved snap was identical;
3. `setLockedConstructionSnap(...)`.

The root `useSurveyCadWorkspace` re-rendered, and `SurveyCadPreviewCanvas`
re-ran `scene.primitives.map(renderPrimitive)` for the whole drawing on every
one of those commits. At 1k–5k primitives that is a per-move full scene
reconcile.

## Fix layers

### 1. Snap state semantic dedupe — `src/hooks/surveyCad/cadSnapEquality.ts`

Pure field-by-field equality for `CadSnapCandidate` (id, kind, exact
`sourceEntityId` + `sourceSegmentId`, world coords, distance, label,
`computedScale`, `viewportGeneration`, guide geometry, compound kinds, lock
guide point), candidate lists (positional), and `CadSnapLock`.
`useSurveyCadSnapping` applies them through functional `setState` updaters, so
React bails out when the resolved snap is unchanged. The project/construction
reset effect uses the same updaters so a mount no longer churns a fresh `[]`.

### 2. Pointer world point out of per-move root state

`useSurveyCadSnapping` keeps `pointerWorldPointRef` (always fresh, updated on
every move) plus an imperative `subscribePointerWorldPoint` channel. React
`pointerWorldPoint` state is committed only when a caller passes
`reactivePreview: true` — i.e. the canvas while `commandPointInputActive`.
Idle moves update the ref and notify the leaf (shell cursor readout) with **no
React root commit**. `UpdatePointerWorldPoint` keeps the construction lock,
visible-bounds, restricted-grip, and tolerance-dedup semantics unchanged.

`SurveyCadWorkspace` now subscribes to the channel for `shellLink.publishCursor`
(which was already deduped) instead of rendering on `pointerWorldPoint` state.

### 3. Memoized static primitive layer — `SurveyCadPreviewStaticPrimitives.tsx`

The scene map moved into a `React.memo` component whose render-affecting props
are only `primitives`, `project`, `scale`, `selectedEntityIdSet`, and
`entityOpacityOverrides`. Event dispatch rides a latest-ref `dispatchRef`, so
callback identity never invalidates the memo. `SurveyCadPreviewCanvas`
memoizes a `Set` of selected ids (replacing per-primitive
`selectedEntityIds.includes`) and passes a module-stable empty opacity record
as the `SurveyCadPreview` default. Snap guides, transient preview, grips, and
selection box stay dynamic siblings.

### 4. Render-only viewport culling — `SurveyCadPreview.geometry.ts`

`isPrimitiveOutsideViewport(primitive, project, scale)` filters the scene map
before creating SVG elements. It reuses `primitiveBounds` (screen space,
already viewport-dependent) and adds per-primitive padding for the invisible
pick stroke, selection highlight, and marker halo. Arc/circle bounds are the
conservative full-circle box; ellipse bounds are the conservative axis-aligned
box (safe for rotation); line boxes retain any segment crossing the viewport.
Non-finite bounds and empty bands fail **open** (never culled). Culling never
touches `cadProject`, the spatial index, snapping, selection, or exports.

## Data flow

```
mousemove → onPointerWorldPointChange
  → snapping: ref + subscribe channel           (no root commit when idle)
              snap state deduped functional set   (commit only on real change)
canvas render:
  <SurveyCadPreviewStaticPrimitives .../>         memo: skip when inputs stable
      → isPrimitiveOutsideViewport(...)           render-only filter
      → renderPrimitive(... selectedEntityIdSet)  Set lookup
  <TransientPreviewLayer/> <GripHandleLayer/>
  <SnapGuideLayer/> <SelectionBoxLayer/>          dynamic siblings
shell cursor ← subscribePointerWorldPoint         imperative leaf publish
```

## Boundaries / out of scope

- No change to `cadProject`, engine geometry, spatial index, snap math,
  selection state, exports, or persistence.
- #184 / #185 / #186 / #194 are out of scope.
- Culling is display-only: off-viewport selected entities stay selected, and
  the full geometry remains available to snaps, picks, and export.
