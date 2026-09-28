# Phase 20D — Design Surface Workflow Architecture Audit

Baseline: origin/main `273f0950` (PR #124 merge, exact match, fetch-verified no advance).
Branch: `feat/cad-design-surface-workflow`. No production code before this audit.

All file:line refs verified by direct read on the branch (scout leads spot-checked).

## 1. Current Surface identity / definition architecture

- `CadSurface` (`src/engine/cad/cadTypes.ts:1453`): `{ id, name, definition, styleId?, cachedRevision?, layerId?, buildDiagnostic? }`.
- `CadSurfaceDefinition` (`cadTypes.ts:1239`): point/breakline/boundary sources + buildOptions + 18S edit stack + `sourceKind?: 'native'|'imported-tin'|'explicit-tin'` + `importedTin?: ImportedTinPayload`.
- `computeCadSurfaceSourceRevision` (`cadSurfaceRevision.ts:497`) hashes ONLY definition-derived
  content (points/groups/breaklines/rings/options/broken/edits, or explicit payload+edits).
  Top-level `CadSurface` fields (id/name/style/layer) are excluded **by construction**.
  Consequence: a new optional top-level `purpose` field is automatically metadata-only —
  no revision change, no contour/analysis/profile/volume/export drift. (§4 proven by code shape.)
- Status: `deriveSurfaceStatus` (`cadSurfaces.ts:505`); cache `cadSurfaceCache.ts:37`
  (scoped `scope::surfaceId@revision`, reopen clears via `clearSurfaceBuildCacheOnLoad`).
- No `surfaceRole`/`surfacePurpose`/`existing-ground`/`design-surface`/`design-patch` concept
  exists anywhere in `src/` (verified by grep; only near-miss is "proposed" overlay geometry
  in edit sessions and a 20B doc non-goal note). No duplication risk.

## 2. Bake snapshot semantics (18X)

- `SURFBAKE` in place / `SURFBAKECOPY` new surface (`cadTransactionsSurfaceBakeCommands.ts:78-128`).
  Both resolve the CURRENT final mesh via `buildCadSurface`, canonicalize
  (`canonicalizeBakedTin`, `cadExplicitBake.ts:44`: compact, ascending remap, CCW enforced),
  store as `explicit-tin` payload with `webnet-bake` provenance. Gates: CURRENT + expectedRevision
  re-read + layer lock; one history entry; source byte-identical on copy path.
- Design Copy reuses this path verbatim: new id, new name, `purpose='design'`, snapshot payload.
  No re-triangulation, no Delaunay. **Provenance decision: reuse `webnet-bake`** — it already
  records source surface id + revision truthfully; workflow meaning comes from `purpose`.
  No new provenance kind for design copies (avoids proliferation, §10).

## 3. Compose / Paste semantics (18Y/18Z, geometry authority)

- `composeSurfaceMeshes` (`surfaceCompose.ts:121`): sole policy `overlay-coverage-wins`;
  fast paths (`composeFastPaths.ts`: full-overlay, strict-disjoint) fail closed to the normal
  constrained-TIN pipeline; cell ownership by centroid; seam probes at endpoints+midpoint.
- Seam rule: base/overlay Z agreement within the numerical floor, else
  `SURFACE_COMPOSE_SEAM_Z_MISMATCH`. No tolerance knob exists; none will be added.
- `SURFCOMPOSE` (copy) / `SURFCOMPOSEPASTE` (in-place, target keeps id/name/layer/style;
  `cadTransactionsSurfaceComposeCommands.ts:146-230`). DESIGNAPPLY reuses the PASTE core
  transaction seam with zero numerical change.

## 4. Grading Group Bake geometry (20C) — the missing-interior proof

- `GROUPBAKE` (`cadTransactionsGradingGroupCommands.ts:332-...)` snapshots ONLY
  `result.gradingMesh` (strip annulus: per-member quads + corner gap patches,
  `gradingGroupCompute.ts` ~L314-330, ~L430-450). **Pad interior is NOT included.**
  Square-pad pin: 100×100 source → 140×140 daylight, plan area 9600 = 140²−100² (not 19600).
- `CadGradingGroupResult` (`gradingGroupTypes.ts:120`) exposes `daylightPoints`, `gradingMesh`,
  `corners` — **no source-boundary array**. Source vertices exist only implicitly as mesh verts.
- 20D adds a derived session-only `sourceBoundaryPoints` helper (NOT persisted, no numeric change).
- 20C restriction R1 (flat closed pads): closed groups need flat source elevations
  (`phase20c-visual-qa.md:142-144`; gates `solveStraightChord.ts:328-333`,
  `gradingGroupSectors.ts:315-322`). 20D admits exactly this scope; non-flat blocks closed.

## 5. Why direct EG + grading-shell composition legitimately fails

Conceptual topology (required diagram):

```
Existing Ground:
          ----------------------------
Pad + Grading Design Patch:
              ___________
             |           |
             |  PAD TOP  |
             |___________|
            /             \
           /    GRADING    \
----------/-----------------\----------
```

- For a closed pad at Z=110 over EG at Z=100, the grading shell spans source boundary
  (Z=110) → daylight (Z=100). Pasting the shell alone into EG creates a seam at the source
  Feature Line where Zgrading(110) ≠ Zexisting(100). The 18Y engine **correctly refuses** this.
- The Design Patch closes the hole by supplying the pad interior at padZ, so the only outer
  seam against EG is daylight — where 20C already proves exact target agreement
  (`GRADING_DAYLIGHT_DISAGREE` / `CORNER_NO_SOLUTION` gates). No geometry rule changes;
  only a better diagnosis (§39: "grading surface contains slopes only… Build a Design Patch").

## 6. Design Patch strategy (exact)

1. Gate: group status CURRENT, closed, flat (strict `===` equality of all ring Z — no averaging,
   no epsilon flattening; canonical padZ chosen only after equality proof). Non-flat →
   `DESIGN_PATCH_NON_FLAT_INTERIOR_UNDEFINED`.
2. Ring authority: re-derive the source ring through the SAME linearization the group compute
   used — straights as single chords; arcs via `linearizeGradingArc` (`gradingCurve.ts:48`)
   with the group's `curveChordTolerance` (same `linearizeMember` logic,
   `gradingGroupCompute.ts:97`). Then **verify every ring edge against the CURRENT grading mesh**
   (exact vertex match): zero mismatch required, else block. No second discretization.
3. Ring validation: finite, ≥3 distinct verts, closed convention, simple (no self-intersection,
   no duplicate non-adjacent verts), plan area > 0.
4. Interior: existing `earClip` (`cadSurfaceEditAddLine.ts:36` — exact predicates, deterministic,
   concave-capable, no holes/Steiner, no boundary subdivision). All interior verts at padZ.
   No fan triangulator (fails concave). Failure → block, never guess.
5. Merge: direct topology merge with exact XYZ vertex interning (pad interior and grading shell
   are disjoint except the shared boundary). No global composition pass.
   Final patch must pass stock `validateExplicitTinPayload` (`cadImportedTin.ts:31`):
   source boundary becomes internal manifold seam (1 pad side + 1 grading side per edge),
   daylight ring becomes outer boundary.
6. Provenance: new kind `webnet-grading-design-patch` (groupId/Name/Revision, source FL id,
   course refs, target id@rev, accuracy, cornerMode, includesInterior, interiorPolicy).
   Justified: `webnet-grading-group-bake` cannot truthfully describe an interior it never had.
7. Snapshot: patch is ordinary `explicit-tin` + `purpose='design-patch'`; later group/FL/target
   edits leave it unchanged; delete group → patch remains.

## 7. Surface-role semantics

- `export type CadSurfacePurpose = 'existing-ground' | 'design' | 'design-patch' | 'reference' | 'other'`,
  optional `purpose?` on `CadSurface`. Absent = legacy neutral. Unknown values sanitize to
  `other`/undefined with warning (follow parser conventions; never reinterpret as EG/design).
- Never inferred (survey points ⇏ EG, grading ⇏ design, import ⇏ reference). Creation flows may
  suggest; committed value is explicit. `SURFPURPOSE` = one history transaction, no rebuild,
  no dependent invalidation.
- "Existing Ground"/"Design" are drawing-role labels (terrain-in-use / proposal-in-use), NOT
  survey-date, datum, as-built, or approval claims. Neutral UI language.
- Generic tools stay generic: no global EG immutability. Only the NEW DESIGNAPPLY command
  blocks `purpose='existing-ground'` targets ("Create a Design Copy first").
- Generic copy policies: SURFBAKECOPY preserves purpose (legacy absent stays absent);
  SURFCOMPOSECOPY inherits Base purpose; Design Copy explicitly sets `design`.

## 8. Volume / downstream workflow

- DESIGNVOLUME is a shortcut only: find-or-create ordinary `CadVolumeSurface`
  (base=EG, comparison=design), explicit Calculate. 18I math, sign (Δ=Comparison−Base,
  Design>EG=FILL), and NEEDS_RECALC revision logic untouched — staleness after Apply or
  EG edit falls out of existing `deriveVolumeSurfaceStatus`.
- Contours 18H / analysis 18U / profiles 18J / sections 18K / LandXML / WNCAD / transforms:
  all keyed on surface revision; Design/Patch surfaces are ordinary surfaces, so everything
  works with zero special casing. LandXML exports retained TIN (no invented schema attrs;
  purpose is WebNet-only except WNCAD FULL + UI presentation).

## 9. Provenance / export / performance risks

- Provenance: one justified addition (`webnet-grading-design-patch`); design copies reuse
  `webnet-bake`. No live recipe persisted (snapshot + history only); no auto-rebase, no
  auto-compose-on-calculate, no auto-bake.
- Exports: WNCAD carries purpose+provenance; LandXML N/A (documented); DXF/SVG/PDF normal
  surface disposition.
- Perf: patch build is linear in ring size (earClip O(n²) worst-case on pathological combs —
  bounded by 20C group scales; benchmark 4/20/100/1000 courses). Apply rides 18Z (benchmark
  10k/50k/100k × small/med/large/sequential/overlap). No 18Z redesign without measured bottleneck.

## 10. Wave map

- W1 engine: purpose + SURFPURPOSE + sanitizer + DESIGNSURFACE + source-ring helper +
  patch build/validate/provenance + DESIGNAPPLY (paste-core reuse + preflight + raw-shell
  diagnosis) + DESIGNVOLUME shortcut + engine oracles (§§78-104 pins).
- W2 UI: manager Design Workflow section + purpose badges + Toolspace suffix + Properties +
  ribbon/registry commands + 1366 usability.
- W3 QA: browser spec (§105 A-Q) + perf (§§101-103) + 3-resolution visual QA (§106) +
  reviewer gate (§131) + PR (no merge).
