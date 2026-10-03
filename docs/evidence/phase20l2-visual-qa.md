# Phase 20L.2 offset-radius production — visual QA

Real Chromium (Playwright 1.60.0) on the production build; all frames
bounded PNGs under `docs/evidence/phase20l2/` (+ `geometry.json` viewport
audit). Every frame inspected: shell chrome intact, no page scroll,
status/accuracy text matches the asserted engine contract.

| frame | size | shows | verdict |
|---|---|---|---|
| `1366-exact-current.png` | 1366×768 | Flow A post-Calculate: group detail Current, Curve Approximated (no corner badge), ties 5.00–5.00, plan 763.2, 84 tris | PASS |
| `1366-exact-inquiry.png` | 1366×768 | Flow A inquiry: Status Current · accuracy Curve Approximated; ties min/max/mean 5.000; plan 763.175 / 3D 1079.496; 43 limit vertices, 84 mesh tris; corners OVERLAP, diagnostics none | PASS |
| `1920-exact-current.png` | 1920×1080 | Flow A @1920: same Current/no-corner state at wide viewport | PASS |
| `1920-exact-inquiry.png` | 1920×1080 | Flow A inquiry @1920: same tie/area pins | PASS |
| `1366-chord-current.png` | 1366×768 | Flow B arc-pair: Current WITH `Curve Approximated (corner)` — fallback badge truthful | PASS |

Flow C (maxSearch FAILED, products gated, inquiry names the failure) is
text-asserted in-spec with no frame — a failure banner needs no portrait.
Zero console/page/unhandled errors across all flows.
