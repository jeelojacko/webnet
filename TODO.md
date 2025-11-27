# TODO – WebNet

- [x] Add TypeScript tooling (tsconfig, TSX entry) and migrate LSA engine/UI to TS modules
- [x] Update ESLint to parse TS/TSX and ensure lint/build pass
- [x] Split UI into smaller components (Layout, Report, InputPane) to reduce App.tsx size
- [x] Add CI + coverage for Vitest suite (matrix/angles/parser/engine fixtures added; GitHub Actions workflow + coverage script)
- [x] Add Prettier + lint-staged for consistent formatting; remove unused src/App.css
- [x] Improve UX: file upload/save for .dat, unit-scaled outputs, map/ellipse view, exclusion toggles (re-run)
- [ ] Editable observation tables (inline edits to values/weights) and true computational unit conversion
- [x] Performance hardening: add conditioning guard and residual spike warnings; consider Web Worker offload (future)
