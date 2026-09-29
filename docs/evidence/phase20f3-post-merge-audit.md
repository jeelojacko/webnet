# Phase 20F.3 post-merge audit

## Grading-group shell command truthfulness (Worker A)

Pre-fix reproduction (registry path, CURRENT group selected):
`isShellCommandAvailable(GRADINGGROUPCALC)` → `true` (gated on
`runGradingGroupCommand` presence only, snapshot never forwarded);
`executeShellCommand` → `false` with zero spy calls (adapter resolved only
`options.groupId`, which the ribbon/registry never supplies). Enabled ribbon
button, silent no-op dispatch. No-args `GRADEGROUP` had the same shape:
available `true`, execute `false`.

Fix (`cadGradingGroupShell.ts`, `cadCommandRegistry.ts`):
shared `resolveGradingGroupRow` — valid explicit `options.groupId`, else
snapshot `selectedGroupId`, each verified against
`snapshot.gradingGroups.groups`; otherwise fail closed (never first-row /
feature-line / name / cached-manager guess). Snapshot-less explicit ids stay
a passthrough for direct callers only (service fail-closes); dumb chrome
always carries a snapshot so its gates are row-verified.
CALC gates on `row.calculable` (BUILDING / broken-ref / source-not-current
closed; UNBUILT / NEEDS_RECALC / FAILED retry; already-CURRENT dispatches,
service answers "already current"). Extract/Bake gate on `row.exportable`.
No-args `GRADEGROUP` opens the manager definition tab (the one creation UI).
Manager opens with the resolved id; Inquiry/Criteria fail closed without a
resolvable selection (their tabs render nothing without one).

Validation: `tests/cad_grading_group_shell_20f3.test.tsx` (20 tests, central
registry path) + updated `cad_grading_group_ui_20c` / `commands_20c`
assertions; typecheck, eslint, and 54/54 focused tests pass.
Standalone grading adapter untouched.
