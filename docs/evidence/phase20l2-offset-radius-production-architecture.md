# Phase 20L.2 offset-radius production — architecture

Bounded automatic route: R0 whole-route exact-offset for admitted flat open
curved analytic groups only. Everything else rides the untouched chord path.

## Route predicate (all-or-fallback, per corner LOCAL admit + full-route ACTIVE)

- Open multi-member curved analytic group at one shared `d` (Distance /
  flat Elevation / Relative Elevation / same-d same-Z mixed), flat
  (all member Z equal), joint-continuous (`endZ === startZ` at every joint).
- Per corner: plan-P0 (`provenConstantPlanOffset`, Roff > 0 exact), UNIQUE
  on-body join, `d <= maxSearch` exact, `|J-V|` within E1 extent
  (`extentJVWithin`), C0 on-body, no arc-pair corner, analytic XYZ tie at
  the built join J (each member law at its own joint Z, join-Z numerical
  agreement within `zeroDelta`).
- Any corner failing any gate revokes the whole route (no splice, no
  per-corner exact islands). Closed groups, line-only groups, and
  single-member groups never attempt.

## Modules (production, `src/engine/cad/grading/`)

- `gradingExactOffsetPolicy.ts` — preflight route gate (R0 adoption,
  flatness/joint/criterion membership, closed/line-only/single refusal).
- `gradingExactOffsetGeometry.ts` — radial-sign law, `solveExactOffsetJoin`,
  `extentJVWithin`; agreement under the shared 20J1 authorities
  (`coordinateAgreementTol`, `zeroDelta`), never copied, no new epsilon.
- `gradingGroupExactOffset.ts` (+ `.types.ts`) — whole-route builder:
  exact joins shared bitwise between incident runs, source endpoints
  authoritative, daylight = true concentric offset arcs (Roff) + exact line
  offsets, one FIXED region per member, tessellation under
  `curveChordTolerance` via the shared `featureLineArcSubdivisions`
  authority (stricter of source/offset counts, floating-point sagitta
  re-proven), standard result assembly + gtop2 revalidation.
- Dispatcher hook in `gradingGroupCompute.ts` — attempts the exact route
  after the universal sanity gates for open multi-member curved groups;
  EXACT returns, FALLBACK falls through byte-identical. No
  `CURVE_CORNER_APPROXIMATED` on the exact route; accuracy stays
  `CURVE_APPROXIMATED` (tessellated mesh, never claimed exact).
- Session-only provenance: `curveGeometryMode: 'EXACT_OFFSET_RADIUS'` +
  per-corner `exactOffsetJoinXyz`; never persisted, never hashed into
  `ggrev1:`; `tiePointXyz` never overloaded.

## Result semantics

Exact joins are not corner approximations: FIXED regions, exact J shared
between runs, daylight rides Roff circles / d-offset lines, projection
stats constant `d`, `candidateTriangleCount = intersectionSegmentCount =
multipleSolutionCount = 0`, gtop2 certificate scope group 1/1, capability
gates unrelaxed (Extract/Bake available on the single-component mesh,
Design Patch stays `NOT_CLOSED` for open groups).

## Exclusions (fail closed, chord fallback or bounded error)

Surface / hybrid members, sloped or stepped sources, same-d/diff-Z and
diff-d mixed routes, arc×arc corners, extension/off-body joins, ambiguity
(multi-branch, contact-within-noise), over-search (`d > maxSearch` and
`|J-V| > maxSearch`), Roff collapse/inversion, curved closed groups,
tangent-collinear branches. Tight curves (small R at fixed d, inside
offsets on short arcs) are genuinely ambiguous — the engine reports
`FALLBACK_AMBIGUITY_B0`, never auto-picks.

## Evidence map

- `docs/evidence/phase20l2/baseline-fallback.json` — 16-fixture
  pre-dispatcher chord-path pins (byte-identical contract).
- `phase20l2-offset-radius-production-validation.md` — suites, robustness
  matrix, tolerance evidence, browser QA, gates.
- `phase20l2-offset-radius-production-performance.md` (+ `perf-output.txt`)
  — exact vs chord timings, no hard claims.
- `phase20l2-visual-qa.md` (+ `*.png`, `geometry.json`) — browser frames.
