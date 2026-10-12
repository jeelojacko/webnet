# PERF-CAD-RENDER.1 — per-pass CAD render/lookup hot paths: validation

- Baseline: pinned `main 32930bd50615916fe2f8166a63fa64879ed633c3`.
- Branch: `perf/cad-render-per-pass-hotpath-1` (parent owns PR/CI/merge).
- Verdict: **GO**. Both candidates isolate as non-negative on every fixture;
  the lookup candidate is a material, low-risk win. No regression persisted once
  same-function controls proved the harness fair (see "Cross-process noise").

## 1. Semantics coverage — `tests/cad_render_per_pass_hotpath.test.ts` (17/17)

The BEFORE/AFTER oracle `legacyFlatten` reconstructs the old
`entities.filter(visible).flatMap(toPrimitives)` pipeline from the public
renderer (render each entity in a single-entity project, concatenate) and is
`toEqual` **and** `JSON.stringify`-equal to the real multi-entity scene.

Pinned behavior:

- legacy truthy visibility check (`1` included, `0` dropped), not strict boolean;
- flat strict order: entity order × per-entity order, `sourceEntityId`
  sequence and primitive ids;
- empty inputs → `primitives: []`, `bounds` by reference; empty arrays
  (not absent) for `surfaceLayers` / `volumeLayers`;
- fresh output array per call (mutation of one result cannot leak into the next);
- a per-entity throw propagates all-or-nothing with no retained state;
- `options.lookup` parity with the per-call default;
- export semantics: `visible:false` dropped by the scene; layer-hidden retained
  by the scene and removed by `filterCadDisplaySceneForViewport`;
- nested block expansion ids (`primitive:<host>:block:<i>:...`), including the
  block-backed survey-point `:marker` path;
- polyline: valid bulge → native arc; present-but-invalid metadata → nothing
  (fail-closed, no chord); absent metadata → legacy chord lines;
- survey point: No Display style → no marker; standard → point primitive;
- text/labels (`mtext`), line/arc/parcel, leaders/dimensions;
- styles/transparency/linetype (stroke, opacity, dash pattern);
- `byId`: duplicate-id last-wins, first-insertion order, `undefined` tables → empty maps.

Negative controls (proven non-vacuous by source mutation):

| Mutation | Result |
|---|---|
| `for (... of [...entities].reverse())` in the scene loop | **4 tests fail** |
| first-wins `if (!map.has(id)) map.set(...)` in `byId` | **2 tests fail** |

## 2. Measurement methodology

Two harnesses, fixtures always built outside every timed window, ≥2 warmups:

1. **Cross-process realistic pass** — `scripts/perfCadRenderPerPassHotpath.ts`.
   Four variants (`before`, `lookup`-only, `scene`-only, `after`) applied by
   reverting the relevant source file, 4 rotating rounds, 5 interleaved series
   × 4 iterations; report the median of round medians + spread. This is the
   production-like view (one implementation loaded per process).
2. **Within-process paired isolation** — temporary harness importing real
   AFTER modules plus temporary BEFORE copies of the two files, alternating
   order every iteration so drift cannot favour a side, with same-function
   control pairs to detect harness bias. This is the tight per-candidate
   evidence (controls measured 0.999–1.005).

Fixtures: `1000_line`, `1000_mixed`, `10000_line`, `10000_mixed` (line-heavy:
all lines, 1/25 hidden; mixed: line/polyline/arc/circle/survey-point+mtext/block-reference).

## 3. Within-process paired isolation (primary, alternating order)

Delta = AFTER median vs BEFORE median; `ratio` = median of per-iteration paired
ratios. Controls are the *same function on both sides*: `~1.000` proves the
harness does not favour either position.

