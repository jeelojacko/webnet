# Phase C1 — interaction law

## Typed session tokens

While a `PLINE` session is active the command input is a single buffer. On
Enter, the input is matched whole-token and case-insensitively BEFORE any
point parse:

| Input | Effect |
|---|---|
| `C`, `CLOSE` | Close the ring when 3+ retained distinct vertices exist; otherwise stay active and show `PLINE Close needs at least 3 distinct vertices.` |
| `U`, `UNDO`, `BACKSTEP` | Session-local backstep: drop the newest captured vertex, clear the input. Never a model edit, never an engine/global-Undo call. |
| anything else | Normal point/relative/bearing parse, unchanged. |

There is deliberately no single-letter `B` alias (it would collide with
coordinate/bearing entry). `N45-00-00E,100`, `@90,10`, `x,y`, and
`LABEL=x,y` are never interpreted as options.

## Backstep semantics

- 0 captured points -> `PLINE nothing to undo.`, session stays active.
- 1 captured point -> zero points (repeatable down to zero).
- N captured points -> N-1.
- After a backstep the relative base point for the next typed point is the
  new last captured vertex.
- Clearing `inputValue` and `resultText` on backstep means a stale
  Close/error message never lingers.

## Commit gates

- Empty Enter: commits an open polyline (`closed:false`) when 2+ retained
  vertices exist; no commit below that.
- `C`/`CLOSE`: commits a closed ring (`closed:true`) when 3+ retained
  distinct vertices exist. A repeated final vertex equal to the first is
  redundant under the 1e-9 law and does not count toward the 3.
- A commit is exactly one entity in exactly one undo entry. Layer/selection
  follow the existing PLINE behavior.
- Escape cancels the draft with zero mutation. Clicking the first vertex does
  not auto-close.

## Prompts (resultText precedence first)

- 0 vertices: first vertex `[Undo]`.
- 1 vertex: next vertex `[Undo]`.
- 2 vertices: next vertex or Enter to finish open `[Undo]` — no Close yet.
- 3+ vertices: Enter to finish open, or Close `[Close/Undo]`.
- Any engine/result text (Close gate, nothing-to-undo, commit prompt)
  overrides the count prompt until the next capture or backstep.

## Preview

The live draft keeps the points+cursor law. A backstep shortens the preview
immediately with no phantom segment. Open drafts never render a permanent
closure segment; the closing edge appears only after a closed commit.
