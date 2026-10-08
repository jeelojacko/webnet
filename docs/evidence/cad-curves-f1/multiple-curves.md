# CAD Curves F1 — Multiple Curves Operator Note

`MULTIPLE_CURVES` builds 2–10 tangent curves between two picked lines with
exactly one floating curve (its length is solved; the rest are fixed).

## Session flow

1. Click the first line body, then the second. A two-line selection preseeds
   both slots (midpoints); a single-line selection preseeds the first slot.
2. Type the count: `3`, `N=3` (range 2–10).
3. Type the floating curve number: `F2` or bare `2` (1-based). The floating
   curve keeps its typed radius; its length is solved from the turn residual.
4. Type one `Llength,Rradius` entry per curve in order (`L120,R200`,
   `R200,L120`, or bare `120,200`). The full chain previews (bounded: ≤10
   arc primitives) before anything commits.
5. Press Enter to commit all arcs in **one** undo entry. Sources stay
   byte-unchanged. `U`/`UNDO`/`BACKSTEP` removes one entry at a time
   (segments, then floating index, then count, then lines). `Esc` cancels
   with zero mutation.

## Laws

- Every non-floating curve turns the chain way:
  `Δ_i = turnSide · L_i / R_i`. A floating residual with the opposite sign
  (or zero) is `CURVES_CANNOT_FIT`: the session stays active, nothing
  commits, and `U` edits the last entry.
- Negative non-floating lengths are rejected at parse (the floating length
  placeholder still requires a positive finite number; it is ignored by the
  kernel).
- The chain walks G1 from PC on ray 1 to PT on ray 2; the final tangent
  equals the second ray. Placement solves PC on ray 1 by chain displacement.
- The report lists every curve (`R`, `L`, floating flag) in deterministic
  index order.
