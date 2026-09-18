# Phase 18H — contour worker derivation (ownership, transfer, policy)

Companion: `phase18h-contour-architecture.md` §4 (extend-the-worker
recommendation). Owner: contour WORKER + CACHE + STATUS slice; the engine
sibling owns `src/engine/cad/surfaceContours/` geometry.

## 1. Transfer choice (structured clone, never detach)

The contours op (`surfaceWorkerHandler` `handleContours`) receives a
compact mesh (`points` XYZ + `triangles`) and a level spec through the
existing worker `postMessage` structured clone — the same decision as
§6 of `phase18g-browser-performance.md`: transferables would save
≈50–90 ms at 50k while breaking the plain-array protocol, and contour
payloads are smaller than the TIN (levels + paths, no grid/adjacency).
The client (`deriveContours`) never detaches main-thread buffers; the
service passes cached TIN arrays and the clone isolates the worker copy.

## 2. Ownership and cancellation

Request identity is
`{drawingId, surfaceId, surfaceRevision, contourGeometryRevision,
requestId}`. The handler keys latest-wins per surface on
`surfaceRevision@contourGeometryRevision`; the service mirrors it with a
pending entry per surface. Changing interval/base, mesh, or drawing
supersedes the in-flight request (`cancel` → settle null); a late result
for a superseded key is discarded before the cache and never posts
CURRENT — so no leaked BUILDING status (pending is dropped on
supersede/cancel/dispose). Cross-drawing late arrivals are rejected by
the drawing-id check, exactly like the TIN path.

## 3. Limits (block with diagnostics, never silent)

Level count is pre-computed by the engine's `computeContourLevels`;
exceeding `SURFACE_CONTOUR_LEVEL_LIMIT` (2000) throws
`ContourLevelLimitError`, mapped to the stable
`SURFACE_CONTOUR_LEVEL_LIMIT` diagnostic — the interval is never
silently bumped. After extraction the handler enforces
`SURFACE_CONTOUR_SEGMENT_LIMIT` (1M; ~10x headroom over a 50k-point
≈100k-triangle TIN, §7 display policy: one SVG path per surface) —
exceeding blocks with `SURFACE_CONTOUR_SEGMENT_LIMIT`, never silent
truncation, never a crash.

## 4. Stale-TIN policy

New derivation requires the parent TIN CURRENT for the same revision
(`cachedRevision` match + TIN cache hit); otherwise the service blocks
with `SURFACE_CONTOUR_STALE_TIN` and records the diagnostic without
touching the TIN. An older contour set may display stale-marked only
(`statusOf` returns `stale: true`). A new TIN revision auto-derives via
`notifyMeshBuilt` when `shouldAutoDerive` (style.showContours) holds —
lazy, and an interval change never rebuilds the TIN.

## 5. Status separation

Derived contour status (`NOT_REQUESTED`/`BUILDING`/`CURRENT`/`FAILED` in
`surfaceContourStatus.ts`) derives only from contour state (pending,
cache hit, contour diagnostic, TIN-currency gate) — never from
`deriveSurfaceStatus`. TIN CURRENT + contours FAILED leaves TIN
inquiries working: the failure path writes no TIN state.
