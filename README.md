# WebNet (Star*Net-style LSA)

Browser-based least-squares adjustment for mixed survey observations (TS distances/angles, GNSS baselines, leveling dH) inspired by MicroSurvey Star*Net.

## Quick Start

```bash
npm install
npm run dev
# npm run lint
# npm run build
```

## Project Docs
- Agent guide: agents.md (context, stack, commands, architecture, next steps)

## Status
- Core adjustment engine now split into TypeScript modules under `src/engine` with React UI in `src/App.tsx`.
- Planned: further componentization and expanded tests/typing as the solver grows.
