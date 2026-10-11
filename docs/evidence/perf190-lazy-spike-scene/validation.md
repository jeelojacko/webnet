# PERF-190 — Lazy CAD spike scene derivation: validation

- Baseline `origin/main ff9849ef`; branch `fix/perf190-lazy-spike-scene` HEAD `ff9849ef` + worktree (uncommitted at write time).
- Independent review: **APPROVE** (reviewer, current diff; noted 1k/10k sample timings not independently verified — repeated below as worker-measured, no speedup gate claimed).
- Stashes: 14 present, order unchanged (see final report). Ignored private fixtures / `.pi/lsp.json` untouched.

## Call-count facts (measured, deterministic counters — not wall-clock)

New suite `tests/cad_spike_scene_laziness_perf190.test.tsx` wraps the real adapter via
`vi.mock` counter and drives the real hook (`react-dom/client` + `act`):
1. Mount exposes own `mlightcadScene` property; count **0**; reading `cadProject` /
   `displayScene` / `selectedEntities` keeps count **0**.
2. First read → count **1**; result `toEqual`s direct `buildMlightcadSpikeScene(project)`;
   layer order, entity `objectId` order, `extents === project.bounds` asserted.
3. Repeat reads → same reference, count stays **1**.
4. Selection re-render → cached reference kept, count **1**; new immutable project identity →
   still lazy (count **1**) until read, then exactly **1** rebuild with new contents.
5. StrictMode mount builds **0**; first read builds **1**, repeat same ref. Unmount/remount:
   no eager build; new mount rebuilds only on read (no global cache).
6. Negative control: inline eager `useMemo` probe increments on mount with no read, and the
   lazy `expect(count).toBe(0)` assertion throws against it — proves assertions load-bearing.
7. Spies restored in `afterEach`; roots unmounted; no disk/network/wallclock/git dependence.

Old eager code path: 1 build per project identity with zero reads (by construction —
`useMemo` ran on every `cadProject` change). New code: 0 builds with zero reads.
Model over 20 distinct identities in the production shell (never reads scene):
old **20 builds**, new **0 builds**; with 3 reads/identity, new builds exactly 20 (one per
identity, no repeat-read rebuilds).

## Sampled build cost (worker-measured, noisy JIT, honest min/median — NOT a gate)

`performance.now()`, 5 runs each, temporary script (deleted):
- 1k entities: `[1.03, 1.39, 0.14, 0.14, 0.13] ms` → min 0.13, median 0.14.
- 10k entities: `[1.24, 1.57, 1.54, 0.21, 0.71] ms` → min 0.21, median 1.24.
Claim limited to: zero-consumer builds eliminated; per-build cost above is what is no longer
paid on commit/render. No fake threshold, no CI timing gate.

## Test runs (worker + parent re-verified focused suite)

- `npx vitest run tests/cad_spike_scene_laziness_perf190.test.tsx` → **7 passed** (parent re-ran: 7/7).
- Adapter parity: `cad_spike_model` + `cad_persistence_and_entities` + `cad_circle_consumer_v1` +
  `cad_parabola_entity_b1` → **59 passed**.
- Extra workspace integrations: `landxml_import_undo_history_18m`, `cad_surface_revision_cache_185`,
  `cad_viewport_filter_root_186` → **10 passed**.
- `tests/test_tier_manifest.test.ts` → **11 passed** (new test stays agent tier, no manifest change).
- `npx tsc --noEmit` → clean. `npx eslint` on both touched files → clean.
- `npm run check:portable-paths` → 6430 paths, 0 violations.
- Pre-PR: `npm run test:agent` + `npm run build` — see PR checks / final report for exact results.

## Risks / residual

- A future `...cadWorkspace` spread / `JSON.stringify(cadWorkspace)` would force one eager
  read; none exists today (grep-verified). Future authors should read `mlightcadScene`
  directly rather than spreading the result.
- Sampled ms timings are environment-noisy; call-count elimination is the durable claim.
- Exact-head CI (5 jobs) is the merge gate; controller merges.
