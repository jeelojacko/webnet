# STRUCT-194.6 — validation

Branch: `refactor/issue194-cad-compose-surface-pick-extraction`
Baseline: `2394060ad68cad11c9a13c30780a8e7dd7eb2f9b` (exact origin/main).
Committed and pushed to the phase branch (no PR; parent owns PR creation). No
branch switch, no stash mutation; 14 stashes preserved.

## Static checks

| Check | Command | Result |
| --- | --- | --- |
| LSP diagnostics | every new + edited file | clean |
| Production build | `npm run build` | clean, `✓ built in 11.96s` |
| Worker chunk | `ls dist/assets | grep -i surfaceWorker` | one chunk `surfaceWorker-YQANEhD9.js` (same hash as 194.4/194.5) |
| Portable paths | `npm run check:portable-paths` | 6233 tracked paths, 0 violations |

Lint/typecheck at commit are owned by Husky and were not run manually here.

## New focused suites

| Suite | Result | What it pins |
| --- | --- | --- |
| `tests/cad_compose_lifecycle_1946.test.tsx` | **10/10** | pending-mode ref stable across unrelated rerenders; fresh `cadWorkspace` identity replaces the service and disposes the old; copy → exact `SURFCOMPOSE` payload + revisions + status + one dispatch; paste → exact `SURFCOMPOSEPASTE` payload/status; rejection status; stale revision blocked with the retry notice; late old-drawing result never applies; superseded first result dropped / latest wins; missing source returns without deleting pending; worker URL resolves `/src/workers/surfaceWorker.ts`. |
| `tests/cad_civil_inquiry_dispatch_1946.test.ts` | **18/18** | analysis in-band hit / UNCLASSIFIED / outside-domain; signed-depth FILL; slope; null map/row; volume current FILL and null-source message and id fallback; section gate message, displayed station + signed offset + E/N elevation, gap/outside; profile hit, missing profile, missing alignment/surface, missing CURRENT TIN, station-equation ambiguity, unstationed message. Goldens are literal fixture-derived strings, not the production formatter. |
| `tests/cad_surface_pick_priority_1946.test.tsx` | **14/14** | all precedence pairs, four-session fall-through, block over every inquiry, analysis over volume/surface with later picks left armed, block one-shot/repeat/rejected arming, analysis/volume always-clear with null answers, idle no-op, elevation vs slope routing with real mesh text, missing surface clears the pick without an inquiry. |

The compose suite mocks only the worker transport through the existing
`src/workers/surfaceWorkerClient` module seam and drives the REAL
`SurfaceComposeService` + REAL command builders. The other two suites use the
production helpers directly. All are fast/deterministic and stay in the agent
tier.

## Focused regression batches

1. All six #194 extraction suites (194.1–194.5 + the three new 1946 suites) →
   **11 files, 141 passed**.
2. Neighbours: #183 pointer seed/culling/perf/dedupe, #184 snapshot
   memo/contract/panels, #185 revision cache/contour race/source-revision memo,
   #186 viewport filter (unit/root/instrument), #191 point cap, compose service
   + 18y/18z parity, volume/analysis service + bands + UI, profile/section
   UI/worker, 18S/18T/18V edit sessions, LandXML civil profile/section 18L →
   **35 files, 481 passed**.
3. `tests/surveyCadWorkspace/` → **52 files, 144 passed / 1 skipped**.

No genuine regressions introduced.

## Agent tier (single run, frozen source)

`npm run test:agent` → **1014 passed / 3 failed (1017 files)**, 9649 passed +
1 skipped. The 3 failures are the known **pre-existing study-desktop real-data**
trio, unrelated to CAD and untouched by this phase:

- `study-desktop/tests/study_ai_unit_calibration.test.ts`
- `study-desktop/tests/study_ai_unit_calibration_v5.test.ts`
- `study-desktop/tests/study_ai_unit_preflight.test.ts`

Same class as the 194.1–194.5 baselines (frozen `sourcePackageId` drift:
v4 `nb-sit-statute-corpus-2026-08-29` vs expected
`nb-sit-statute-corpus-2026-09-11`). No CAD test failed.

## Browser QA (real Chromium /cad, dev server)

