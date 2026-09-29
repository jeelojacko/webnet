# Phase 20G — Grade to Relative Elevation: visual QA

Bounded review of the 13 Phase 20G screenshots in `docs/evidence/phase20g/`.
No Phase 20F image was reopened, re-reviewed, or copied: this document covers
Phase 20G frames only.

Review method: an independent **vision-capable reviewer** opened every PNG and
reported what it actually sees (an OCR pass was attempted first and rejected as
unreliable on this dark, small-text CAD UI — it garbled labels, so it was not
used as a gate). The reviewer ran twice: once over the original 12 frames and
once over the recaptured/replacement frames. Visual review was combined with a
deterministic `geometry.json` box audit and with DOM assertions captured at the
moment each screenshot was taken.

## Per-image review

| image | what it visibly shows | verdict |
|---|---|---|
| `1366-relative-create.png` | Method **Relative Elevation**, signed grade `50` **Down** (`-50.000%`), `Relative elevation (m)` input `-10`, the help text "Positive = above source; negative = below source.", and the summary `relative elev -10.000 m · offset 20.000 m`. | PASS |
| `1366-relative-current.png` | CURRENT `Relative Elevation` row with `20.00–20.00 m`; Properties shows Method **Relative Elevation**, `-10.000 m relative`, derived offset `20.000 m`, status Current, and **Grading Limit vertices**. | PASS (recaptured) |
| `1366-relative-vs-absolute.png` | Two CURRENT rows in one frame: **Relative Elevation** `20.00–20.00 m` and **Elevation** `20.00–24.00 m` — the two methods and their differing projection ranges are visibly distinct. | PASS |
| `1366-relative-group.png` | The `RelGrp` row with **Relative Elevation**, `Target: Relative Elevation -10.000 m relative · grade -50.000%`, `Extract Grading Limit`, and the course detail showing `Default` with `-10.000 m` / `offset 20.000 m`. | PASS (recaptured) |
| `1366-relative-group-areas.png` | `Areas: plan 9600.000`, `Grading Limit vertices: 12`, and four corners each `miter 28.284 m`. | PASS (new complementary frame) |
| `1920-relative-create.png` | Same required fields + summary; no required field occluded. | PASS |
| `1920-relative-current.png` | CURRENT row `20.00–20.00 m`; Properties with method, `-50.000%`, `-10.000 m relative`, `20.000 m`, **Grading Limit vertices**. | PASS |
| `1920-relative-vs-absolute.png` | Two distinctly named CURRENT rows with `20.00–20.00 m` vs `20.00–24.00 m`. | PASS |
| `1920-relative-group.png` | Inquiry with target `-10.000 m relative`, Current, `Areas: plan 9600.000`, `Grading Limit vertices`, `miter 28.284 m`. | PASS |
| `2560-relative-create.png` | Same required fields + summary at 2560. | PASS |
| `2560-relative-current.png` | CURRENT row + Properties with method, grade, Δ, derived offset and `Grading Limit vertices`. | PASS |
| `2560-relative-vs-absolute.png` | Two distinctly named CURRENT rows and differing ranges. | PASS |
| `2560-relative-group.png` | Target, Current status, `9600.000` plan area, Grading Limit, `28.284 m` miters. | PASS |

## Findings round 1 (first 12 frames) — 2 blocking, 2 non-blocking

1. **High / blocking** — `1366-relative-current.png` could not show
   `Grading Limit vertices` in Properties (that palette section was below the
   frame). **Fixed**: the Properties dock's limit line is now scrolled into
   view before the shot; the single frame now shows the CURRENT row *and* the
   grading-limit Properties rows.
2. **High / blocking** — `1366-relative-group.png` did not show
   `Areas: plan 9600.000`, so the frame could not substantiate its claim.
   **Fixed**: the primary frame now opens on the aligned group row, and one
   bounded complementary frame `1366-relative-group-areas.png` carries the
   Areas / miter / vertex-count evidence. At 1366×768 the row and the report
   body genuinely cannot share one frame (create form + row actions + course
   inquiry sit between them), so two frames were used rather than cropping or
   overlapping. 13 PNGs used of a 15 budget.
3. **Low / non-blocking** — 1366 create/vs-absolute managers are internally
   scrolled, so their headings are offscreen. A scroll-to-top trial was
   attempted and **reverted** because it pushed the required relative field,
   the summary, and the comparison rows out of frame. Approved as-is.
4. **Low / non-blocking** — group frames show Feature Line Properties rather
   than a group object; the group claim is carried by the group inquiry panel.
   Accepted; the inquiry is the authoritative group surface.

## Findings round 2 (recaptured frames)

Both blocking findings resolved. One remaining **non-blocking** note: the
`1366-relative-group-areas.png` producer comment had over-claimed a member
`Default Relative Elevation` line that is scrolled out of that frame — the
default `Δ` is visible in `1366-relative-group.png` instead. The over-claiming
comment was corrected to match what the frame actually shows; no recapture was
needed because the evidence was already complete across the two frames.

Round-2 verdict: **APPROVE WITH NOTES**. No image is now missing a claim that
the inventory does not carry collectively.

## Cross-image checks

- `Relative Elevation` is never rendered as plain `Elevation` anywhere. The
  plain `Elevation` label marks only the absolute comparison row.
- The absolute-vs-relative distinction is visible on screen in every
  `relative-vs-absolute` frame (both Method cells *and* the differing
  projection ranges).
- Exactly one Properties palette and one command input per frame; a single
  ribbon band at 120 px (≤ 130); no page or frame overflow; no flyout clipped
  at the frame edge; no two-band ribbon.
- No downscaling or cropping was applied to any PNG; all frames are full
  viewport at their nominal resolution.
- No product UI change was made for any framing fix, so no previously approved
  frame had to be discarded for staleness — only the frames whose framing
  changed were recaptured.
