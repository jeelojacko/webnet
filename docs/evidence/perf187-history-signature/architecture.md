# PERF-187 — Architecture: eliminate redundant full-project canonical serialization in CAD history adoption

Base: `origin/main` `897ba8865fd53d92087a5ef1b89cebb721bdb954` (PERF-190 PR #260 merge).
Branch: `perf/issue187-cad-history-canonical-comparison`. Issue: #187 (`Refs` only).

## Problem

`useSurveyCadWorkspaceHistory` (`src/hooks/surveyCad/useSurveyCadWorkspaceHistory.ts`,
76 lines) adopted authoritative external projects with:

```ts
if (buildStableCadProjectSignature(history.present.project)
    === buildStableCadProjectSignature(baseProject)) return;
```

`buildStableCadProjectSignature` (`src/engine/cad/cadProjectState.ts`) is
`JSON.stringify(canonicalizeSignatureValue(project))`, where canonicalization
recursively rebuilds every object with sorted keys. Every effect run on a new
`baseProject` identity — including the workspace's OWN drawing-sync clone
after each commit — paid **two complete canonical traversals + two deep-copy
allocations + two `JSON.stringify` serializations**. The initial mount paid
the same two serializations even though `history.present.project` IS the
identical reference. Measured baseline (React harness probe): mount = 2
stable-signature calls; blank-project signatures = 15,013 B each side.

The comparison MUST stay key-order-insensitive: the parent sync clones via
`cloneCadDrawingDocument`, which normalizes key order (e.g. imported-TIN
surface definitions, Phase 18M precedent). Raw `JSON.stringify` or reference
comparison would mistake the clone for an external edit, reset history, and
disable undo/redo right after import.

## Design: raw-JSON fast path + oracle fallback (`areCadProjectsCanonicallyEqual`)

New pure helper in `src/engine/cad/cadProjectState.ts` (same file, no new
module edges — graph-neutral); `buildStableCadProjectSignature` is unchanged
and still exported for existing consumers/tests. The hook now runs:

```ts
if (history.present.project === baseProject) return;                    // mount / same ref: zero cost
if (areCadProjectsCanonicallyEqual(history.present.project, baseProject)) return;
```

The helper, after the same-reference and non-object guards, compares two
plain native `JSON.stringify` outputs. Raw-equal implies canon-equal:
identical raw output denotes identical observable JSON structure (key order
included), over which canonicalization is deterministic — so the common
order-preserved drawing-sync clone (verified raw-equal on real projects)
skips the canonical traversal entirely. Raw-differing inputs (key-order-
normalized TIN clones, genuine external edits) and any `JSON.stringify`
throw (cycles, bigint, traps) fall back to the ORIGINAL double-serializer
comparison, first-then-second, preserving exact oracle behavior including
throw parity.

Prior revisions of this phase tried an allocation-light JS structural walk
(domain scan + recursive compare); controller synthetic V8 plus real-CAD
measurement showed it at parity-or-slower than the serializer it replaced
(reflection per key costs more than native serialization), so it was deleted
(~300 lines removed; file back to ~307 lines). The raw filter is the only
construct that measured faster, because real `cloneCadProject` preserves key
order on the common path.

SAFETY DIRECTION (for inert data): on JSON/engine-clone-producible inputs
(the only shapes that reach the hook in production) the raw path can only
err toward `true` (keep history, never wipe); `false` comes exclusively from
the exact oracle fallback, so no inert input can cause a spurious history
wipe beyond what the oracle itself orders. Documented exclusions (all
production-impossible — `JSON.parse`/engine clones yield only plain data;
zero non-plain arrays on a real 10k-entity project):
`Array`-subclass/`Symbol.species` shapes (K1 pins helper-true vs oracle-false,
G2 precedent — safe direction only), identity-sensitive exotic `toJSON`,
consistently-lying proxy traps, and STATEFUL accessors (L1 pins
helper-false vs oracle-true: the raw pass plus the fallback re-read a getter
the oracle reads exactly once, so multi-pass reads can advance getter state
and disagree in either direction). `false`-direction parity with the oracle
is total for inert data only.

## Cost model (honest, measured on real CAD projects in-repo)

- Same reference (mount, repeated renders): **0 traversals** (was 2 full
  serializations; median 0.00 ms).
- Common order-preserved sync clone: **two native `JSON.stringify` calls,
  zero canonical rebuild** — 10k entities: 22.55 ms → 5.73 ms (~3.9x);
  1k: ~4x (ratio 0.25). No canonical deep-copy objects; the only large
  allocations are the two raw JSON strings themselves (old path: two
  canonical trees + two strings + string compare). NOT zero-allocation.
- Rare key-reordered (TIN) clone: raw pair wasted + full oracle fallback —
  10k: 21.30 ms → 28.73 ms (~1.35x slower than old on that branch).
- Rare genuine external change: same shape — 23.16 ms → 28.93 ms (~1.25x).
- Exotic/throwing inputs: raw attempt (up to two stringify calls, possibly
  partial when serialization throws) + full oracle fallback (unreachable in
  production; fail-closed, never for speed).

## Scope and non-goals

- Changed: `src/engine/cad/cadProjectState.ts` (net small; ~307 total after
  deleting the superseded structural walk; same-file placement required for
  graph neutrality), `src/hooks/surveyCad/useSurveyCadWorkspaceHistory.ts`
  (comparison predicate + comment only; hook order, deps `[baseProject,
  resetKey]`, resetKey guard, selection semantics, ref publication untouched).
- Added: `tests/cad_history_stable_signature_perf187.test.tsx` (43 tests).
- Untouched: persistence hook (still noncanonical `buildCadProjectSignature`
  — separate PERF-188 clone issue, out of scope), CAD engine/numerics,
  serialization, DOM, commands.
- Graph: CAD+F2F 513 nodes / 2486 edges, VALUE SCC 0, TYPE SCC 0; full src
  1685 / 7597 — all identical to the pinned base (module-level import target
  unchanged, so zero edge delta).