| Fixture | op | after ms | before ms | delta | paired ratio |
|---|---|---|---|---|---|
| 1000_line | lookup | 0.036 | 0.070 | −48.8% | 0.606 |
| 1000_line | lookupControl | 0.020 | 0.020 | +0.3% | 1.005 |
| 1000_line | rawBuild | 0.577 | 0.731 | −21.1% | 0.807 |
| 1000_line | rawBuildControl | 0.573 | 0.576 | −0.6% | 0.999 |
| 1000_line | fullPass | 0.517 | 0.546 | −5.2% | 0.946 |
| 1000_line | flattenOnly | 0.007 | 0.042 | −83.3% | 0.165 |
| 1000_line | commit / undo / redo | 0.724 / 0.518 / 0.519 | 0.748 / 0.545 / 0.546 | −3.2% / −5.1% / −4.9% | 0.969 / 0.950 / 0.950 |
| 1000_mixed | lookup | 0.032 | 0.046 | −30.8% | 0.693 |
| 1000_mixed | lookupControl | 0.030 | 0.030 | −0.2% | 1.000 |
| 1000_mixed | rawBuild | 0.949 | 1.332 | −28.8% | 0.711 |
| 1000_mixed | rawBuildControl | 0.993 | 0.990 | +0.4% | 1.001 |
| 1000_mixed | fullPass | 1.052 | 1.066 | −1.3% | 0.987 |
| 1000_mixed | flattenOnly | 0.016 | 0.055 | −71.8% | 0.282 |
| 1000_mixed | commit / undo / redo | 1.454 / 1.050 / 1.050 | 1.467 / 1.063 / 1.064 | −0.9% / −1.2% / −1.3% | 0.992 / 0.989 / 0.987 |
| 10000_line | lookup | 0.364 | 0.471 | −22.7% | 0.777 |
| 10000_line | lookupControl | 0.356 | 0.355 | +0.1% | 0.999 |
| 10000_line | rawBuild | 5.359 | 5.431 | −1.3% | 0.994 |
| 10000_line | rawBuildControl | 5.334 | 5.354 | −0.4% | 0.999 |
| 10000_line | fullPass | 6.184 | 6.379 | −3.1% | 0.972 |
| 10000_line | flattenOnly | 0.238 | 0.577 | −58.7% | 0.412 |
| 10000_line | commit / undo / redo | 9.862 / 6.413 / 6.295 | 10.363 / 6.870 / 6.516 | −4.8% / −6.6% / −3.4% | 0.936 / 0.953 / 0.949 |
| 10000_mixed | lookup | 0.414 | 0.534 | −22.4% | 0.780 |
| 10000_mixed | lookupControl | 0.401 | 0.401 | −0.1% | 1.001 |
| 10000_mixed | rawBuild | 10.078 | 10.293 | −2.1% | 0.965 |
| 10000_mixed | rawBuildControl | 10.706 | 10.698 | +0.1% | 1.001 |
| 10000_mixed | fullPass | 11.486 | 12.109 | −5.1% | 0.953 |
| 10000_mixed | flattenOnly | 0.306 | 0.764 | −60.0% | 0.399 |
| 10000_mixed | commit / undo / redo | 15.812 / 11.328 / 11.485 | 16.344 / 12.096 / 12.205 | −3.3% / −6.3% / −5.9% | 0.971 / 0.957 / 0.958 |

`rawBuild`/`fullPass`/`commit`/`undo`/`redo` include the full per-entity render,
so the isolated flatten saving (58–83% of the flatten slice) is a small share of
the total at 10k. `flattenOnly` is a diagnostic that precomputes the per-entity
primitive arrays and times the two flatten strategies only.

## 4. Cross-process realistic pass (secondary)

Median of round medians (4 rotating rounds; AFTER spread = min..max of the four
round medians). `lookup`/`scene` columns isolate a single reverted file.

