# STRUCT-241.14 Validation — primitive-draw + basic-curve command payload leaves

## Baseline

- Pinned main: `cce6ab288d1ce67fbcb4104b27be6cdb05914ce6` (PR #256 merge,
  fetched + verified before branching).
- Preflight: clean worktree, 14 pre-existing stashes preserved (count +
  order), branch `refactor/issue24114-primitive-curve-command-type-leaves`
  from verified main, fast-forward only, no force.
- Old hub transpileModule(ESNext, removeComments:true): `export {};`
  (trimmed; SHA256 `2e29cd9a…c8d05`); post-splice hub emits byte-identical
  output; both new leaves emit inert `export {};`.

## Verbatim parity (parent-verified pre-splice)

- `diff baseline hub:365-450 vs primitive leaf union body`: identical except
  the trailing `;` on the new alias (body SHA `20baf238…` both sides).
  `diff baseline hub:479-514 vs curve leaf union body`: identical (body SHA
  `9e6b3e38…` both sides).
- All 19 single-keyed; property order, `?` optionality, nested shapes, and
  JSDoc preserved verbatim (LINE_CREATE_BATCH `createdBy` JSDoc; PLINE
  closed-wrap + signed-bulge + centered-band-width JSDoc). TRAVERSE and
  BATCH_COGO untouched inline; no double-key feature-line objects moved;
  CurveF1 aliases and BEST_FIT key literals untouched. No section headers
  above either run; none invented.

## Test evidence

- NEW `tests/cad_primitive_basic_curve_command_type_leaves_24114.test.ts`:
  **65/65 pass** — 13+6 member AST/body/property-order pins,
  both-directions `expectTypeOf Extract<CadCommand>` per variant (plain
  single-literal selectors) + hand-transcribed `Base*` baselines,
  required/optional/literal-union precision pins (polygon mode, PLINE
  closed?/segmentGeometry?/segmentWidths?, ARC_CREATE metadata?/definition,
  best-fit `sourceEntityId?`, TANGENT_CURVE radius), JSDoc verbatim pins,
  248/241/7 key SHA + ordered-list digest + splice sentinels (ERASE->ref->
  TRAVERSE; BATCH_COGO->ref->alignment alias), top-level 72 (32/33/7) +
  exact 168 flattened order, emit pins, allowlisted type-only imports (leaf
  A exactly 2 specifiers, leaf B none; hub exactly 2 leaf imports, tangent
  + polyline hub edges retired, `cadTypes` barrel kept), 23 in-memory
  negative controls through the same positive pin functions (never
  disk/git), scoped/full graph pins (30 s scoped-cold / 120 s full-cold /
  30 s mutation timeouts only).
- Guard roll-forward (pins retained, no skips/weakening): 2411 (40),
  2412 (36), 24111 (58), 24112 (79), 24113 (60) — top-level 89->72
  (inline 51->32, refs 31->33), flatten helpers learn both aliases (flat
  stays 168), 24113 TANGENT_CURVE anchors re-pointed at the basic-curve
  ref; 2413-24110 + 19511/19512/19514 count pins 507->509 / 2475->2478 /
  1679->1681 / 7586->7589 (VALUE digests + SCC pins untouched); 2413/2414
  inbound allowlists gain the primitive-leaf edge; 19511/19512/19514
  cumulative +2/+3 consts. Combined re-runs: 5 files 273/273, 11 files
  815/815.
- Neighbours (drawing/geometry/dispatch/persistence): shapes, circle
  transactions/construction/tangent/2p3p, polyline close, best-fit
  line/arc/parabola + commands, curves-F1 sessions, command-history 01,
  persistence+entities — **223/223 pass** (13 files).
- `npx tsc --noEmit` clean (exit 0); `npm run lint` 0 errors (9
  pre-existing warnings, unrelated files); `npm run check:portable-paths`
  0 violations (6415 paths).
- `npm run build`: green (12.00 s).
- `npm run test:agent` (parent gate): **11181 passed | 1 skipped | 3 failed
  / 11185** — the 3 failures are the known-unrelated ignored private Study
  Desktop real-data fixtures (`study_ai_unit_calibration`,
  `study_ai_unit_calibration_v5`, `study_ai_unit_preflight`), same trio as
  prior phases; no new failures; private fixtures untouched.

## Review

- Independent read-only reviewer on exact integrated final diff (incl.
  negative controls): PENDING — must return explicit APPROVE, else correct
  + re-review in same conversation.
- Stash preservation: 14/14, order intact; worktree contains only the
  241.14 scope (hub + 2 leaves + 1 new + 15 rolled-forward tests + TODO +
  2 evidence docs).

## Risks (honest)

- Graph pins are version-sensitive by design: any concurrent main-side CAD
  type change requires re-measurement (fail-closed, not silent).
- The primitive leaf's `import type` on the tangent-solver runtime module
  relies on continued type-only usage; the 24114 suite pins
  `hasOnlyTypeImports` + empty runtime specifiers, and the hub-pins assert
  no hub->tangent edge remains.
- Flatten/count pins across 2411/2412/24111/24112/24113 now reference both
  new aliases; future extractions must roll them forward the same narrow
  way. Exact-head CI (classify/static/numerical/tests/build-smoke) is the
  controller merge gate.
