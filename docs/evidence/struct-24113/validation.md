# STRUCT-241.13 Validation — alignment + parcel-construction command payload leaves

## Baseline

- Pinned main: `49d945053c30834bc0e83301241ce04ec202bc1d` (PR #255 merge,
  fetched + verified before branching).
- Preflight: clean worktree, 14 pre-existing stashes untouched (count + order
  preserved post-work), branch
  `refactor/issue24113-alignment-parcel-construction-command-types` from
  verified main.
- Pre-change hub frozen at
  `/tmp/struct24113-baseline/cadTransactions.types.ts.baseline`
  (SHA256 `a8d52d04ffbf81ca56d99b62d197756172f2c32fd62d3e386fd5df34b80d78f8`).
- Old hub transpileModule(removeComments:true): `export {};` (trimmed;
  SHA256 `2e29cd9a…c8d05`); post-splice hub emits byte-identical output;
  both new leaves emit inert `export {};`.

## Verbatim parity (parent-verified pre-splice)

- `diff baseline hub:512-549 vs alignment leaf union body`: identical except
  the leading 2-space indent of the first `| {` (union-continuation
  position). `diff baseline hub:550-613 vs parcel leaf union body`: same.
- All single-keyed (no double-key objects); `| null` frontage fields,
  `'start' | 'end'` / `'slide' | 'swing'` unions, `settings:
  CadParcelLayoutSettings` requiredness all preserved. No Phase header above
  the runs; none invented (pinned: leaves contain no `// Phase`; hub splice
  region contains no comments).

## Test evidence

- NEW `tests/cad_alignment_parcel_construction_command_type_leaves_24113.test.ts`:
  **60/60 pass** — 6+9 member AST/body/property-order pins (zero member
  comments on both sides), both-directions `expectTypeOf` per variant (plain
  single-literal selectors; whole-union equivalence; `never` probes),
  required/optional/`| null`/literal-union precision pins, 248/241/7 key SHA
  + ordered-list digest + key-run positions, 89 top-level (51/31/7) +
  re-inline math (89+6+9-2=102) + exact 168 flattened order (TANGENT_CURVE
  @23 … SURVEYTABLE_EDIT @53) + seven Parcel* refs + table order, emit pins,
  allowlisted type-only imports, 22 in-memory negative controls (never
  disk/git), scoped/full graph pins (30 s scoped-cold / 120 s full-cold /
  30 s mutation timeouts only).
- Guard roll-forward (pins retained, no skips): 24111 **58/58**,
  2411+2412 **76/76** (verified in combined run: 8 files 358/358 with 24112
  + new suite + 19511/19512/19514), 2413-24110 + 19513/1957/1954 all pass
  (11 files 798/798), 2417 layout-leaf inbound allowlist +1 legitimate
  parcel-leaf type edge, 19511/19512/19514 cumulative +2/+5 consts.
  Total guard sweep: 15 files rolled forward narrowly (flatten helpers learn
  the two new aliases; count pins 102->89 / 66->51 / 29->31, 505->507 /
  2470->2475, 1677->1679 / 7581->7586; VALUE digests + TYPE 7/38 + key SHAs
  untouched).
- Neighbours: parcel command payload, cogo-parcel runtime, layout/grip-snap
  + linear-design leaves, landxml alignments, curved splits, network,
  shared-edit, command-history 03/06 — **258/258 pass** (9 files).
- `npx tsc --noEmit` clean (exit 0); `npm run lint` 0 errors (9 pre-existing
  warnings, unrelated files); `npm run check:portable-paths` 0 violations
  (6410 paths).
- `npm run build`: green (11.80 s).
- `npm run test:agent` (parent gate): **11116 passed | 1 skipped | 3 failed
  / 11120** — the 3 failures are the known-unrelated ignored private Study
  Desktop real-data fixtures (`study_ai_unit_calibration`,
  `study_ai_unit_calibration_v5`, `study_ai_unit_preflight`), identical to
  the 241.12 baseline; no new failures; private fixtures untouched.
  (+60 vs 241.12 = the new suite.)

## Review

- Independent read-only reviewer on exact integrated final diff (incl.
  negative controls): PENDING — must APPROVE before handoff.
- Stash preservation: 14/14, order intact; worktree contains only the
  241.13 scope (hub + 2 leaves + 1 new + 15 rolled-forward tests + 2
  evidence docs).

## Risks (honest)

- Graph pins are version-sensitive by design: any concurrent main-side CAD
  type change will require re-measurement (fail-closed, not silent).
- The parcel leaf's `import type` on `./cadParcelLayoutTypes` relies on
  continued type-only usage; the 24113 suite pins `hasOnlyTypeImports` +
  `runtimeImportSpecifiers` empty to catch regressions. The 2417 suite pins
  the new inbound edge to the layout leaf.
- 24111/2411/2412/24112 flatten pins now reference the two new leaf
  aliases; future extractions must roll them forward the same narrow way.