| Fixture | op | before | lookup | scene | after | after spread | after vs before |
|---|---|---|---|---|---|---|---|
| 1000_line | lookup | 0.040 | 0.037 | 0.041 | 0.034 | 0.034..0.037 | −15.4% |
| 1000_line | rawBuild | 0.719 | 0.714 | 0.666 | 0.667 | 0.658..0.671 | −7.2% |
| 1000_line | materialize | 0.029 | 0.029 | 0.030 | 0.030 | 0.030..0.030 | +3.3% |
| 1000_line | fullPass | 0.784 | 0.782 | 0.730 | 0.729 | 0.727..0.736 | −6.9% |
| 1000_line | commit / undo / redo | 1.086 / 0.792 / 0.788 | 1.063 / 0.780 / 0.778 | 1.007 / 0.733 / 0.738 | 1.023 / 0.731 / 0.731 | 1.008..1.028 / 0.722..0.737 / 0.727..0.733 | −5.8% / −7.7% / −7.2% |
| 1000_mixed | lookup | 0.050 | 0.040 | 0.051 | 0.039 | 0.037..0.042 | −21.9% |
| 1000_mixed | rawBuild | 1.303 | 1.298 | 1.281 | 1.275 | 1.261..1.280 | −2.2% |
| 1000_mixed | materialize | 0.066 | 0.068 | 0.073 | 0.067 | 0.065..0.084 | +1.8% |
| 1000_mixed | fullPass | 1.417 | 1.409 | 1.409 | 1.386 | 1.370..1.387 | −2.2% |
| 1000_mixed | commit / undo / redo | 1.896 / 1.422 / 1.420 | 1.890 / 1.425 / 1.406 | 1.892 / 1.409 / 1.404 | 1.870 / 1.394 / 1.378 | 1.830..1.883 / 1.365..1.400 / 1.358..1.391 | −1.4% / −2.0% / −2.9% |
| 10000_line | lookup | 0.467 | 0.370 | 0.475 | 0.363 | 0.359..0.369 | −22.2% |
| 10000_line | rawBuild | 5.422 | 5.492 | 5.151 | 5.587 | 5.580..5.598 | +3.0% (noise) |
| 10000_line | materialize | 0.400 | 0.399 | 0.417 | 0.415 | 0.410..0.434 | +3.8% (noise) |
| 10000_line | fullPass | 6.315 | 6.293 | 6.141 | 6.425 | 6.416..6.432 | +1.8% (noise) |
| 10000_line | commit / undo / redo | 9.987 / 6.315 / 6.856 | 10.068 / 6.306 / 6.885 | 9.498 / 6.255 / 6.318 | 9.048 / 6.450 / 5.868 | 8.964..9.081 / 6.429..6.462 / 5.849..5.932 | −9.4% / +2.1% / −14.4% |
| 10000_mixed | lookup | 0.666 | 0.557 | 0.673 | 0.545 | 0.542..0.552 | −18.1% |
| 10000_mixed | rawBuild | 10.653 | 10.733 | 9.979 | 10.006 | 9.815..10.379 | −6.1% |
| 10000_mixed | materialize | 0.688 | 0.650 | 0.687 | 0.656 | 0.632..0.728 | −4.6% |
| 10000_mixed | fullPass | 11.895 | 11.841 | 11.189 | 10.953 | 10.762..11.208 | −7.9% |
| 10000_mixed | commit / undo / redo | 16.147 / 11.976 / 12.068 | 16.445 / 11.931 / 12.015 | 15.543 / 11.292 / 11.372 | 15.627 / 11.049 / 11.256 | 15.311..15.919 / 10.950..11.338 / 11.123..11.546 | −3.2% / −7.7% / −6.7% |

### Cross-process noise / adverse outliers (honest)

- `10000_line rawBuild`/`materialize`/`fullPass`/`undo` show small positive
  deltas (+3.0% / +3.8% / +1.8% / +2.1%) in the cross-process medians. They are
  **not** a real regression: in `rawBuild` the `scene`-only and `after` variants
  are byte-identical code (prebuilt lookup is passed, so the reverted lookup file
  cannot matter) yet differ by ~8% in the cross-process medians (5.151 vs 5.587),
  while each variant's own four round medians spread <1%. Cross-process
  systemic variance therefore exceeds the effect for these rows. The paired
  within-process harness with same-function controls (ratio 0.999–1.001) shows
  no regression on any fixture.
- No geometry-invalidation regression: the change touches only list
  construction. Revision/signature/cache code is untouched; the oracle proves
  byte-identical primitive output.

## 5. Validation commands (this branch)

- Focused render/lookup batch (10 files): **167 passed**.
  `cad_render_per_pass_hotpath`, `cad_project_lookup`, `cad_render_standards`,
  `cad_annotation_renderer`, `cad_renderer_labels`, `cad_spike_model`,
  `cad_blocks_wncad`, `cad_polyline_bulge_width_c2_consumers`,
  `cad_parcel_curved_exports_19c`, `cad_persistence_and_entities`.
- Export/viewport/manifest batch (6 files): **71 passed**.
  `cad_export_18c`, `cad_export_scene_type_cycle_1958`, `cad_mlightcad_runtime`,
  `cad_viewport_filter_186`, `cad_viewport_filter_root_186`, `test_tier_manifest`.
- `npm run build`: clean (13.6 s; only the pre-existing chunk-size warning).
- `npm run check:portable-paths`: 6442 tracked paths, **0 violations**.
- `npm run test:agent`: **11440 passed, 1 skipped, 3 failed**. The 3 failures are
  the pre-existing ignored/private Study Desktop real-data suites
  (`study_ai_unit_calibration`, `study_ai_unit_calibration_v5`,
  `study_ai_unit_preflight`); their fixtures were not touched.
- `tsc` / `eslint` run via Husky hooks at commit (not manually pre-commit).

## 6. Reproduction

- Realistic pass: `npx tsx scripts/perfCadRenderPerPassHotpath.ts --out /tmp/after.json --tag after`.
  For a BEFORE/variant run, revert the matching file(s) with
  `git show 32930bd5:<path>` before running, then restore.
- Paired isolation: copy the two BEFORE files into
  `src/engine/cad/_perfBefore{CadRenderer,CadProjectLookup}.ts`, point the copied
  renderer's `./cadProjectLookup` import at `./_perfBeforeCadProjectLookup`, run
  the temporary alternating harness, then delete the copies. Temporary files
  were removed before commit (no new modules shipped).
