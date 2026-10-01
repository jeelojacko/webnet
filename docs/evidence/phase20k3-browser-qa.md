# Phase 20K.3 Wave E3 — Chromium browser QA

Status: **RUN — 18/18 spec flows green, 0 page / 0 console / 0 unhandled
errors per flow.** Branch `fix/phase20k3-surface-curve-authority-certificate`
(baseline `884b36e8` = PR #143 merge) with Waves B/C/D/E1 landed. Spec:
`tests-browser/cad-grading-curved-20k3.spec.ts`; fixtures/UI helpers:
`tests-browser/cad-grading-curved-20k3-helpers.ts`; production harness:
`playwright.prod.config.ts`.

## Environment

- **Fresh production build** `npm run build` → `dist/` (Vite, `✓ built in
  11.36 s`), served by **`vite preview`** on `http://127.0.0.1:4175` (no dev
  server, no HMR). Chromium bundled with the repo Playwright
  (`@playwright/test`), headless, one worker, serial.
- Viewports: **1366×768, 1920×1080, 2560×1440** (6 flows × 3 viewports = 18
  tests).
- Flows drive the **real `/cad` shell and the real worker** (`Calculate` →
  `BUILDING` → terminal state). No mocked injection, no hand-assembled
  results: every fixture is a persisted `.wncad` produced through the
  production commands (`GRADING_CREATE` / `GROUP_CREATE`) and
  `serializeCadDrawingFile`, then opened through the real Open Drawing input.
- Command:
  `npx playwright test -c playwright.prod.config.ts tests-browser/cad-grading-curved-20k3.spec.ts`
  → **18 passed (31.9 s)**.

## Flow results (identical verdicts at all three viewports)

| flow | fixture | observed | result |
|---|---|---|---|
| **A** curved Surface tied split | open arc group, `CUT_FILL`, Surface target built from the tilted plane through the mid-arc chord | `Calculate` → BUILDING → **CURRENT**; offline replay certifies `gtop2` **2 components / 2 cycles** (expected 2/2), daylight agreement `null`; **Extract disabled**, **Bake enabled**; **Bake executes** (`GROUPBAKE` committed, `+1` surface, notice `Baked “TiedArc” …`), one **Undo** removes it; a second Undo is disabled (empty stack = no-op) | **PASS** |
| **B** standalone curved Surface | single arc `GRADING_CREATE`, `Fixed -0.5`, flat Surface target | **CURRENT**; `gtop2` **1/1**; notice carries no `GRADING_AGREEMENT_SOURCE_BOUNDARY` and no `GRADING_AGREEMENT_DAYLIGHT_Z`; **Extract and Bake both enabled**; Extract executes (`+1` Feature Line) then one **Undo** | **PASS** |
| **C** all-Surface Design Patch | closed outward rounded-square group (4 arcs), all-`Fixed`, flat Surface target | **CURRENT** → **Build Design Patch enabled** → one `AllSurfacePad - Design Patch [PATCH]` surface (`DESIGNPATCH` committed) → one **Undo** removes → **Redo** restores, with truthful provenance button | **PASS** |
| **D** extra cycle fail-closed | closed 4-arc group bulging **inward** (`bulge -0.4`): the plan chords stay a simple square but the arcs cross (the case the resolver's chord-only loop check cannot see) | never CURRENT; stable `GROUP_NON_MANIFOLD` / `GRADING_GROUP_ARC_SEAM_PINCH` (`boundary not simple cycles: boundary vertex 6 has degree 4`); second Calculate reaches the byte-identical terminal text; Extract/Bake disabled; Inquiry reports **No CURRENT result**; zero entity/surface mutation | **PASS** |
| **E** non-planar Cut/Fill transition | open arc group, `CUT_FILL`, ridge Surface target | never CURRENT; stable `MEMBER_NO_SOLUTION` / `GRADING_SURFACE_SEAM:GRADING_SURFACE_SEAM_TRANSITION_REQUIRED`; Extract/Bake disabled; zero entity/surface mutation | **PASS** |
| **F** arc×arc unsupported | closed rounded-square group with a Surface (`Fixed`) override on course 0 and analytic `Distance` elsewhere (hybrid) | never CURRENT; stable `CORNER_NO_SOLUTION` / `GRADING_SURFACE_ANALYTIC_ARC_PAIR_UNSUPPORTED`; Extract/Bake disabled | **PASS** |

Availability is verified **against execution**, not guessed: where a product
control is enabled the flow executes it and checks the resulting
entity/surface delta plus one Undo; where it is disabled the flow asserts
`disabled` and checks zero mutation.

### Flow A capability detail (Wave E1 authority)

The tied split is a certified multi-region mesh, so the two products diverge:

- `Extract` disabled — one Feature Line cannot represent a disjoint boundary
  (`GRADING_PRODUCT_EXTRACT_MULTI_REGION`); never a silent concat.
- `Bake` enabled — the engine materializes the validated face set 1:1 as one
  explicit-TIN surface; it executes and undoes as a single step.

## Error counts

| viewport | page errors | console errors | unhandled rejections |
|---|---|---|---|
| 1366×768 | 0 | 0 | 0 |
| 1920×1080 | 0 | 0 | 0 |
| 2560×1440 | 0 | 0 | 0 |

Every flow asserts its own zero ledger at teardown (`pageerror`,
`console.error`, `unhandledrejection`), so the table is a count of asserted
empty ledgers, not a sample. No `src/` behavior was changed by this QA wave;
only the spec, helpers, production Playwright config, evidence images and docs
were added.

## Honest findings

1. **The persisted/browser tied split needs the exact arc geometry.** The
   Wave D in-memory fixture (`tiedPlaneTin` over `roundedSquareMembers`)
   certifies 2/2, but a tied-plane target built from *hand-typed* arc
   parameters (`center (50, 247.5), R 252.5`, rounded angles) shifts the plane
   by ~1e-14 and the member chord solve fails closed
   (`MEMBER_NO_SOLUTION`). Flow A therefore derives the target from the exact
   `roundedSquareMembers(10)[0]` source (`Math.tan(sweep/4)` bulge), which the
   persisted round-trip reproduces bit-for-bit. This is an input-precision
   sensitivity of the tie, not a regression.

2. **The 20K.2 `TILT` tied fixture now fails closed.** The 20K.2 Flow A
   fixture (`TILT = 10 + 0.1·(x−50)`, `CUT_FILL`) previously produced a
   2-component mesh (rejected only by the old daylight gate). On this
   worktree the Wave B seam gate rejects the same mesh as
   `GRADING_GROUP_ARC_SEAM_PINCH` (degree-4 boundary vertex). Flow A uses the
   Wave D tied-plane fixture instead; the 20K.2 fixture is recorded here as
   now fail-closed (an honest tightening, consistent with the 20K.3 topology
   contract).

3. **`src/` frozen.** No engine/worker/shell change was needed for the
   browser flows to pass; Wave B/C/D/E1 behavior was validated as shipped.

## Reproduction

- `npm run build`
- `npx vite preview --host 127.0.0.1 --port 4175`
- `npx playwright test -c playwright.prod.config.ts tests-browser/cad-grading-curved-20k3.spec.ts`
- `npx eslint tests-browser/cad-grading-curved-20k3.spec.ts tests-browser/cad-grading-curved-20k3-helpers.ts playwright.prod.config.ts` → clean
- `npm run lint` → 0 errors / 2 pre-existing warnings; `npm run typecheck` → clean; `npm run check:portable-paths` → 0 violations.

PNG inventory (dimensions + SHA-256) is in
`docs/evidence/phase20k3/png-manifest.json`; the pixels are reviewed in
`docs/evidence/phase20k3-visual-qa.md`.
