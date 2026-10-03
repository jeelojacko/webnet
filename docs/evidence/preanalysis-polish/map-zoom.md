# Map zoom strategy (Wave E)

## Root causes (confirmed)
1. Stale parent-tile stretching: `resolveParentFallback` resampled one parent
   across zoom levels — basemap labels visibly scaled mid-gesture.
2. Deferred SVG overlay lag: frozen overlay geometry vs live basemap transform.
3. DPR pop: `prepareCanvas` toggled backing store between provisional 1x and
   full DPR during the same gesture.

## Fixes (no new map library; provider/cache/offline preserved)
- **DPR**: backing dims = `round(VIEW × devicePixelRatio)` for the whole
  gesture (2D + WebGL via shared `resolveFullDevicePixelRatio`); resize only
  on viewport/DPR change; CSS dims stable; canvas records
  `dataset.mapViewTransform`.
- **Tiles**: `MAX_PREFERRED_FALLBACK_ZOOM_DELTA = 1`; deeper parents kept only
  for offline coverage and flagged `fallbackPreferred:false`. During
  `interacting`, a deep-only resolve reuses last rendered current-level tiles
  (requests for new tiles continue — no blanks).
- **Overlays**: frozen base-projected geometry kept; SVG groups receive the
  same live per-frame `view2d` transform as canvases via shared
  `formatMapViewTransform` (+ `data-map-view-transform`); recompute after
  settle; `shapeRendering` flips only at `idle`.

## Review follow-up (per-tile selective reuse)
All-or-nothing reuse (`hasStaleStretch ? previous : resolved`) discarded newly
loaded exact tiles whenever ANY tile had a deep fallback. Fixed via pure
helper `reusePreviousTilesForDeepFallback` (`mapViewBasemap.ts`): exact /
current-level tiles always kept; previous tiles reused ONLY for deep
(`fallbackPreferred === false`) keys with a previous match; reference-stable
when nothing can be rehomed. Covered by `map_view_basemap.test.ts` (mixed
set: exact kept, deep rehomed, stale-viewport tile dropped).

## Residuals (honest)
- Child-in swap is a repaint, not dual-opacity blend (true cross-fade needs
  dual-canvas compositing, excluded by no-redesign).
- Long single-gesture zooms may hold slightly magnified edge tiles until settle.
- Full-DPR during interaction costs fill rate vs old 1x provisional mode.
- Overlay sync verified at DOM/attribute level (jsdom), not pixels.

Tests: mapView batch 20 files / 57 pass incl. new `map_view_zoom_transform`.
