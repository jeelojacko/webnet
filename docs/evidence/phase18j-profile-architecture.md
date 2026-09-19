# Phase 18J — Surface Profile Architecture Audit

Baseline: origin/main `8bc5e9b4d1237dfa62747d71d565d007ad521fc2` (PR #99 merged; main did not advance).
Branch: `feat/cad-surface-alignment-profiles`.

## 1. Current alignment representation

- `CadAlignmentEntity` (`src/engine/cad/cadTypes.ts:306-312`): first-class `CadEntity`
  (`type:'alignment'`, `name`, `elements`, `startStation`, `stationEquations?`),
  carries `layerId`/`styleId`/`appearance`, undoable, persisted as entity.
- `CadAlignmentElement` (`cadTypes.ts:284-298`): `line {start,end}` | `arc
  {center,radius,startAngleDeg,endAngleDeg}`, optional `sourceEntityId`.
- `CadStationEquation` (`cadTypes.ts:300-304`): `{backStation, aheadStation, rawStation?}`.
- Closed alignments **unsupported**: `cadAlignmentDraft.ts:122-175` requires exactly 2
  degree-1 endpoints; rings return `null`. Profiles assume one open ordered chain.
- No tangent/bearing-at-station helper exists in `src/engine/cad/` — profile
  extraction needs none; do not invent one.

## 2. Raw chainage vs displayed station

Authority: `cadPointAtAlignmentStation` (`cadAlignment.ts:53-96`):

```ts
rawStation = cadAlignmentDisplayStationToRawStation(alignment, station);
localStation = rawStation - startStation; // walk cumulative elementLength
```

- **Raw chainage = `startStation` + cumulative element length.** Continuous.
- Display = raw + cumulative equation delta (`cadAlignmentRawStationToDisplayStation`,
  `cadAlignmentStationing.ts:105-129`; exactly at equation → `aheadStation`).
- End: `cadAlignmentEndStation = startStation + totalLength + deltaAfter` (:83).
- Formatter: `formatCadStation` (:96-103) — the ONE formatter; profiles reuse it.
- Ambiguity fail-closed: display station strictly inside `(backStation, aheadStation)`
  resolves to `null` (`:148-151`) — never guessed. Profile inquiry surfaces this honestly.
- `getAlignmentStartStation` (:31): absent ⇒ 0. Preserve `rawStation = startStation +
  distanceAlongAlignment` contract.

**GO gate:** profile geometry samples raw chainage; display station is labels/grid/markers only.

## 3. Alignment helpers to reuse (never re-implement)

- `cadAlignmentElements.ts`: `getAlignmentElements`, `alignmentElementLength`,
  `alignmentElementStartPoint/EndPoint`.
- `cadAlignment.ts`: `cadPointAtAlignmentStation` (:53), `cadPointAtAlignmentStationOffset`
  (:98), `cadProjectPointToAlignment` (:255), `cadBuildAlignmentStationPoints` (:288).
- `cadAlignmentStationing.ts`: `getAlignmentStartStation`, `cadAlignmentEndStation`,
  `formatCadStation`, raw↔display converters.
- Known duplication trap: `cadAlignmentStationing.ts:13-23` privately re-implements
  element helpers; `cadAlignment.ts:45` exports a second `cadAlignmentLength`. No third copy.
- STA/STA EQ/STA PT/STA INT: engine `cadTransactionsAlignmentStationCommands.ts` +
  `cadTransactionsAlignmentStationEquationCommand.ts`, registry `cadTransactions.ts:509-513`,
  session `useSurveyCadCommand*`, shell `cadCommandRegistry.ts:101-104`. Unchanged by 18J.

## 4. Surface interpolation capabilities

- `CachedSurfaceMesh` (`cadSurfaceCache.ts:18-24`): `{revision, points, triangles, stats,
  grid, adjacency, edgeKinds}`; scoped cache `createCadSurfaceCache(scopeId)`, never global.
- `getSurfaceElevationAt` (`cadSurfaceInterpolation.ts:55-86`): grid cell + full-scan fallback.
- `CadSurfaceGrid` (`cadSurfaces.ts:99-104`): uniform grid `{minX,minY,cellSize,cells}` —
  reuse for profile candidate queries (no element×edge brute force).
- `adjacency`/`edgeKinds` (`tin/tinTypes.ts`): exact domain/void/boundary classification.
- `computeCadSurfaceSourceRevision` (`cadSurfaceRevision.ts:293-330`, FNV-1a `srev1:`).
- Status always derived (`deriveSurfaceStatus` :324-340); volumes copy the pattern
  (`deriveVolumeSurfaceStatus`, `cadVolumeSurfaces.ts:142`).

## 5. Source-revision model

`computeSurfaceProfileRevision` (`prev1:` FNV-1a) over canonical:

- alignment entity id + ordered element digests (kind + rounded coords)
- `startStation`
- station-equation list (back/ahead/raw) — geometry-affecting only via mapping
- source surface `srev1` revision

NOT included: colors, layer visibility, view size, contour interval, labels, UI state.
Split: geometry revision (alignment XY + TIN) vs presentation (startStation/equations affect
labels/markers only — resampling avoided where existing semantics allow; documented in §8).

## 6. Profile sampling strategy (final)

- **Line portions:** topology-exact. Walk alignment segment against grid candidate triangles;
  emit events at TIN edge crossings, outer-boundary entry/exit, void entry/exit. Within one
  triangle, Z along a straight horizontal line is linear → exact, no blind N-metre sampling.
- **Arc portions:** topology-aware + adaptive subdivision. Within one triangle plane z(s) is
  not linear → subdivide chord until `|plane(mid) − lerp(endpoints)| ≤ PROFILE_ARC_TOLERANCE`
  (engine constant, documented; display-approximation only — inquiry uses direct XY + interpolation).
- Dedup: shared-edge double reports merged by raw-station epsilon; vertex crossings emit one
  canonical event; along-edge travel stays continuous if adjacent planes agree within epsilon,
  else fail/diagnose (no sawtooth).
- Boundaries terminate segments; voids create gaps (never bridged). Multiple segments supported;
  stats report covered/gap raw lengths, min/max elevation.

## 7. Profile-view rendering options (chosen)

- First-class `CadProfileView` presentation object (insertion XY, horizontal scale, vertical
  exaggeration, datum auto/explicit, grid intervals) — NOT thousands of CadEntity primitives.
- Derived display layer `CadProfileViewDisplayLayer`: aggregated SVG paths (grid, one path per
  profile segment set, equation markers, bounded labels). Selection selects the view object.
- Viewport OFF/FROZEN hides view (`filterCadDisplaySceneForViewport` pattern); LOCK blocks edits
  (`isSurfaceLayerLocked` pattern). Status as TEXT, never color-only.

## 8. Worker needs

Extend the ONE surface worker (no new worker file): `'profile'` op in
`surfaceWorkerHandler.ts` + `preq-N` client method (mirror `volumeRequestKey`/vreq pattern).
New `surfaceProfileService.ts` mirroring `surfaceVolumeService.ts` line-for-line:
`(requestId, drawingId, profileId, profileRevision)` ownership, `supersede`, `complete` with
cross-drawing + revision re-derivation + stale-mesh gates, bounded cache (current + ≤1 stale),
manual rebuild only (source rebuild cancels/empties, never auto-recomputes).
Request carries compact alignment geometry + equations + surface mesh snapshot — never whole project.

## 9. Persistence requirements

Additive v2 (no schema bump): trailing `surfaceProfiles?`, `profileViews?`, `profileStyles?`
tables in `cadTypes.ts` after `volumeSurfaceStyles`; clone in `cloneCadProject` (order-sensitive);
backfill + `clearProfileCacheOnLoad` in `cadSurfaceTypes`-style helper module (`cadProfileTypes.ts`);
migrate/sanitize in `cadDrawingFile.ts`. Persist definitions + view settings only — never sample
arrays, statuses, or derived paths. Reopen → `UNBUILT`/`SOURCE_NOT_CURRENT`, never false CURRENT.
Style CRUD refcount-guarded (mirror `cadVolumeSurfaces.ts:173-294`).

## 10. Production profile model: confirmed absent

Grep for `CadSurfaceProfile|CadProfileView|CadProfileStyle|profileView|PROFILEVIEW` → zero
matches in `src/` and `tests/`. Contour/volume are the only derived surface objects;
`SurveyManagerKind`/`CadWorkspaceSnapshot`/command registry have no profile entries.
