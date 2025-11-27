# TODO – WebNet

- [x] Add TypeScript tooling (tsconfig, TSX entry) and migrate LSA engine/UI to TS modules
- [x] Update ESLint to parse TS/TSX and ensure lint/build pass
- [x] Split UI into smaller components (Layout, Report, InputPane) to reduce App.tsx size
- [x] Add CI + coverage for Vitest suite (matrix/angles/parser/engine fixtures added; GitHub Actions workflow + coverage script)
- [x] Add Prettier + lint-staged for consistent formatting; remove unused src/App.css
- [ ] Improve UX: file upload/save for .dat, editable tables, true unit conversion in computation, map view of network/ellipses, re-weighting/outlier controls
- [ ] Performance hardening: singular-matrix guards, convergence diagnostics, consider Web Worker offload for larger networks
