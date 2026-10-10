# STRUCT-195.6 — Validation evidence (Workstream C: tests + evidence)

## Focused suite

File: `tests/cad_grading_command_types_1956.test.ts` (23 tests across
9 `describe` blocks; conventions follow
`tests/cad_profile_section_command_types_1955.test.ts`: per-key `Extract`
equivalence, key sets/order, type-only AST pins, graph back-edge check,
hand-transcribed `Base*` baseline pins compared against BOTH hub and leaf
`Extract`s, negative controls run transiently then restored).

Command run by Workstream C:

```sh
node scripts/runVitest.mjs run --config vitest.agent.config.ts \
  tests/cad_grading_command_types_1956.test.ts
```

Result at time of writing (leaves present as untracked Worker A/B files,
parent hub splice NOT yet landed):

- **21 passed, 2 failed** — the only failures are the two hub-splice-order
  tests (`SURFACE_ADD_FEATURE_LINE_BREAKLINE -> CadGradingCommandPayload ->
  CadGradingGroupCommandPayload -> SURFPURPOSE` and “no inline grading key
  behind”), which assert the POST-integration hub. The hub still carries the
  19 inline variants, so these fail until the parent lands the splice. Every
  leaf-side assertion (key sets/order, per-key `Extract` equivalence,
  `Base*` pins, runtime AST property shapes, samples, type-only guards,
  graph back-edge) passes against the landed leaves.
- Expected post-integration result: **23/23 pass** with no test change
  (the type-level assertions resolve identically through alias refs; the
  hub-order tests were written for the spliced union).

## Post-splice update (parent-measured, hub integration landed green)

Parent reports, recorded here as parent-measured (Workstream C did NOT
re-run these; the AFTER graph figures in `architecture.md` are the only
parent figures Workstream C independently re-verified):

- Focused suite: **23/23 green** post-splice, no test change.
- `typecheck` exit 0; `eslint` on hub + both leaves + the Workstream C
  test exit 0.
- Hub esbuild emit byte-identical vs base.
- `check:portable-paths`: 6305 tracked / 0 violations.
- `build` clean, 14.36 s.
- Neighbours green: grading/group commands **65/65 across 4 files**
  (incl. this suite + the 195.5 suite); persist/course/distance/criteria/
  transitions **67/67 across 5 files**; compute/edit-flows/roundtrip
  **31/31 across 3 files**.
- `test:agent`: 1034 files passed + 3 failed files (all study-desktop
  real-data: calibration, calibration_v5, preflight — zero
  cadTransactions imports, known non-CI gitignored-state failures, same
  category as 195.5) / 9863 pass + 1 skip; 14 stashes preserved.
- No Playwright run yet — noted as pending/optional per the types-only
  scope (with exact-head CI authoritative as always).

## Typecheck / lint actually run by Workstream C

- `npx tsc --noEmit` → **exit 0, no errors**. This enforces every
  `expectTypeOf` in the suite (19 per-key hub↔leaf equivalences, 38
  `Base*` bidirectional pins, slice-union checks, optionality/nullability/
  readonly/literal probes) against the real leaves.
- `npx eslint tests/cad_grading_command_types_1956.test.ts` → **exit 0**.

## Negative controls (transient, restored)

Two mutations were applied to the Workstream C test file only, re-run,
then restored byte-identical (`diff` confirmed identical):

1. Swapped `GRADING_DELETE` / `GRADING_EDIT_CRITERIA` in
   `EXPECTED_GRADING_KEYS` → suite failed (5 failed / 18 passed),
   proving key-order sensitivity.
2. Dropped `| null` from the transcribed `GRADING_EDIT_CRITERIA`
   `targetSurfaceId` property shape → the runtime AST pin failed with
   “GRADING_EDIT_CRITERIA property drift” (3 failed / 20 passed),
   proving nullability-drift sensitivity without a typecheck gate.

(The 2 hub-splice failures appear in both control runs as pre-existing,
integration-blocked baselines — not caused by the mutations.)

## Remaining pending (NOT measured by anyone in this workstream)

- Playwright run (pending/optional per the types-only scope, per parent).
- Exact-head CI (authoritative as always).
- Graph AFTER figures are now recorded (parent-measured, C re-verified —
  see `architecture.md`); no further graph work is owed.

## Workstream C file inventory

Owned files only — no other file touched:

- `tests/cad_grading_command_types_1956.test.ts` (new)
- `docs/evidence/struct-1956/architecture.md` (new)
- `docs/evidence/struct-1956/validation.md` (this file, new)
