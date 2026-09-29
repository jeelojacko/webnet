# Phase 20G — Grade to Relative Elevation: browser QA

Real production build, real `/cad` application, headless Chromium. No mocks:
every flow opens a seeded `.wncad` and drives the live ribbon / manager /
Toolspace / Properties / command dock / worker.

## Identifiers

| item | value |
|---|---|
| Branch | `feat/cad-grading-relative-elevation` |
| Base (live `origin/main`, verified) | `23a27721b894673715f8dad90ba8bbd116c6788c` |
| Tested tree | working tree on top of that base (Phase 20G changes, pre-commit) |
| Spec | `tests-browser/cad-grading-relative-elevation-20g.spec.ts` |
| Playwright | 1.60.0 |
| Chromium | Google Chrome for Testing **151.0.7922.34** (`ms-playwright/chromium-1234`) |
| Viewports | 1366×768, 1920×1080, 2560×1440 |
| Spec run time | 23.8 s |

## Exact commands

```bash
npm run build                                     # 11.16 s, fresh production bundle
npx vite preview --host 127.0.0.1 --port 4174     # Playwright reuseExistingServer picks this up
npx playwright test tests-browser/cad-grading-relative-elevation-20g.spec.ts --reporter=list
```

`playwright.config.ts` has `reuseExistingServer: true`, so the production
`vite preview` server is used instead of the dev server. The served `/cad`
bundle is the fresh `dist/` build.

## Result

**14 passed / 0 failed / 14 total** in 23.8 s.

| Flow | 1366 | 1920 | 2560 |
|---|---|---|---|
| A — standalone Relative Elevation (ribbon `GTRE` → UNBUILT → one Calculate click → BUILDING → CURRENT → Properties/Toolspace/Inquiry agreement) | 1.3 s | 1.7 s | 1.8 s |
| B — absolute vs relative on a sloped source | 1.9 s | 1.9 s | 2.0 s |
| D — closed group, family lock, sparse override, CURRENT, corner failure, Extract/Bake | 2.2 s | 2.2 s | 2.2 s |
| Shell regression | 1.2 s | 1.2 s | 1.2 s |
| C — edit + persistence (1366 only) | 1.6 s | — | — |
| E — failure gates (1366 only) | 1.5 s | — | — |

### Error contract — every test, every viewport

| counter | value |
|---|---|
| unexpected page errors | **0** |
| console errors | **0** |
| unhandled promise rejections | **0** |

Asserted empty inside each test, so a regression fails the suite rather than
being reported as a note.

### Flow A — a target surface is not needed

Seeded drawing has **zero surfaces** (`Surfaces (0)` visible in Toolspace).
The ribbon `GRADETORELATIVEELEVATION` control is enabled with only a Feature
Line selected. Create → `UNBUILT`, exactly one Calculate click → `BUILDING` →
`CURRENT`, with Properties showing Method `Relative Elevation`, Δ
`-10.000 m relative` and derived offset `20.000 m`, and grading-**limit**
wording (not daylight).

### Flow B — the two elevation methods are visibly different

Sloped source `Z 100→102`. Both gradings at grade −50 %:

| row | Method cell | projection range |
|---|---|---|
| relative | `Relative Elevation` | `20.00–20.00 m` |
| absolute | `Elevation` | `20.00–24.00 m` |

Both CURRENT. No row, label, or screenshot renders the relative one as plain
"Elevation"; the two Method cells are asserted to differ.

### Flow C — edit + persistence

- Distance → Relative Elevation: criterion commits in one transaction.
- one Undo → the previous Distance criterion is restored; Redo → Relative
  Elevation.
- Relative Elevation → Surface: with no eligible CURRENT target the switch is
  blocked (`Apply` disabled, editor stays open, zero mutation, truthful
  notice); no false success.
- Save `.wncad` → reopen: the definition is still `Relative Elevation`, the
  row is honestly `UNBUILT` with `--` metrics (no result/status persisted).

