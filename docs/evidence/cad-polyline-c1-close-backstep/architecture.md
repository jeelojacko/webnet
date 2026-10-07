# Phase C1 — PLINE Close + session backstep (architecture)

Branch `feat/cad-polyline-close-backstep-c1`, baseline `5aa6441` (main = PR
#175 B2 merge). Scope is additive: PLINE can now close its ring and the live
draft supports a session-local backstep. Schema-free — no version bump, no
migration, no new epsilon authority. No bulge/width/arc, no Z, no
line-chaining, right-click, or repeat.

## 1. Engine (schema-free `closed` flag)

- `src/engine/cad/cadTransactions.types.ts` — the `PLINE` command payload
  gains `closed?: boolean` (absent/false = open). No existing field changes.
- `src/engine/cad/cadPolylineGeometry.ts` (new, pure) —
  `CAD_POLYLINE_DEDUPE_EPSILON` (1e-9), `cadPolylinePointsMatch`,
  `sanitizeCadPolylineVertices` (adjacent dedupe then, closed only, strip a
  redundant final==first vertex, labels aligned), and
  `cadPolylineVerticesWrapToFirst` (true only when a closed ring's stored
  vertices still need the synthesized last→first edge — false for legacy
  rings that already repeat the first vertex, e.g. TRAVERSE).
- `src/engine/cad/cadTransactionsPolylineCommand.ts` — sanitizes through the
  shared law, requires >=2 retained vertices open / >=3 closed, persists
  `closed = command.closed === true`, and emits the truthful prompt
  (`PLINE committed with N vertices.` / `PLINE closed with N vertices.`). One
  entity, one undo entry, existing layer/selection behavior, existing name
  sequence unchanged. A closed ring never stores a duplicate closure vertex.

## 2. Session (UI law, no engine schema)

- `src/hooks/surveyCad/useSurveyCadPlineSession.ts` (new, pure + thin
  handler): `parsePlineSessionOption` (whole-token, case-insensitive
  `C`/`CLOSE`, `U`/`UNDO`/`BACKSTEP`; no `B` alias), `plineRetainedVertices`,
  `canClosePlineSession`, `backstepPlineSession`, `commitPlineSession`, and
  `handleSurveyCadPlineSubmit`.
- `src/hooks/surveyCad/useSurveyCadCommands.ts` — the PLINE branch runs at the
  top of `submitSessionInput`, before shape/sequence/curve/intersection/
  default point parsing, so a typed `C`/`U` is never stolen by a
  coordinate/bearing parser. It reads the live `sessionRef` value used by the
  dock single-buffer contract.
- `src/hooks/surveyCad/useSurveyCadCommandLifecycle.ts` — `finishPolylineSession`
  now delegates to `commitPlineSession(closed:false)`; empty Enter commits
  open only when 2+ retained vertices exist, otherwise the session stays
  active with a message. Escape cancels with zero mutation (unchanged).
- Prompt/help per count live in `useSurveyCadCommandText.ts` /
  `useSurveyCadCommandHelpText.ts` (Close is offered only at 3+ vertices).

## 3. Closed consumers (minimal, additive)

The closing edge becomes real for closed PLINEs through one shared predicate
plus the per-consumer wrap sites listed in `consumer-proof.md`. Closed PLINEs
are never converted to polygons; capture order is preserved; there is no
orientation normalization. Grips stay one-per-stored-vertex.

## 4. Deferred (explicit, out of scope)

Bulge/width/arc segments, schema or migration, Z, line-chaining, right-click
finish, command repeat, and closed-edge segmenting inside trim/extend/fillet
(those keep the existing open segment builder).