| Spec | Result |
| --- | --- |
| `tests-browser/cad-compose-picks-1946.spec.ts` (new) | **4/4** — surface elevation + slope viewport picks through the real canvas → `onSurfacePickPoint` dispatcher (manager arm → close → world click → reopen answer), then pan/zoom/pointer with zero errors; volume difference viewport pick answering a live source inquiry; compose copy → one undo restores the pre-compose surface list; block INSERT pick repeat (two picks place two refs, Esc disarms). |
| `tests-browser/cad-surface-compose-18y.spec.ts` 18Y-1 | 1/1 — real compose copy writes one explicit composite, sources untouched, overlay priority. |
| `tests-browser/cad-surface-compose-18y.spec.ts` 18Y-2 / 18Y-3 | 2/2 — paste keeps target identity + undo/redo; seam mismatch blocks with no history entry. |
| `tests-browser/cad-drawing-lifecycle-1943.spec.ts` | 3/3 — LandXML cancel/re-stage, commit schedules CURRENT TIN, drawing switch wipes staged state. |
| `tests-browser/cad-surface-revision-185.spec.ts` | 1/1 — real worker TIN/contour live-correct through edit/rebuild/undo/switch. |
| `tests-browser/cad-shell-actions-1942.spec.ts` | 4/4 — selection/erase/undo/redo, ribbon + dock, managers, drawing switch remount. |
| `tests-browser/cad-surface-analysis-18u.spec.ts` 18U-A | 1/1 — analysis CURRENT + range edit + inquiry (exercises the extracted `describeAnalysisAt` via the shell action). |

### Known pre-existing failures (not caused here, not retargeted)

- `tests-browser/cad-surface-compose-18y.spec.ts` **18Y-10** — clicks
  `[data-cad-surface="compose"]`, a ribbon selector that does not exist anywhere
  on this baseline (`git grep` for it in `src/` returns nothing; the Surface
  ribbon uses a keyed button registry). Stale selector, same class as 18M-G.
- `tests-browser/cad-surface-18i.spec.ts` **18I-A** — strict-mode ambiguity on
  the volume Calculate button (both `Calculate Volume` and `Calculate` exist);
  the spec predates the `Calculate Volume` button. The 1946 volume pick test
  scopes to `[data-volume-detail]` and passes.
- `tests-browser/cad-transform-18q.spec.ts` block-reference flow — clicks
  `[data-cad-blocks="manager"]`, an attribute that no longer exists in `src/`
  (the block manager is opened through the `BLOCK` / `INSERT` commands and the
  toolspace/ribbon). Stale selector; the extracted block INSERT pick branch is
  instead exercised end-to-end by the new `1946-4` flow (create from selection →
  `INSERT` pick → two repeat placements → Esc).

No new browser page/console/unhandled errors were observed in any 1946 flow.

## Preserved pins

- `#183` pointer channel/cull, `#184` shell-snapshot memo + point cap, `#185`
  surface-revision memo + contour race, `#186` viewport filter, `#189`
  selection, `#191` point cap — green.
- `#194.1`–`#194.5` extractions untouched.
- Both `shellLink` registration effects, the `shellActions` composition
  position, the LandXML lifecycle, the late deletion effects, and the snapshot
  builders keep their exact positions and dependency arrays.
- The `pendingComposeModeRef` is the same object the shell civil actions write;
  the compose APPLY transaction is the only history seam.

## Limitations (reported honestly)

- Root remains 1600 lines, above the repo 900-line guidance; this is the sixth
  #194 slice and the root is smaller (-212), not larger. The `shellStarters`
  (~120 commands), the seven-field snapshot builder + 12 sub-builders, and the
  shell action manager wiring remain in the root by design and are queued for
  #194.7.
- The browser tests click the preview background for the surface / volume picks
  (the TIN's wide pick stroke captures in-domain clicks), so they prove the
  dispatcher wiring and honest no-elevation answer rather than a numeric
  in-mesh elevation; the exact in-band / interpolation strings are pinned by
  the pure inquiry suite.
- Compose paste / source-immutability / mismatch-block flows are re-run from
  18Y rather than duplicate-authored; the new spec adds the copy → one-undo flow.
- No `test:wasm`, `parity:industry-reference`, or `test:evidence` campaign: this
  is a UI structural change touching no engine / WASM / worker-protocol /
  parity-math code.

## #194.7 roadmap

1. `shellStarters`, the snapshot builder + sub-builders, and the shell action
   manager wiring.
2. Any remaining geometry/snapshot handler bodies that read the live workspace.
