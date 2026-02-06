# WebNet (Star*Net-style LSA)

Browser-based least-squares adjustment for mixed survey observations (TS distances/angles, GNSS baselines, leveling dH) inspired by MicroSurvey Star*Net.

## Quick Start

```bash
npm install
npm run dev
# npm run lint
# npm run test       # vitest watch
# npm run test:run   # vitest one-shot
# npm run test:cov   # vitest coverage
# npm run build
```

## Project Docs
- **User Guide**: [docs/USER_GUIDE.md](docs/USER_GUIDE.md) - **Start Here!**
- Agent guide: agents.md (context, stack, commands, architecture, next steps)
- Todo list: TODO.md (current roadmap and completed items)

## Examples
- A comprehensive example file is available at [public/examples/star_net_demo.dat](public/examples/star_net_demo.dat). You can load this file into WebNet to explore supported features.
- Total-station focused examples are available in `public/examples/`:
  - `ts_d_distances.dat` (D)
  - `ts_a_angles.dat` (A)
  - `ts_b_bearings.dat` (B)
  - `ts_v_verticals_delta.dat` (V in `.DELTA ON`)
  - `ts_dv_distance_vertical.dat` (DV)
  - `ts_m_measurements.dat` (M)
  - `ts_bm_bearing_measurements.dat` (BM)
  - `ts_traverse_tb_t_te.dat` (TB/T/TE traverse)
  - `ts_direction_sets_db_dn_dm_de.dat` (DB/DN/DM/DE direction set)
  - `ts_sideshots_ss.dat` (SS: legacy, `AZ=`, and `HZ=` modes)
  - `ts_all_combined.dat` (all TS observation families in one adjustment)

## Status
- Core adjustment engine is in TypeScript modules under `src/engine` with React UI composed from `src/App.tsx` + `src/components`.
- Lint/build/test pass in CI; formatting via Prettier/lint-staged.
- Parser: Star*Net-style inline options (.UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.MAPSCALE/.CURVREF/.REFRACTION/.VRED/.LWEIGHT/.NORMALIZE/.END/.LONSIGN/.I/.EDM/.CENTERING/.ADDC/.DEBUG/.AMODE) plus C/E/CH/PH/EH and D/A/G/L/B/V/M/BM/TB/T/TE/DB/DN/DM/DE/SS records with per-component `!/*` fixity (`*` remains legacy-fixed when used alone, with warning), std errs (numeric/&/!/*), HI/HT capture, bearings/zeniths, inline `#` comments and `'Description` trimming, and ft<->m normalization (P/PH lat/long projected to local EN using first P as origin; .LWEIGHT applied as fallback for leveling with ft lengths converted to km; DV/M delta-mode emit distance+dH; DV/BM/M slope mode emit zeniths with face-2 weighting and derived stds; distances use additive/propagated EDM modes; GNSS supports per-component sigmas with optional EN correlation; centering inflation can be disabled via `.CENTERING OFF` and explicit sigmas only inflate when `.ADDC ON`; debug logging includes per-obs w in rad/deg plus a `wnew ≈ w − A·dx` step check; `A` interpretation can be forced via `.AMODE` and AUTO mode now uses stricter classification tolerance; 3D runs automatically hold heights for stations that have no vertical-sensitive observations; sideshots support optional explicit azimuth tokens (`AZ=`/`@`) plus setup-based horizontal angle tokens (`HZ=`/`HA=`/`ANG=`) tied to current backsight, are excluded from adjustment with occupy/backsight validation, then reported post-adjust as computed coordinate/precision; mixed-face traverse/direction shots rejected when .NORMALIZE OFF; TE legs log closure residuals/misclosure vectors/geometry when available). Direction sets (DB/DN/DM) now keep raw circle readings internally, reduce face pairs by target into set means with reduced sigmas, and log raw-vs-reduced diagnostics while still solving per-set orientation parameters. Header toggles expose coord/order/delta/map/normalize/.LWEIGHT/lon-sign defaults; see TODO.md for remaining codes to support. Parser now warns when `.ORDER` is missing (defaults to EN).
- Engine: honors 2D mode by solving only XY, skipping vertical observations (lev/zenith) with a log note.
- Engine: logs basic network diagnostics (e.g., unknown stations with no observations or direction-only targets observed from a single occupy).
- Engine: reports standardized residuals (Qvv-based), redundancy numbers, chi-square test with 95% critical bounds + variance-factor interval, per-type residual summaries, local-test outcomes + MDB values, weighted control-coordinate constraints (from coordinate std errors), normal-matrix condition diagnostics, point precision (σN/σE/σH + ellipse azimuth), and relative precision between unknown points.
- Engine: reports per-direction-set prefit summary (mean/RMS/max in arcseconds) based on initial coordinates.
- Engine: reports direction-set diagnostics (raw/reduced counts, face balance, orientation quality), setup summaries by occupy station, setup-level suspect metrics (RMS/Max standardized residuals, local-test fail counts, worst observation trace), and traverse diagnostics including closure ratio when geometry permits.
- Engine: reports direction-target repeatability diagnostics (raw spread, face balance, local-test/MDB cues, ranked suspect score) to help isolate weak sets/targets inside direction workflows.
- Engine: applies map-scale reduction to horizontal distances when map mode is active, and supports optional zenith curvature/refraction corrections (`.CURVREF`/`.REFRACTION` + `.VRED CURVREF`).
- Engine: computes post-adjusted sideshot coordinate/precision rows from excluded SS observations; azimuth source is tracked (`explicit`, `setup`, or `target`) and when azimuth cannot be derived, the limitation is reported explicitly.
- Defaults: coord=3D, order=EN, lon sign=west-negative, delta mode slope (zenith), map mode off, normalize on.
- UX: .dat upload, export results as text (unit-correct, source-line traceable, sorted by |StdRes| with top suspects), refresh to last-run input, exclusion toggles with re-run, editable obs values/weights, true unit conversion (ft/m), settings dropdown (includes TS reduction controls like map scale and curvature/refraction), map/ellipse view.
- Performance guards added (conditioning/residual warnings); see TODO.md for any future worker offload ideas.
