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

## Design: two-phase canonical equality (`areCadProjectsCanonicallyEqual`)

New pure helper in `src/engine/cad/cadProjectState.ts` (same file, no new
module edges — graph-neutral); `buildStableCadProjectSignature` is unchanged
and still exported for existing consumers/tests. The hook now runs:

```ts
if (history.present.project === baseProject) return;                    // mount / same ref: zero cost
if (areCadProjectsCanonicallyEqual(history.present.project, baseProject)) return;
```

- **Phase 1 — domain walk** (`isPlainJsonDomainValue`, split into
  array/object helpers): one cheap full walk per side proving plain-JSON
  domain membership BEFORE any mismatch may be reported (traversal-order
  independence). Exotic = bigint, non-plain prototype (plain `Array.prototype`
  required for arrays), own `__proto__`, function-valued `toJSON`, accessor
  (`get`/`set`) descriptors detected via `getOwnPropertyDescriptor` without
  invocation, overridden/non-native `Array.prototype.map`, ancestor-stack
  cycles. Arrays are visited by index only (extra props are invisible to both
  the canonicalizer and JSON); function objects are never recursed into.
  Either side exotic → fall back to the ORIGINAL double-serializer comparison
  (exact oracle behavior, including throw parity).
- **Phase 2 — comparison** (`canonicalValuesEqual`): simultaneous walk with
  early exit, mirroring `JSON.stringify` value semantics (object
  undefined/function/symbol keys dropped, array holes/slots → null,
  NaN/±Infinity → null, −0 = 0, sorted-key order). Internal fallbacks remain
  as unreachable defense-in-depth. Primitive/null identity short-circuits;
  shared OBJECT references compare structurally so shared cycles still reach
  fallback.
- **Contracts (narrowed, reviewer-agreed):** identical top-level references
  return `true` without consulting the serializer (safe: never an external
  update; throwing would crash render). Cyclic graphs are outside the domain
  (no production path delivers one — every producer is JSON-serializable /
  deep-cloned). Consistently-lying proxy traps are indistinguishable without
  serializing and are likewise outside the domain. A residual
  own-`constructor`-species array shape is named non-blocking (unreachable
  through JSON.parse/engine-clone boundaries; guarding it would tax every
  array).

## Cost model (honest)

- Same reference (mount, repeated renders): **0 traversals** (was 2 full
  serializations).
- Distinct plain-JSON refs (self-sync clones, external edits): one cheap
  domain walk per side + one comparison walk, **0 allocations, 0
  `JSON.stringify`, 0 serialized bytes** (was 2 canonical rebuilds + 2
  stringify + string compare). This is NOT sublinear for differing documents:
  the domain walk always visits the whole tree; only Phase 2 exits early.
- Exotic inputs: original double-serialization cost (unreachable in
  production; fail-closed for safety, never for speed).

## Scope and non-goals

- Changed: `src/engine/cad/cadProjectState.ts` (+348, ≈565 total, under the
  600-line warning threshold; same-file placement required for graph
  neutrality), `src/hooks/surveyCad/useSurveyCadWorkspaceHistory.ts`
  (comparison predicate + comment only; hook order, deps `[baseProject,
  resetKey]`, resetKey guard, selection semantics, ref publication untouched).
- Added: `tests/cad_history_stable_signature_perf187.test.tsx` (39 tests).
- Untouched: persistence hook (still noncanonical `buildCadProjectSignature`
  — separate PERF-188 clone issue, out of scope), CAD engine/numerics,
  serialization, DOM, commands.
- Graph: CAD+F2F 513 nodes / 2486 edges, VALUE SCC 0, TYPE SCC 0; full src
  1685 / 7597 — all identical to the pinned base (module-level import target
  unchanged, so zero edge delta).
