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
- Agent guide: agents.md (context, stack, commands, architecture, next steps)
- Todo list: TODO.md (current roadmap and completed items)

## Status
- Core adjustment engine is in TypeScript modules under `src/engine` with React UI composed from `src/App.tsx` + `src/components`.
- Lint/build/test pass in CI; formatting via Prettier/lint-staged.
- Parser: Star*Net-style inline options (.UNITS/.COORD/.ORDER/.2D/.3D/.DELTA/.MAPMODE/.LWEIGHT/.NORMALIZE/.END/.LONSIGN) plus C/E/CH/PH/EH and D/A/G/L/B/V/M/BM/TB/T/TE/DB/DN/DM/DE/SS records with fixity/std errs, HI/HT capture, bearings/zeniths, and ft<->m normalization (P/PH lat/long projected to local EN using first P as origin; .LWEIGHT applied as fallback for leveling with ft lengths converted to km; DV/M delta-mode emit distance+dH; sideshots parsed but excluded from adjustment; mixed-face traverse/direction shots rejected when .NORMALIZE OFF; closure legs log residuals). Header toggles expose coord/order/delta/map/normalize/.LWEIGHT/lon-sign defaults; see TODO.md for remaining codes to support.
- Defaults: coord=3D, order=EN, lon sign=west-negative, delta mode slope (zenith), map mode off, normalize on.
- UX: .dat upload/download, exclusion toggles with re-run, editable obs values/weights, true unit conversion (ft/m), map/ellipse view.
- Performance guards added (conditioning/residual warnings); see TODO.md for any future worker offload ideas.
