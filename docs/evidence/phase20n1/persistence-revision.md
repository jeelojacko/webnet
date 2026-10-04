# Phase 20N.1 — Persistence revision: per-joint intents under one ggrev1

- **Per-joint SET/CLEAR**: `GROUP_SET_TRANSITION` stages (or re-stages,
  replacing width) one joint intent; `GROUP_CLEAR_TRANSITION` carries a
  `jointId` and clears exactly one joint, leaving the rest intact (Flow F).
- **Canonical order**: stored intents are kept in canonical joint order;
  save/reopen preserves the array order (Flow E).
- **One revision over all intents**: `ggrev1` covers the whole transition
  array — any drift (edited width, restated members, moved revision)
  invalidates the group together, never per-leg.
- **Evidence remains evidence**: load sanitation never coerces endpoint scalars or
  repairs malformed optional provenance. If present, provenance identity,
  width, law, side, member pair, and recorded revision must match the intent
  and current revision; malformed or stale evidence rejects the whole solve.
- **Undo/redo round-trip**: the transition array participates in undo/redo
  as a unit (Flow J); redo restores the exact staged set.
- **Removal semantics**: removing one transition of a pair leaves the other
  staged, but the uncovered joint has no solution ⇒ solve fails closed with
  `CORNER_NO_SOLUTION` (no silent single-transition fallback).

## What this is not

- **20N study**: the study's honest split was "proven vs proposed" for
  persistence; 20N.1 proves it (Flow E + Flow J + unit persistence suites).
- **Candidate B**: unchanged — non-collinear intents are never persisted as
  admitted (authoring rejects them first).
- **Narrowing**: re-stage replaces width (Update label, no duplicates) was
  a Wave H authoring decision; the revision still treats the array as one
  unit.
