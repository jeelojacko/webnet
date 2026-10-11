# STRUCT-241.10 Validation

Base: `68ff937cfa2d8c5c3b18bce1ed23b3a60880f2be`. Branch:
`refactor/issue24110-surface-model-style-type-leaves`. Final HEAD and PR
URL recorded at handoff (see PR body / final report).

## Ownership

- Worker A (`commandcode/deepseek/deepseek-v4.1-flash`):
  `cadSurfaceDefinitionTypes.ts` only (64 lines, 6/6, tsc clean, no other
  files touched).
- Worker B (`opencode-go/deepseek-v4.1-flash`):
  `cadSurfaceModelStyleTypes.ts` only (84 lines, 5/5, tsc clean, no other
  files touched).
- Parent: frozen baseline capture, hub splice (858 -> 756 lines), the
  100-test suite, all guard roll-forwards, TODO + these docs, review loop,
  commit/push/PR. No overlapping edits; integration after both handoffs.

## Commands / results (parent-run)

- `npx tsc --noEmit`: exit 0.
- `npm run lint`: 0 errors (9 pre-existing warnings elsewhere).
- `npm run check:portable-paths`: 6394 tracked paths, 0 violations.
- `npm run build`: clean, 13.67 s.
- New suite
  `tests/cad_surface_definition_model_style_type_leaves_24110.test.ts`:
  100/100 (11/11 bidirectional facade equality, AST shape/order pins,
  JSDoc parity, exhaustiveness incl. lost-re-export control, no hub
  duplicates, allowlisted type-only imports, 19/6 union orders,
  680B/sha37445357 hub emit + inert leaf emits, scoped/full graph pins
  with 30 s/120 s test-specific timeouts, 21 in-memory mutation
  controls — each proven to fail its pin).
- Rolled guards: 2412/2413/2414/2415/2416/2417/2418/2419 suites 763/763
  across the 9 leaf files; 19511/19512/19514 85/85.
- Surface neighbours (definition lifecycle/replay/roundtrip, domain,
  contours, explicit bake + oracles, compose, 18S edits + persist,
  20A feature-line breakline, 18W breakline/boundary edits): 179/179.
- `npm run test:agent`: run once before PR; known local-only
  Study Desktop private ignored real-data fixture failures
  (calibration, calibration_v5, preflight) may occur — fixtures and
  unrelated test logic untouched. Exact-head GitHub Actions is final.
- Known unrelated flake (for the record only): PR #251 first run
  `tests/cad_ribbon_controls.test.tsx:426` one-shot ribbon-scroll
  assertion failed, same-head rerun passed 5/5. No ribbon runtime/test
  touched here to mask anything; any new occurrence will be reported,
  not fixed in this phase.

## Graph truth (measured via `scripts/cadTypeImportGraph.mjs`)

- Scoped CAD+F2F before: 499/2450, VALUE/MIXED 1585/1567
  `0bc9bae1f87e81161f250fd5852730e56b9bdd1311b02257cdecf39dd4d2fcb7`,
  VALUE SCC 0, TYPE SCC 0.
- Scoped after: 501/2459 (+9 type edges per allowlist), digest
  identical, SCCs unchanged.
- Full src before: 1671/7561, VALUE/MIXED 4444/4385
  `415f97f0a1a662ca6523144106bec331fef305476eb34cd316df7c70f8972448`,
  VALUE SCC 0, TYPE 7/38.
- Full after: 1673/7570, digest identical, SCCs unchanged.

## Correction (same-phase, controller-found JSDoc parity miss)

Controller's independent GitHub review of PR #252 (exact-head run
38095955175, 5/5 green) confirmed 11/11 bodies exact but found ONE
documentary miss: the original hub section header
`/** Phase 18F: TIN surface model (engine only; never triangle entities). */`
(+ single blank line) immediately above `CadSurfacePointSource` was
replaced by the hub facade block and carried into neither leaf.
Root cause: the frozen worker baseline started at the type declaration
and the suite's JSDoc marker lists never contained that header string,
so no pin failed. Corrected on the same branch: header re-inserted
verbatim above the declaration in `cadSurfaceDefinitionTypes.ts`
(11/11 JSDoc parity now); suite strengthened to 103 tests with an exact
adjacency pin (`header + single empty line + export`) plus
change/delete in-memory negative controls on the SAME assertion.
Runtime emit unaffected (comments stripped): hub still 680 chars
sha37445357, both leaves `export {};`. No production, graph, or other
test changes. (The controller pushed the identical correction to this
branch in parallel as a2658bab; merged here without force-push and
de-duplicated to one pin set — leaf bytes were already identical.)

## Reviewer disposition

Independent read-only reviewer (fresh mission against the integrated
exact state): APPROVE (two rounds: initial APPROVE plus evidence-record
substantiation on request — 11/11 verbatim parity vs origin/main base
confirmed by direct comparison, trimmed hub emit 680 chars
sha37445357 + inert leaf emits inspected, scoped 501/2459 + full
1673/7570 with both VALUE digests unchanged and TYPE 7/38 inspected,
100-test suite + lost-re-export control traced, 2413 757-line +
2418/2419 facade + incoming-edge + 19511/512/514 +2/+9 roll-forwards
checked, 14 stashes in order, no ribbon/config/fixture/permission
changes; reviewer ran no tests itself — all validation parent-run, see
above).

## Controller acceptance correction

- Restored the exact historical Phase 18F section JSDoc immediately above `CadSurfacePointSource` in the definition leaf (the type body and all other eleven-contract parity remained unchanged).
- Added an explicit regression pin for the original comment plus a negative in-memory mutation that removes the comment and must fail the positive pin.
- This documentation/test-only correction does not change the hub or either leaf's emitted runtime JavaScript, dependency graphs, persisted schema or CAD behavior. The previous 5/5 CI success applied to the pre-correction head; a new exact-head CI run is required before merge.

## Exact-head CI graph-test timeout correction

- On commit `164694a70817171aa250a77593dee61ef6ddfbcb`, GitHub Actions run `38098784229` had classify/static/numerical/build-smoke SUCCESS, 10,887 tests passed, and only the legacy `tests/cad_geometry_primitives_runtime_cycle_19514.test.ts` mutation-control test timed out at Vitest's default 5 seconds while performing an in-memory cold dependency-graph rebuild. No graph assertion failure was reported.
- Controller applied a narrowly scoped 30-second per-test timeout to that single historical mutation test; all original graph/SCC assertions remain intact, with no global timeout change or runtime code change. New exact-head CI success is required before merge.

## Risks / non-goals

- Cohesion-only extraction; zero runtime behavior delta (emit + digests
  prove it). No SCC fix claimed. No 241.11 work started.
- 14 pre-existing user stashes preserved in original order; clean tree
  except phase files; no config/fixture/permission changes.
