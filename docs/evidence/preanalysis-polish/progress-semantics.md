# Progress semantics (Waves B/C)

## Old cause of 58 → 76
`emitProgress` in `src/engine/runSessionSolver.ts` used `Math.max(hint, solveIndex)`:
a per-call hint clamped against a global solve counter. Threshold-planning
solves incremented the global counter past the per-call hint, so the
denominator grew mid-stage (58 → 76). The label `solve n/m` also implied
nonlinear solver iterations; the units are actually planning solves/checks.

## Final semantics
- Exact planning-work count is genuinely unknowable upfront (greedy threshold
  loop in `preanalysisPlanningThresholdPlan.ts` exits early on data).
- Planning phase is therefore an indeterminate subphase: stable label
  `Preanalysis planning`, run-local `planningCheckIndex` counter, count-only
  display. Toolbar shows `· Planning checks N` during `preanalysis-impact`.
- `emitProgress` keeps a `Math.min` clamp: monotonic, no overrun. Counters are
  per-stage (`stageProgressCounts`; `solveCore` uses
  `meta.progressIndex ?? stageCompleted + 1`), so one stage's work can never
  saturate another stage's display. Auto-adjust trials are indeterminate
  (`autoAdjustTrialIndex` for both index and hint → n/n, `Auto-adjust
  checks N`), mirroring planning, because the trial count is data-dependent
  (`runSession.ts`).
- Every non-planning stage holds one immutable denominator for the run.
- `stageId` plumbed worker protocol → handler → `useAdjustmentRunner`; all
  resets null it. Cancellation/reset starts a clean counter.

## Tests
`tests/runSessionPlanningProgress.test.ts` 3/3: no overrun, immutable
denominators, stable label + monotonic count, run-local reset,
main → planning → finalizing completion.
- Review follow-up: per-stage counters + indeterminate auto-adjust; main-solve
  restarts at 1/1 and suspect-impact opens at 1/N instead of inheriting the
  global count (`tests/runSessionPlanningProgress.test.ts` 4/4).
