# Phase 20P sparse-set geometry (study only, no `src/` changes)

Study rule under test: transitions occupy a strictly-increasing joint
subset T of an open collinear group. Joint stations S(j) = cumulative
member lengths. Set member at joint j owns the global-station interval
[S(j)−W/2, S(j)+W/2]. Consecutive SET members j<k separate iff
`W_j/2 + W_k/2 < S(k)−S(j)` (exact `<`, no epsilon). Whole-set
fail-closed; `TRANSITION_LINEAR_V1` unchanged; non-transition joints stay
native. Harness: `scripts/phase20pSparseTransitionSetStudy.ts` (calls
production exports directly); corpus: `corpus.json` (73 rows, sha256 in
`corpus.sha256`, double-regen byte-identical). All positive rows below
measure `topologyPreMeshEqualsMeasured: true`, gtop2 1/1, exact
revalidation null, C0 residuals 0, order-sensitive stable ggrev1.

## 1. Global-station rule sufficiency

One predicate covers skips of any span: separation is evaluated on
consecutive SET members, never on j/j+1. Measured: `sparse02-distance-left`
(stations [30,80], set gap 50, clusters [[0],[2]], 26v/24t);
`sparse024-*` ([0,2,4], gaps [50,50]); `sparse03-*` ([0,3], gap 74);
`sparse14-*` ([1,4], gap 76) — all families × both sides, 48 rows green.
Skipped joints tile as native stations (`nativeStations > 0` every row)
with zero C0 residual at transition/native boundaries.

## 2. Reduction to the 20N.1 rule for consecutive joints

When k = j+1, S(k)−S(j) is exactly the shared middle-member length, so the
set rule collapses to the production 20N.1 predicate bit-for-bit. Mixed
clusters prove both paths compose: `cluster0235-relative-elevation-right`
(clusters [[0],[2,3],[5]], paths [singular,group,singular], gaps
[50,22,52]) meshes 1/1/1; every cluster passes its honest production gate
(singular isolates via `selectGroupTransition` +
singular `deriveTransitionExpectation`; runs via `selectGroupTransitions`
+ set expectation + `deriveGroupTransitionExpectation`) before the joint
mesh. `cluster013-*` ([0,1,3]), `cluster023-*` ([0,2,3]),
`cluster0134-*` ([0,1,3,4], clusters [[0,1],[3,4]]) likewise green.

## 3. Near-touch / touch / overlap boundary

On the [0,2] base (S(2)−S(0) = 50): `sparse02-distance-near-touch`
(W=[46,52], half-sum 49 < 50) admits — 1 m native run, one region, green.
`sparse02-distance-exact-touch` (half-sum == 50) rejects
`TOUCHING_NOT_AUTHORIZED`; `sparse02-distance-overlap` rejects
`OVERLAP_REJECTED`. Exact `<` is the boundary; touching is not a tie, it
is a reject (shared boundaries need a tie-break that does not exist).

## 4. j-vs-j+2 shared-no-member-but-still-touch proof

Joints 0 and 2 share NO member, yet exact-touch still rejects: the
intervals [S(0)−W_0/2, S(0)+W_0/2] and [S(2)−W_2/2, S(2)+W_2/2] meet at one
station, so the merged strip would carry a zero-width pinch that is both
a transition endpoint and a native station — the 1/1/1 declaration cannot
survive it. The corpus pins this: the only difference between
`near-touch` (green) and `exact-touch` (reject) is 49 vs 50. Separation is
about intervals on the station axis, not about sharing a member.

## 5. Cluster byte-compatibility with 20N.1

Isolates route through the production singular path and consecutive runs
through the production group path with no sparse-specific math: the study
calls `selectGroupTransitions`, `deriveTransitionExpectation` (singular
and set forms), and `deriveGroupTransitionExpectation` per cluster and
requires each to accept before meshing. A sparse decision therefore adds
no new admission law — only the set-level order/separation gates
(forensics.md sites 2–5, 8, 12) plus the authoring hard-reject (site 14).

## 6. Transforms

Mirror (right-side rows), `translate-1e6`, `translate-1e8` stable;
`reversal` is a true traversal reversal (rebuilt member order, reversed
endpoint ids, reindexed joints, physical widths mapped, canonical order
re-emitted; ggrev1 legitimately differs, equality not required) — all
green with identical agreement/validator outcomes.

## 7. Document-and-omit

Skipped collinear-equal joints need no fixture (native by construction,
measured in every row). The honest ordinary analytic corner at a skipped
joint is OMITTED: bending a skipped joint leaves transition authority
entirely (no transition is claimed there) and belongs to the native
corner path, which this harness does not build. `neg-skipped-joint-needs-
transition` records the declaration (`native-corner/NATIVE_CORNER_OWNED`);
a sparse decision must state that deflected skips are native corners, not
set members. The remaining 20 negatives pin every fail-closed gate:
duplicates, out-of-order, malformed ids, touch/overlap, one-bad-among-
valid, zero/negative/NaN/Inf/just-over-max widths, stale refs, non-
collinear/mixed-family/grade-mismatch/sloped/Z-step/arc/closed/surface
joints — each rejects at the production code (`MEMBER_REF_STALE`,
`NON_COLLINEAR`, `FAMILY_MISMATCH`, `GRADE_MISMATCH`, `NON_FLAT`,
`JOINT_Z_STEP`, `NON_LINE`, `CLOSED`, `WIDTH_INVALID/INFEASIBLE`).

## Decision input

Geometry supports sparse sets under the global-station rule with zero new
law; the work is 5 fail-closed gates + the authoring gate. Corpus rows
above are the acceptance evidence; no production behavior is changed by
this study.
