# Phase 8A.7 preanalysis production hook (default-disabled)

- default enabled: false
- disabled route: typescript (WASM inits: 0)
- disabled deep-equal TypeScript: true
- enabled route (fake correct bundle): sparse (deep-equal: true)
- caps: unknowns<=128, systems<=64, runtime parameters<=256 (Phase 9B: station 128 / runtime 256)
- forbidden-import violations: none
- adjustment regression (adjustment input still ineligible for adjustment auto-route here): true

Whole-session atomicity: any damping/fallback/C1/C2/C3/physical/cap failure restarts the original immutable request clean in TypeScript exactly once. Condition is warn-only; correction carries no authority.
Pre-dispatch enforcement: gated correction/covariance wrappers throw typed fail-closed errors before delegating past 64 systems or 256 runtime parameters (over-cap systems never execute natively); covariance must pair with a started correction system.
