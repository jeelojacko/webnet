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

## Status
- Core adjustment engine is in TypeScript modules under `src/engine` with React UI composed from `src/App.tsx` + `src/components`.
- Lint/build/test pass in CI; formatting via Prettier/lint-staged.
- Parser: Star*Net-style inline options (.UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.LWEIGHT/.NORMALIZE/.END/.LONSIGN/.I/.EDM/.ADDC) plus C/E/CH/PH/EH and D/A/G/L/B/V/M/BM/TB/T/TE/DB/DN/DM/DE/SS records with per-component `!` fixity (legacy `*`), std errs (numeric/&/!/*), HI/HT capture, bearings/zeniths, inline `#` comments and `'Description` trimming, and ft<->m normalization (P/PH lat/long projected to local EN using first P as origin; .LWEIGHT applied as fallback for leveling with ft lengths converted to km; DV/M delta-mode emit distance+dH; DV/BM/M slope mode emit zeniths with face-2 weighting and derived stds; distances use additive/propagated EDM modes; instrument library supports EDM const/ppm, HZ/VA precision, and centering errors with optional explicit-centering inflation; sideshots parsed but excluded from adjustment with occupy/backsight validation; mixed-face traverse/direction shots rejected when .NORMALIZE OFF; TE legs log closure residuals/misclosure vectors/geometry when available). Direction sets (DB/DN/DM) are treated as raw circle readings with per-set orientation parameters. Header toggles expose coord/order/delta/map/normalize/.LWEIGHT/lon-sign defaults; see TODO.md for remaining codes to support. Parser now warns when `.ORDER` is missing (defaults to EN).
- Engine: honors 2D mode by solving only XY, skipping vertical observations (lev/zenith) with a log note.
- Engine: logs basic network diagnostics (e.g., unknown stations with no observations or direction-only targets observed from a single occupy).
- Engine: reports per-direction-set residual summary (mean/RMS/max in arcseconds) in the processing log.
- Engine: reports per-direction-set prefit summary (mean/RMS/max in arcseconds) based on initial coordinates.
- Defaults: coord=3D, order=EN, lon sign=west-negative, delta mode slope (zenith), map mode off, normalize on.
- UX: .dat upload/download, exclusion toggles with re-run, editable obs values/weights, true unit conversion (ft/m), settings dropdown, map/ellipse view.
- Performance guards added (conditioning/residual warnings); see TODO.md for any future worker offload ideas.
