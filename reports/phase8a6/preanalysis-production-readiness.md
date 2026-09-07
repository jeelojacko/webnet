# Phase 8A.6 production readiness (test-only evidence, no routing)

- corpus=38 workerCases=5 stressSessions=100 cancelSupported=true
- whole-session admitted: p-small-2d, p-gps-2d, p-size-chain-008, p-braced-quad
- whole-session fallback (atomic, restart-identical): p-camp-bounded
- exact unknown boundary 127/128/129: 127=admit 128=admit 129=reject
- exact system boundary 63/64/65: 63=admit 64=admit 65=reject
- emergent unknowns: 127 128 129 (exact 127/128/129 via chain-star)

## Criteria

- C1 dense-selected oracle agrees on every admitted worker system: PASS (packed-decode consistency; both sides TS)
- C2 native-value residual holds on every admitted worker system (every column checked): PASS
- C3 hybrid holds on every admitted worker system: PASS
- Physical covariance valid on every admitted worker system: PASS
- Captured covariance calls finite, undamped, untruncated, C2-native passing (admitted cases): PASS
- Camp over-cap (170/171 unknowns > 128) skips C2-native fail-closed and falls back atomic: PASS
- Camp correction-unverifiable geometry falls back atomic (not admitted): PASS
- Fault injection detects value/shape corruption, documents blind spots: PASS (pure sentinel test, 7 green)
- 100 reused-worker mixed sessions bit-identical with zero fallbacks: PASS
- Exact 127/128/129 + 63/64/65 policy boundaries: PASS (unknowns exact-emergent; systems pure-policy)

## Covariance-adversarial fixtures

- p-weight-loose-both success=true physical=true cond=1.35e+13
- p-cond-resection-weak success=true physical=true cond=4.96e+10
- p-cond-collinear success=true physical=true cond=3.10e+11
- p-cond-angle-only success=false physical=true cond=n/a
- p-cond-narrow-brace success=true physical=true cond=5.55e+15
- p-cond-distant-pair success=true physical=true cond=2.08e+11
- synthetic near-singular packed system damped fail-closed: yes (required behavior)

## Phase 8B GO / NO-GO

- Phase 8B remains NO-GO for automatic sparse preanalysis routing: the sentinel,
  policy, and stress evidence are test-only (verification queries included),
  system-count coverage is pure-policy, and no production restart
  hooks exist. A bounded S0+P3-sentinel evidence path stays the only candidate
  shape, pending condition-gated, bounded session-solve strategy work with
  production hooks reviewed separately.

## Limitations

- True selected-vs-dense covariance capture inside the production engine was not
  attempted (invasive); the sentinel re-probes captured packed inputs in test code.
- In-bridge C1 uses diagonal queries (packed-decode consistency); C2-native judges
  native values with every column checked (prod returns + bounded verification set); pure-test scaling
  evidence (64: 4096 vs 64; 128: 16384 vs 128).
- Emergent real sessions hit exactly 127/128/129 unknowns (chain-star maps 1:1);
  63/64/65 planning-system counts cannot emerge from preanalysis sessions, so that
  boundary is pure-policy evaluation (test-only limit).
- Internal restart is the existing clean TypeScript rerun (Phase 7C/7D shape); no
  new production restart hooks were added.
