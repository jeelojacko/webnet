# Phase 12F.3 W5 — R2B Browser/Worker Production Proof

Branch `feat/gnss-native-r2b-production-proof`. DEFAULT OFF: the R2B kill
switch stays false, so production behavior is bit-identical TypeScript
unless a caller explicitly enables the route (evidence only). No math,
tolerance, formula, C++, dispatcher, or default changes.

## §1 — Worker-thread proof (real Worker, real WASM)

Harness `scripts/gnss/gnssR2BWorkerProof.ts` (harness only, not a committed
test; run `node --import tsx scripts/gnss/gnssR2BWorkerProof.ts`). One
`node:worker_threads` Worker loads the real `cpp/build-wasm` bundle
(missing artifact fails loudly), then runs 11 small-net cases (no timing
gates). Each native leg asserts route `native-sparse-selected-qxx`, exact
provenance, R2B-vs-TS coords bitwise (JSON-equal stations/residuals plus
exact `weightedResidualSum`), and no `qxx` field. Each TS leg asserts route
`typescript`, provenance `typescript-dense`, and whole-structure equality
with clean TS.

| Case | Expected | Got | Detail |
| --- | --- | --- | --- |
| below-min ring-25 (default floor 225; p=72) | TS | TS | perf-floor reason; whole-struct equal |
| ring-25 (minParams: 1 seam) | R2B | R2B | provenance exact; coords bitwise; no qxx |
| sparse-mesh-25 | R2B | R2B | provenance exact; coords bitwise; no qxx |
| ring-25 + setup (h 5 mm, v 2 mm) | R2B | R2B | provenance exact; coords bitwise; no qxx |
| repeated-edge-25 | R2B | R2B | provenance exact; coords bitwise; no qxx |
| chain-25 (bridge-excluded) | TS | TS | 5 cut-edges pinned; zero bundle loads |
| fill-gate (maxFactorNnz: 1) | TS | TS | `factorNnz 603 exceeds cap 1`; whole-struct equal |
| above-max (maxTotalStations: 1) | TS | TS | station-cap reason; zero bundle loads |
| forced native failure (throwing block solver) | TS | TS | `injected block failure`; whole-struct equal |
| kill switch OFF | TS | TS | kill-switch reason; zero bundle loads |
| non-worker (isWorker false) | TS | TS | worker-context reason; zero bundle loads |

Result: **11/11 passed**, real WASM, real Worker thread. The `minParams: 1`
seam is diagnostic floor-lowering for CI-sized nets (measurement only);
production bounds are untouched.

## §2 — Browser default-OFF smoke (Chromium)

Existing Playwright browsers used (no install). Fresh `dist/` (built
2026-09-13, `src/` clean — no rebuild needed) served over a local static
server; plain page load in Chromium with full request interception:

- **14 total requests, 0 matching `webnet_core`/`*.wasm`. PASS.**

The R2B route module is worker-only (`isWorker false -> TS`, proven above)
and default-OFF, so page load initializes no WASM from the R2B path. No
screenshots (not needed for a zero-request assertion).

## §3 — Default-OFF statement

`gnssNativeR2BEnabled` defaults to `false`; kill-OFF and non-worker legs
issue zero bundle loads; every native failure reruns the identical input
through clean TypeScript with whole-structure equality. Nothing is enabled
by default; no production behavior changes.

## §4 — Validation

- Worker proof: 11/11 PASS (above).
- Browser smoke: PASS (above).
- `npm run lint`, `npm run typecheck`: see worker completion summary.
- Files: NEW `scripts/gnss/gnssR2BWorkerProof.ts`, NEW this report.
  Uncommitted; no route/engine/verifier/test/dispatcher/doc/TODO changes.
