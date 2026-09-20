# Phase 18Q — Native Mirrored Block References (decision record)

## Decision: additive `mirrored` flag, not signed scales

Scale signs never encode reflection. `normalizeBlockScales` still rejects
nonpositive scales everywhere, so a negative `scaleX` arriving from anywhere
(legacy file, hand-built command) fails closed instead of silently mirroring.
`CadBlockReferenceEntity.mirrored?: boolean` (absent = false) and
`BlockPlacement.mirrored?: boolean` carry the flag; every consumer
(rendering, bounds, spatial index, snaps, DXF, explode) routes through the
one expansion seam (`transformBlockChildToWorld` /
`expandBlockReference` in `src/engine/cad/cadBlocks.ts`), so the mirror
cannot diverge between pipelines.

## Normative formula

p_w = insert + R(rotationDeg) · S(scaleX,scaleY) · M · (p − basePoint),
M = diag(−1,1) when mirrored, else identity. Reflection is in block-local
coordinates BEFORE rotation (so mirror + rotate composes like a physical
mirror-then-turn, matching DXF INSERT semantics with negative group 41).

## Arc rule

Mirroring reverses sweep direction. With rotation applied after the flip:

- start′ = normalize(rotation + 180 − end)
- end′ = normalize(rotation + 180 − start)
- radius′ = radius · mean(scaleX, scaleY) (existing non-uniform approximation)

The 180° compensates the local x-flip. Non-mirrored refs keep the existing
start+rot / end+rot rule byte-identical.

## Readable-text policy

Mirrored refs keep text glyphs readable: only the text anchor goes through
the mirrored transform; glyph orientation is never mirrored. This falls out
of the engine (text children carry no rotation) and the renderer (text
primitives emit unrotated glyphs). No MIRRTEXT variable, nothing to
configure. DXF upholds it differently (below) because a native mirrored
INSERT would mirror glyphs in the receiving CAD reader.

## DXF mapping

- INSERT group 41 = mirrored ? −scaleX : scaleX, group 42 = scaleY,
  group 50 = rotationDeg. Same mapping in R12 (`dxfSerializer.ts`) and
  R2000 (`dxfLayoutExport.ts`). Native BLOCK/INSERT kept, no definition
  duplication.
- Mirrored refs additionally materialize block TEXT children as world-space
  TEXT entities (height 2.5 · meanScale, readable glyphs). Geometry children
  stay in the BLOCK. No R12 deviation was needed: R12 carries native
  mirrored INSERTs fine; only the text needs the world-space companion.
- Never silently unmirror: a ref that cannot expand is omitted + warned
  (existing fail-closed path), never exported unmirrored.

## SVG / PDF

Both flow through `buildCadDisplayScene` → the single expansion seam, so
mirrored blocks render correctly with no format-specific code. Covered by a
scene test (mirrored line endpoint present in primitives).

## WNCAD migration (schema stays v2)

Missing ⇒ false. Canonical form is absent (false) or boolean `true`;
sanitize strips non-boolean `mirrored` junk and drops `false` back to
absent, so legacy drawings open byte-stable (no appearance change, no
JSON churn). `cloneCadEntity` spread, COPY/PASTE spread, BLOCK_CREATE
(absent default), BLOCK_INSERT/BLOCK_EDIT (explicit flag), and
BLOCK_DUPLICATE (definition-level, refs untouched) all preserve the flag.

## Risks

- Readers that ignore negative group-41 X scale will show the ref
  unmirrored; accepted (native DXF semantics, same as industry software).
- Arc under non-uniform scale remains a mean-scale circle approximation
  (pre-existing); mirror does not make it worse.
- Exploding a mirrored ref bakes the mirrored world geometry (correct —
  explode is a bake, and text explodes at its mirrored anchor, readable).
