# Run-status state matrix (Wave D)

Root cause: `FRESH_FAILED` conflated a real failed solve with a completed
non-deliverable run, so a successful pre-analysis showed report CONVERGED
while the toolbar said RUN FAILED. Fix: `FRESH_NOT_DELIVERABLE_MODE` split
out of `FRESH_FAILED`, only when `result.success && !deliverableMode`.
Single presentation source: `src/components/resultStatusPresentation.ts`.

| Scenario | integrity | Toolbar badge | Report STATUS | Export |
|---|---|---|---|---|
| Fresh production | `FRESH_SUCCESS` | ● Current (green) | CONVERGED (green) | ALLOW |
| Fresh pre-analysis / data-check / blunder | `FRESH_NOT_DELIVERABLE_MODE` | ◐ Planning only (amber) | PRE-ANALYSIS COMPLETE · PLANNING ONLY (amber) | BLOCK + diagnostic line |
| True failed solve / subtask error | `FRESH_FAILED` | ✖ Run failed (red) | NOT CONVERGED / WARNING | BLOCK + diagnostic line |
| Stale success | `STALE_SUCCESS` | ▲ Stale — re-run | CONVERGED (solve outcome) | BLOCK + stale line |
| Stale failure | `STALE_FAILED` | ▲ Stale — re-run | NOT CONVERGED / WARNING | BLOCK + stale line |

Gating untouched: `canUse*` / `decideExportVerdict` still require
`FRESH_SUCCESS`. Failed pre-analysis (`success=false`) stays `FRESH_FAILED`.
New state is never green/export-ready.

Tests: `tests/resultIntegrity/` 40+coverage incl. badge/summary tone agreement,
failed-pre-analysis stays failure, new-state export gating + status line.
