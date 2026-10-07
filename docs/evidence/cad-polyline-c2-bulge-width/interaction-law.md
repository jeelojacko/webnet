# Phase C2 — PLINE interaction law (spec §6)

Session law for the PLINE Arc/Line/Width draft. All constants live in
`src/hooks/surveyCad/useSurveyCadPlineSession.ts`; the dock branch runs at the
top of `submitSessionInput` (`useSurveyCadCommands.ts:285`) BEFORE any point
parse, and viewport picks route through the same point law
(`useSurveyCadConsumePoint.ts:155`).

## 1. Reserved tokens and draw modes

`parsePlineSessionOption` (line 44) matches the input **whole-token,
case-insensitively** before any point parse:

| Token | Effect |
|---|---|
| `A`, `ARC` | switch to arc mode (3-point bulged legs) |
| `L`, `LINE` | switch to line mode; refused while a through-point is pending |
| `W`, `WIDTH` | enter the width-setting phase |
| `C`, `CLOSE` | close the ring (see §4) |
| `U`, `UNDO`, `BACKSTEP` | session-local backstep (never a history edit) |

There is deliberately **no `B` alias** and no other single-letter option, so
coordinate/bearing strings such as `N45-00-00E,100` are never stolen.
`plineDrawMode` is `'line' | 'arc'`, defaulting to line when absent (legacy C1
sessions). A new PLINE starter seeds `line`, no through-point, width phase
false, and a zero default width (`useSurveyCadCommandStarters.ts:126`).

## 2. Line legs and arc legs (through-point)

- **Line mode**: every accepted point after the first appends one straight
  course (`consumePlineDraftPoint`).
- **Arc mode**: the first point after a completed vertex is the pending
  **through-point** — it is NOT a vertex and appends no course. The next
  point is the arc END and completes exactly one bulged course via
  `completePlineArcLeg` (line 155): START = last completed vertex, THROUGH =
  pending, END = new point. The bulge derives from the shared parcel seam
  (`cadPolylineBulgeFromThreePoints` → `describeParcelArcCourse`).
- Degenerate triples fail closed with a truthful reason and **keep the
  through-point**: coincident/zero-chord, collinear or ~360° sweep, or a
  derived arc that fails validation. No chord is fabricated. After completion
  the draft stays in arc mode with no pending point.
- While a through-point is pending the relative/bearing base point is the
  through-point (`useSurveyCadCommandConstruction.ts:170`).

## 3. Width grammar and persistence

`W`/`WIDTH` sets `plineWidthPhase = true` and shows
`PLINE_WIDTH_PROMPT_MESSAGE`. The phase owns bare numeric input:

- `parsePlineWidthInput` (line 125): one finite non-negative number
  (`^(\d*\.?\d+)$`) = constant pair; two comma-separated finite non-negative
  numbers = tapered `start,end`; `0` resets to hairline. Anything else is
  rejected with `PLINE_WIDTH_INVALID_MESSAGE`, stays in the phase, and
  mutates nothing (never partially applied).
- A valid value stores `plineDefaultWidth` and applies to **future segments
  only**; it persists across mode switches and is never changed by backstep.
- The width subprompt is **strictly modal**: only `U`/`UNDO`/`BACKSTEP`
  (cancel, default unchanged) and the width grammar above are consumed. Every
  other non-empty input — typed coordinates (`A=10,20`, `@0,10`,
  `N45-00-00E,100`, `LABEL=1,2`), option tokens (`A`/`L`/`C`/`W`), and plain
  text (`nope`) — is an **invalid width**: the point parser is never reached,
  no vertex or geometry is added or removed, the default width is unchanged,
  no model/history write occurs, and `PLINE_WIDTH_INVALID_MESSAGE` stays
  visible in the width phase. The operator must `U`/`BACKSTEP` out before
  choosing an option. A raw comma pair (`10,20`) is always a tapered width
  (10 → 20), never a coordinate, while in the phase.

## 4. Close law

`C`/`CLOSE` commits `closed:true` when 3+ retained distinct vertices exist
(`canClosePlineSession`). `commitPlineSession` (line 243):

- **Line mode**: appends one straight closing course (last→first) with the
  current default width.
- **Arc mode with a pending through-point**: appends one bulged closing arc
  derived from last vertex → through-point → first vertex (validated the same
  way as any arc leg).
- **Arc mode without a pending through-point**: refuses, session stays
  active, verbatim message:
  `PLINE Arc Close: pick an arc-through point first, or switch to Line then Close.`
- A closed ring stores **no duplicate closure vertex**; an explicitly repeated
  final vertex is stripped instead of duplicated. Below the 3-distinct gate
  the message is `PLINE Close needs at least 3 distinct vertices.`

## 5. Backstep priority and alignment

`backstepPlineSession` (line 213) drops exactly one layer per call, in order:

1. An active **width prompt** is cancelled (default unchanged) and
   `PLINE width entry cancelled; the default width is unchanged.` is shown.
2. A **pending through-point** is cleared alone.
3. Otherwise the newest completed vertex is removed **together with its
   incoming geometry/width entry**, keeping the metadata arrays aligned. At
   zero points the message is `PLINE nothing to undo.` and the session stays
   active.

Backstep is session-local: it never writes model history and never calls the
global Undo.

## 6. Enter / Escape

- Empty `Enter` while the width prompt is open cancels the prompt (default
  unchanged), draft stays active (`useSurveyCadCommandLifecycle.ts:160`).
- Empty `Enter` otherwise commits an **open** polyline of the completed
  segments only (a pending through-point is ignored) when 2+ retained
  vertices exist. Below that the session stays active with
  `PLINE needs at least 2 distinct vertices to finish.`
- `Escape` cancels the draft with zero mutation.
- A commit is exactly one entity in exactly one undo entry.

## 7. Prompts (resultText precedence first)

`plinePromptForSession` (`useSurveyCadCommandText.ts:37`) always names the
live mode and the option set, keeps the C1 substrings (`N vertices captured`,
`first vertex`), and appends the active non-hairline width compactly
(`W=2.500` or `W=2.000→8.000`). Arc-mode states call out the through-point /
arc-end step. Any engine/session `resultText` (gate, rejection, commit,
or cancel message) overrides the count prompt until the next capture or
backstep. Help text (`useSurveyCadCommandHelpText.ts:61`) documents
`A/L/W`, `C`, `U`, Enter, the 3-point law, and the future-segments width law.
