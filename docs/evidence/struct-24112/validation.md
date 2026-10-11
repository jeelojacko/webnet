# STRUCT-241.12 Validation — feature-line + design-surface command payload leaves

## Baseline

- Pinned main: `a7e14a6bf0affbd9ad63b8699d69fb643ade2017` (PR #254 merge,
  fetched + verified before branching).
- Preflight: clean worktree, 14 pre-existing stashes untouched (count + order
  preserved post-work), branch
  `refactor/issue24112-featureline-design-command-types` from verified main.
- Pre-change hub frozen at
  `/tmp/struct24112-baseline/cadTransactions.types.ts.baseline`.
- Old hub transpileModule(removeComments:true): `export {};` (10 bytes,
  SHA256 `2e29cd9a…c8d05`); post-splice hub emits byte-identical `export {};`;
  both new leaves emit inert `export {};`.

## Verbatim parity (parent-verified pre-splice)

- `diff hub:814-885 vs leaf-A union body`: identical except required `};`
  terminator. `diff hub:890-941 vs leaf-B union body`: identical except `};`.
- Double-key objects kept whole (FEATURELINE|FEATURELINECREATE,
  FEATURELINEELEV|FLSETZ); all JSDoc + section comments preserved.

## Test evidence (Worker C, all measured)

- NEW `tests/cad_featureline_design_command_type_leaves_24112.test.ts`:
  **79/79 pass** — 16/16 member AST/body/property-order/JSDoc/comment pins,
  both-directions `expectTypeOf` per variant (combined selectors for
  double-key objects + pinned `never` documenting single-literal Extract
  limits), 248/241/7 key SHA + ordered-list digest, emit pins, allowlisted
  type-only imports, 22 in-memory negative controls (never disk/git),
  scoped/full graph pins (30 s scoped-cold / 120 s full-cold / 30 s mutation
  targeted timeouts only).
- Guard roll-forward (pins retained, no skips): 24111 **58/58**,
  2411+2412 **76/76**, 2413-24110 all pass (729+103), 1952/1957/19511/
  19512/19514 + core-1952 **126/126**. Two extra-scope integrations fixed
  narrowly: 24110 model-leaf incident-edge allowlist (+ legitimate DS-leaf
  `CadSurfacePurpose` type edge); 1956 splice-order pin at ref granularity
  (order unchanged).
- Neighbours: 20A x7, 20B/20C x9, 20D x5, dispatch/persistence/registry x4 —
  **271+23 pass**.
- `npx tsc --noEmit` clean; `npm run lint` 0 errors (9 pre-existing warnings,
  unrelated files); `npm run check:portable-paths` 0 violations.
- `npm run build`: green (11.59 s).
- `npm run test:agent` (parent gate): **11056 passed | 1 skipped | 3 failed
  / 11060** — the 3 failures are the known-unrelated ignored private Study
  Desktop real-data fixtures
  (`study_ai_unit_calibration`, `study_ai_unit_calibration_v5`,
  `study_ai_unit_preflight`), identical to the 241.11 baseline; no new
  failures; private fixtures untouched.

## Review

- Independent read-only reviewer on exact integrated final diff (incl.
  negative controls): APPROVE, no findings (head 58425f97). PR #255 OPEN
  UNMERGED.
- Stash preservation: 14/14, order intact; worktree contains only the
  241.12 scope (hub + 2 leaves + 1 new + 15 rolled-forward tests).

## Risks (honest)

- Graph pins are version-sensitive by design: any concurrent main-side CAD
  type change will require re-measurement (fail-closed, not silent).
- `import type` on `cadFeatureLineCreate` (a runtime module) relies on
  continued type-only usage; the 24112 suite pins `hasOnlyTypeImports` +
  `runtimeImportSpecifiers` empty to catch regressions.
- 1956/24110 pins now reference the new leaf aliases; future extractions
  must roll them forward the same narrow way.
