# CAD Draw Phase L1 — interaction laws

The 16 Line-creation modes share one drafting/commit contract; only the capture
grammar differs. All engine conventions come from Worker A's
`src/engine/cad/cadLine*.ts` and are reused, never reimplemented.

## 0. Shared laws

- **Deterministic labels (provenance, not label text):** survey-point picks
  keep their real station ids, **including purely numeric ids** (`1`, `42`) and
  ids that look auto-generated (`CAD1`, `tp2`) — never rewritten to `L<n>`. A
  point is an authoritative station id by *provenance* (its snapped source
  entity is a `survey-point`, or it was resolved from a station id), never by
  matching the label against a pattern. Free endpoints get deterministic
  operator labels (`L1`, `L2`, …; shot endpoints `S1`, …), assigned by capture
  order so the two ends of one segment can never both be `L1` (e.g. `LINE_NE`
  `0,0`→`100,50` is `L1`→`L2`, not `L1`→`L1`). Only empty/auto `x,y` labels
  (unprovenanced) are replaced.
- **Bounded point ranges:** `LINE_POINT_RANGE` expands at most 4096 points per
  request (total across tokens); endpoints must be safe integers. Unsafe or
  oversized input is rejected before any allocation — no expansion loop.
- **One-batch-undo (creates):** Enter (or a mode-specific complete-enough input)
  commits the ordered draft as ONE `LINE_CREATE_BATCH` undo entry. Esc cancels
  with zero mutation; an invalid token leaves the session active with an
  explicit `resultText`.
- **Extension edits in place:** `LINE_EXTENSION` is a `GRIP_EDIT`, never a new
  entity; id / layer / metadata / labels are preserved and it is one undo entry.
- **Chain backstep:** `U` / `UNDO` / `BACKSTEP` drops the newest captured
  segment (or the pending anchor) locally, with no history entry. For
  ANGLE/DEFLECTION it also rewinds the reference course to the restored draft
  (the last remaining segment becomes the next reference; an empty draft clears
  the reference so the operator must recapture it). `SIDE_SHOT` is the fixed-origin
  exception: `U` drops only the newest shot and preserves the occupied point and
  reference direction (an empty draft keeps the occupy so a new shot can still
  be entered).
- **No NaN/Inf/tiny lines:** every engine resolver rejects non-finite input and
  degenerate results; the batch builder rejects any segment below
  `CAD_LINE_DEGENERATE_FLOOR` (1e-9 per axis) atomically.

## 1. Key table

| Key | Capture | Grammar / picks | Commit |
|---|---|---|---|
| `LINE_POINT_RANGE` | typed | `1-3,7,10-8` inclusive integer ids (≤4096 points total) | resolves every id, commits the chain atomically |
| `LINE_POINT_OBJECT` | pick | 2+ real survey points in order | Enter commits |
| `LINE_POINT_NAME` | typed | exact station ids, comma-separated | resolves every id, commits atomically |
| `LINE_NE` | typed | `Northing,Easting` (N first) | 2+ pairs then Enter |
| `LINE_GRID_NE` | typed | grid `Northing,Easting`; drawing CRS required | 2+ pairs then Enter; fails closed without CRS |
| `LINE_LATLONG` | typed | `latitude,longitude` decimal degrees | 2+ pairs then Enter; projected via drawing CRS |
| `LINE_BEARING` | pick/typed start + typed direction | `bearing,distance` | Enter after 1+ segments |
| `LINE_AZIMUTH` | pick/typed start + typed direction | `azimuth,distance` (0=N, CW) | Enter after 1+ segments |
| `LINE_ANGLE` | reference (selection or 2 picks) + start pick + typed | `L|R angle,distance` from the occupy→backsight ray | Enter after 1+ segments |
| `LINE_DEFLECTION` | reference (selection or 2 picks) + typed | `L|R angle,distance` from the forward course | Enter after 1+ segments |
| `LINE_STATION_OFFSET` | typed | `station,offset` pairs on one selected alignment | Enter after 1+ segments; out-of-range rejects |
| `LINE_SIDE_SHOT` | occupy + reference pick + typed | `B/AZ/TL/TR/DL/DR angle,distance` from a FIXED occupy | Enter after 1+ shots; `U` drops the newest |
| `LINE_EXTENSION` | source line pick near an end + typed | signed delta or `T<length>` / `TOTAL=<length>` | `GRIP_EDIT` in place |
| `LINE_FROM_END` | source pick near an end + typed | distance | new collinear/tangent line |
| `LINE_TANGENT_POINT` | arc/circle pick + from-point pick | pick side chooses the branch | commits on the second pick |
| `LINE_PERP_POINT` | line pick + from-point pick | exact perpendicular foot | commits on the second pick |

## 2. Direction conventions (reused from Worker A)

- Azimuth `0° = North`, clockwise positive.
- Bearing via `cadParseBearingDegrees` (quadrant / decimal / DMS).
- Turned angle measured from the occupy→backsight ray; **right = clockwise (+)**.
- Deflection measured at the line end from the forward course; **right = clockwise (+)**.
- Offset is **left-positive**.
- Side-shot prefixes are mandatory (`B`, `AZ`, `TL`, `TR`, `DL`, `DR`) so a bare
  `L30,100` can never be silently mis-read.

## 3. Mode notes

- **ANGLE disambiguation:** the start pick is resolved to the reference end it is
  nearest; a near-midpoint tie fails closed (`pickCadLineReferenceStartEndpoint`)
  and the operator repicks. The just-created segment becomes the next reference.
- **DEFLECTION chain:** the base is the forward endpoint; the created segment
  becomes the next reference.
- **STATION_OFFSET:** the alignment is never modified; only resolved points are
  drawn.
- **SIDE_SHOT:** every shot is an independent ray from the fixed occupy
  (`resolveCadLineSideShots`); shots are never chained end-to-end. `U` removes
  the newest uncommitted shot only and leaves the occupy/reference untouched, so
  post-`U` shots still start at the same origin and a `U`-to-empty draft keeps
  the occupy.
- **TANGENT/PERP:** `resolveCadLineTangentFromPoint` takes an explicit `side`
  intent derived from the source-body pick location. Two tangent rays exist, so
  a body pick that is collinear (to the degenerate floor, normalized) with the
  from point and the circle center carries no side information: it is refused
  as **ambiguous** with an explicit `resultText` and no geometry, and the
  session stays active so the operator can restart with an unambiguous pick.
  The finite arc sweep is still enforced (`OFF_SWEEP` otherwise).
  `resolveCadLinePerpendicularFoot` returns the unique exact supporting-line
  foot — a single ray, so it has no branch to disambiguate and needs no such
  refusal.
- **FROM_END:** line → collinear, arc → true tangent at the selected endpoint,
  open polyline → terminal segment only; closed polylines and circles reject.
- **EXTENSION:** signed delta or explicit total; the opposite end is fixed; a
  midpoint tie repicks; locked/hidden lines reject; labels are preserved.

## 4. Session text law (B2 dock)

L1 session input uses the B2 `commandInputValue` single-buffer law: while a
session runs, the dock owns the live `inputValue`; autocomplete is hidden and
typed `LINE_*` text is never hijacked. Help (`cadLineL1HelpText`) and prompt
(`cadLineL1Prompt`) are per-mode and truthful about the remaining capture.
