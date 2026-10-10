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

## Risks / non-goals

- Cohesion-only extraction; zero runtime behavior delta (emit + digests
  prove it). No SCC fix claimed. No 241.11 work started.
- 14 pre-existing user stashes preserved in original order; clean tree
  except phase files; no config/fixture/permission changes.