### Flow D — group and per-course overrides

- Seeded closed flat 100×100 Relative Elevation group (default −50 %, Δ −10),
  no target surface.
- Family lock holds; the per-course editor reports `Relative Elevation` and
  offers no Surface / Distance / Elevation option.
- A valid same-family override (Δ −12) applies and then resets to default.
- Explicit Calculate → CURRENT with grading plan area `9600.000 m²`, four
  corners at `miter 28.284 m` (= 20√2), and CSV/Inquiry agreeing with the
  panel.
- Extract adds exactly one Feature Line and Bake exactly one explicit-TIN
  surface; each is removed by exactly one Undo.
- Then one incompatible per-course override (differing Δ) → `FAILED` with
  `CORNER_NO_SOLUTION`; the diagnostic is byte-stable across repeated
  recalculation, the prior result is retained as stale, Extract/Bake are
  disabled, and the row never reads CURRENT.

### Flow E — failure gates

- Wrong-sign draft: the inline diagnosis reads exactly
  `Criterion: invalid — grade and relative elevation point in opposite directions`
  and Create is rejected with zero rows added (no mutation).
- Zero grade and zero Δ each mark the draft invalid.
- Over-search (valid definition, Δ −20 with max search 30): Calculate fails
  with `MAX_DISTANCE_REACHED` / `GRADING_RELATIVE_ELEVATION_BEYOND_SEARCH`;
  never clamped.
- A drawing with no surfaces still calculates to CURRENT.

No invalid persisted bytes were hand-crafted to drive browser failures —
malformed-kernel cases are covered in the unit suites.

## Shell regression (all three viewports)

| assertion | value |
|---|---|
| ribbon height ≤ 130 px | **120 px** |
| ribbon bands | 1 |
| group row wrapping | `nowrap` (horizontal overflow `auto`) |
| page overflow | none (`docScrollW/H == innerW/H`) |
| Properties palettes | 1 |
| command inputs | 1 |
| Toolspace usable | yes (visible, tabbed, scrollable) |
| viewport usable | yes (345 / 657 / 1017 px tall with the model present) |
| manager contained | yes (manager rect inside the frame) |
| Relative Elevation control reachable | yes (GTRE visible + enabled with a Feature Line selected) |
| flyout clipping | none (arc flyout fully inside the viewport) |

## Screenshot inventory

13 PNGs (12 planned + 1 bounded complementary frame), no downscaling, plus
`geometry.json` (16 recorded states: 13 shots + 3 shell-regression states).

| file | dimensions | bytes |
|---|---:|---:|
| `1366-relative-create.png` | 1366×768 | 151 575 |
| `1366-relative-current.png` | 1366×768 | 170 388 |
| `1366-relative-vs-absolute.png` | 1366×768 | 159 882 |
| `1366-relative-group.png` | 1366×768 | 153 391 |
| `1366-relative-group-areas.png` | 1366×768 | 157 950 |
| `1920-relative-create.png` | 1920×1080 | 216 911 |
| `1920-relative-current.png` | 1920×1080 | 248 178 |
| `1920-relative-vs-absolute.png` | 1920×1080 | 243 620 |
| `1920-relative-group.png` | 1920×1080 | 227 860 |
| `2560-relative-create.png` | 2560×1440 | 265 496 |
| `2560-relative-current.png` | 2560×1440 | 317 643 |
| `2560-relative-vs-absolute.png` | 2560×1440 | 316 749 |
| `2560-relative-group.png` | 2560×1440 | 275 788 |

`1366-relative-group-areas.png` is the one complementary frame: at 1366×768 the
aligned group row and the inquiry body's Areas tail genuinely cannot share one
frame (the create form, row actions and course-inquiry sub-section sit between
them), so the row frame and the report-body frame are captured separately
rather than cropping or overlapping. The budget was 15; 13 were used.

Other suites were **not** re-run and `docs/evidence/phase20f*` was **not**
touched: this phase produced bounded Phase 20G evidence only.
