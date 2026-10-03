# Dependency maintenance: Node 24 + audit cleanup

Branch: `chore/node24-dependency-audit-cleanup` from exact clean main
`1d966c52` (origin/main verified equal before branching; PR #151 untouched).
Target contract: Node 24 (user laptop v24.19.x; CI `actions/setup-node` node-version 24).

## 1. Baseline environment

- Validation runtime: Node **v24.19.0**, npm **11.17.0** via mise
  (`/home/jacko/.local/share/mise/installs/node/24.19.0/bin`, PATH-first;
  global shims and Pi host default Node v26.10.0 untouched).
- `npm config`: registry `https://registry.npmjs.org/`; only notice is the
  pre-existing repo `.npmrc` allow-scripts interaction (not a deprecation).
- Platform: Linux x86_64 (CI) + Windows-laptop contract preserved
  (no platform-specific separators or assumptions introduced).

## 2. Audit before (clean `npm ci` on baseline)

- Warning: `npm warn deprecated whatwg-encoding@3.1.1: Use @exodus/bytes instead`.
- `npm audit`: **6 HIGH, 0 others** — all one advisory:
  `braces * vulnerable to stack-exhaustion DoS (GHSA-vfj7-8cjw-p6xm)`,
  `fix available via npm audit fix --force (tailwindcss@4.3.3, breaking)`.
- Paths: `tailwindcss@3.4.18` via `chokidar@3.6.0`/`fast-glob@3.3.3`/
  `micromatch@4.0.8` → `braces@3.0.3`; plus `lint-staged@15.5.2` via
  `micromatch@4.0.8` → `braces@3.0.3` (deduped).
- `npm audit --omit=dev`: **0 vulnerabilities** (all findings dev-only).
- Patch availability: **none**. `braces` latest is still 3.0.3;
  `micromatch` latest still 4.0.8 (vulnerable via braces). No patched
  release exists in the 3.x line, so only a major migration (or an
  incompatible override) could silence it.

## 3. Why `npm audit fix --force` was rejected

`--force` jumps `tailwindcss 3.4.18 → 4.3.3` + `lint-staged → 17.6.0`
without migrating config: the v3 PostCSS plugin usage then fails at dev
startup (`tailwindcss can no longer be used directly as the PostCSS
plugin; @tailwindcss/postcss is required`). Zero-vuln by breakage is not
evidence of safety. Each upgrade below is deliberate, minimal, and
validated (build + dev + visual + tests).

## 4. `whatwg-encoding` removal (jsdom 26.1.0 → 27.4.0)

- Provenance (`npm explain`): `jsdom@26.1.0` → `html-encoding-sniffer@4.0.0`
  + direct dep → `whatwg-encoding@3.1.1`. Hypothesis confirmed, not assumed.
- Version survey: jsdom 27.0.0–27.3.0 still carry `whatwg-encoding`;
  **27.4.0** is the first release without it (`html-encoding-sniffer@^6.0.0`,
  no `whatwg-encoding`); 28–30 also clean but a bigger jump.
  Engines for 27.4.0: `^20.19.0 || ^22.12.0 || >=24.0.0` — Node 24 OK.
  Vitest peer is `jsdom: *`, no conflict.
- Change: `jsdom ^26.1.0 → ^27.4.0` in root **and** `study-desktop`
  `package.json` (study shares the root lockfile; no separate lockfile).
- Proof: `npm ls whatwg-encoding` → empty; clean `npm ci` shows no
  whatwg-encoding warning. jsdom/DOM suites + full agent tier show no new
  failures (see §8).

## 5. lint-staged: audited, proven unused, removed

- Repo-wide search: references only in `package.json` devDeps,
  lockfile entries, and a stale `TODO.md:1659` checklist line.
  `.husky/pre-commit` runs `npm run lint` + `npm run typecheck` directly
  (never invokes `lint-staged`); no workflow, script, doc, or editor
  config references it; `.lintstagedrc.json` was never consumed.
- Action: devDependency removed, `.lintstagedrc.json` deleted, lockfile
  regenerated normally. Post-change grep: no dangling references.
- Audit effect: 6 → 5 HIGH (lint-staged/micromatch leg gone).

## 6. Reassessment before Tailwind migration

After §§4–5 + clean `npm ci`: `npm audit` = **5 HIGH, solely the
Tailwind 3.4.18 → braces chain**; `npm audit --omit=dev` = 0.
Per plan, migration proceeds (no override hack per §G: forcing
`braces@^3.0.3`-incompatible majors was never attempted).

## 7. Tailwind v3 → v4 migration (deliberate, visual-preserving)

- Versions: `tailwindcss@4.3.3` + `@tailwindcss/postcss@4.3.3` in root and
  study-desktop; `autoprefixer` removed from both (v4 self-prefixes per
  official upgrade guide; dep removed only after confirming no other use).
- `postcss.config.js` (root + study-desktop): plugin `tailwindcss` →
  `@tailwindcss/postcss`.
- `src/index.css`: `@tailwind base/components/utilities` →
  `@import "tailwindcss"` + `@config "../tailwind.config.js"` — the JS
  palette (CSS-variable `rgb(var(--theme-…)/<alpha-value>)` overrides of
  slate/blue/green/red/amber/cyan/emerald/rose) preserved **verbatim**,
  plus official-style v3-compat blocks (default border color, absolute
  `text-*` line-heights).
- `rounded-sm → rounded-xs` (4 sites: v4 renamed the scale; identical radius).
- Real find fixed honestly: a 3px header shift from v4 unitless `text-xs`
  line-height inheriting into `text-[10px]` buttons (v3 inherited absolute
  16px) — fixed globally via `@theme`, re-verified to 0px.
- `tailwind.config.js` content globs (incl. `study-desktop/src/**`) kept;
  study-desktop config still spreads the base palette with its narrower
  content scope; `study-desktop/src/index.css` still just imports root CSS.
- No `@tailwindcss/vite` switch (PostCSS path = minimal supported
  migration); `outline-none` renames skipped (identical rendering outside
  forced-colors).

## 8. study-desktop `brace-expansion` override (corrected, not faked)

- Work found study-desktop audit had 1 HIGH via the eslint-chain
  `minimatch@3.1.5 → brace-expansion@^1.1.7`; a lone
  `"brace-expansion": "^5.0.9"` override silenced audit but **broke
  `npm run lint`** (`TypeError: expand is not a function` — minimatch 3
  CJS vs brace-expansion 5 API). Caught by validation, not shipped.
- Fix: pair it with `"minimatch": "^10.2.5"`, exactly mirroring the root
  `package.json` **pre-existing baseline** overrides (brace-expansion,
  minimatch, nanoid, ws, js-yaml, @babel/core, flatted — all present on
  clean main, not introduced here). Root lint proves the pair compatible
  with eslint 9.39.5.
- Validated: study audit 0, study lint exit 0, study tests 1338 pass,
  study build green (see §9).

## 9. Final validation (Node 24.19.0, clean tree)

From clean `node_modules` + `npm ci` (no whatwg-encoding warning):

| Gate | Result |
|---|---|
| `npm audit` (root) | **0 vulnerabilities** |
| `npm audit --omit=dev` (root) | **0** |
| `npm audit` (study-desktop) | **0** |
| `npm ls braces/whatwg-encoding/lint-staged` | all empty/absent |
| `npm run lint` | 0 errors (2 pre-existing warnings) |
| `npm run typecheck` | clean |
| `npm run build` (root) | green |
| `npm run build` (study-desktop) | green |
| `npm run check:portable-paths` | 5606 paths, 0 violations |
| `npm run test:agent` | 7704 pass, 1 skip, **3 fail = pre-existing only** |
| `npm run test:release` | 4/4 |
| `npm run test:wasm` | 74/74 |
| `parity:industry-reference` | 25/25 |
| `harness:crs:synthetic` | 24/24 |
| study-desktop `npm test` | 1338 pass, 4 skipped (120 files) |
| `npm run test:run` (full, non-CI) | 7915 pass, 19 fail = 3 pre-existing + 16 evidence-campaign (13 files, non-CI tier; 2 files spot-proven identical on clean-main worktree) |
| dev server | root 200 + CSS 200, zero PostCSS/Tailwind errors |

`test:run`/`test:evidence` are never CI gates (evidence workflow is
manual-only); failures there are perf-timing/wording campaigns, unchanged
by this toolchain work. Plain `npm test` in an agent shell runs once
(vitest agent-detection); in a normal TTY it would watch — wrapper adds no
semantics either way.

## 10. Test-failure forensics (baseline → final)

- The 3 `test:agent` failures (`study_ai_unit_preflight`,
  `study_ai_unit_calibration`, `study_ai_unit_calibration_v5`, all
  "(real data)") fail identically on clean main: study-content validation
  drift (`FOCUS_CHILD_LABEL_INVALID`, `FOCUS_DEFINED_TERM_INVALID`),
  unrelated to Node/deps. Disposition: documented, untouched (repair is
  content work, out of scope; no tests weakened or skipped).
- 4th failure seen mid-branch (`cad_grading_transition_policy_20m1`
  zero-src guard) was a **guard-anchoring bug exposed by this branch**,
  not a regression: it diffed `baseline...HEAD -- src` with a floating
  end, so any later src change trips the 20M.1 pin. Fixed by anchoring the
  range to the PR #150 merge (`3fe69f22...bd4bdd45`, verified src-empty);
  pin semantics unchanged; 14/14 green.
- `test:run` evidence failures: 13 files of manual-tier campaigns
  (real-WASM timing thresholds, cap-wording). Non-CI by design
  (`scripts/testTiers.ts`); representative 2-file/3-test sample reproduced
  byte-identical failures on a clean-main worktree.

## 11. Browser / visual proof

- Dev server starts clean; main app + study dashboard load in Chromium
  with zero page/console errors attributable to migration.
- Before/after main-view screenshots: **0 pixels different**
  (~1.3M px compared); computed colors identical across default,
  gruvbox-light, catppuccin-mocha (e.g. `bg-slate-800 → rgb(80,73,69)`);
  study dashboard renders clean; hover/focus + palette probes covered by
  the shared-palette mechanism (single CSS source of truth).
- Build-passes alone was not accepted as styling proof.

## 12. Lockfile / determinism

- All lockfiles generated normally by npm 11.17.0 (`npm install` for
  version changes, `npm ci` for verification); no manual lockfile edits.
- Repeated clean `npm ci` does not mutate `package.json`/`package-lock.json`.
- Resolved: `tailwindcss 4.3.3`, `@tailwindcss/postcss 4.3.3`,
  `jsdom 27.4.0` (vitest copy deduped), `braces` absent,
  `whatwg-encoding` absent, `lint-staged` absent.

## 13. Residual risks

1. The 3 pre-existing real-data study failures remain red in `test:agent`
   (also red on main; CI impact pre-dates this branch).
2. Manual-tier evidence campaigns stay machine-sensitive (timing/wording);
   never CI gates; no action taken.
3. Root `overrides` (brace-expansion/minimatch/etc.) are inherited baseline
   pins; study-desktop now mirrors the eslint-chain pair. Revisit when
   upstream eslint/minimatch ship non-vulnerable ranges.
4. Tailwind v4 `@config` keeps the legacy JS config by design; a future
   CSS-first `@theme` port is optional, not required.
