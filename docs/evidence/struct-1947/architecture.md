# STRUCT-194.7 — CAD shell starter registry + shell-snapshot builder extraction

Branch: `refactor/issue194-cad-shell-registry-snapshots`
Baseline: `7d97568b3a6b8b4dcee2838b24022614f65ffc1b` (exact origin/main, = PR
#221 merge). Refs #194 (`TODO.md` in-progress note; **issue remains OPEN** —
severity not marked solved).

Behavior-preserving only. Two contiguous `src/components/SurveyCadWorkspace.tsx`
seams are extracted into focused UI modules with **zero** engine / schema /
persistence / worker-protocol / hash / history / shell-link / action-ordering /
status-notice / visible-wording change:

1. the Phase 18B **shell starter registry** (`shellStarters`, ~125 lines) →
   `createCadShellCommandStarters(context)`;
2. the Phase 18B **shell-snapshot body** (~115 lines inside the `useMemo`) →
   `buildSurveyCadShellSnapshot(context)`.

The `shellAvailableCommands` memo and the `shellSnapshot` memo keep their exact
positions, hook ordinals, and (for the snapshot) their exact dependency arrays.
The two `shellLink` effects, `notifyActions` cadence, `buildCadWorkspaceShellActions`
composition (fresh every render), LandXML lifecycle, compose lifecycle, late
deletion effects, and the 97-handler `CadShellActions` channel are untouched.

## BEFORE / AFTER (root file)

| Metric | Before | After | Delta |
| --- | ---: | ---: | ---: |
| `src/components/SurveyCadWorkspace.tsx` LOC | 1600 | 1461 | **-139 (-8.7%)** |
| Root primitive hook call sites (`useState`/`useRef`/`useMemo`/`useEffect`/`useCallback` with `<` or `(`) | 93 | 93 | **0** |
| — `useState` | 40 | 40 | 0 |
| — `useRef` | 9 | 9 | 0 |
| — `useMemo` | 25 | 25 | 0 |
| — `useEffect` | 18 | 18 | 0 |
| — `useCallback` | 1 | 1 | 0 |
| Root custom (non-primitive) hook-call sites | 19 | 19 | 0 |
| Inline `shellStarters` literal LOC | 125 | 0 | -125 |

No hook moved: the starter registry was never a hook, and the snapshot memo
stays at its original ordinal because only its callback body changed. The root
remains above the repo 900-line guidance (1461); this is the seventh #194 slice
and the root is smaller, not larger.

## New modules

| File | LOC | Exported fn body | Responsibility |
| --- | ---: | ---: | --- |
| `src/components/surveyCad/cadShellCommandStarters.ts` | 269 | 129 (flat declarative registry, no branching) | Pure `createCadShellCommandStarters(context)` returning the `Record<ActiveCommandKey, (() => void) | undefined>` registry. |
| `src/components/surveyCad/cadWorkspaceShellSnapshot.ts` | 207 | 91 | Pure `buildSurveyCadShellSnapshot(context)` returning the deterministic `CadWorkspaceSnapshot` body. |

Both are UI-side (`src/components/surveyCad/`); the engine never imports them.
Largest module is 269 lines (repo warning 600, hard cap 900). The starter factory
body is a single flat object literal with one conditional (PASTE) — no nested
branching — so the 120-line hard cap's "simple, linear, hard to split cleanly"
allowance applies; the per-command key list is the file's data.

## ACCEPTANCE A — recorded baseline (before this slice)

Baseline root `SurveyCadWorkspace.tsx` (1600 lines):

- **Primitive hook order/count**: 40 `useState`, 9 `useRef`, 25 `useMemo`,
  18 `useEffect`, 1 `useCallback` (93 total) + 19 custom (non-primitive) hook
  call sites. After: identical (0 deltas).
- **Starter registry**: full 122-key `Record<ActiveCommandKey, ...>` with
  `SURVEYTABLE: undefined`; PASTE enabled **only** when
  `copiedEntityIds.length > 0`, capturing the current `copiedEntityIds` array;
  16 `LINE_*` wrappers route through `startLineL1Command(key)`;
  `PARCELSHAREDEDIT` wraps `startParcelSharedEditCommand()`; every other entry
  is the direct method reference. `startCommand(key)` returns `false` for an
  undefined starter (`SURVEYTABLE`) or an unknown key, `true` otherwise.
- **`shellAvailableCommands` memo**: `Object.keys(shellStarters).filter(typeof
  === 'function')` with deps **verbatim** `[copiedEntityIds.length,
  activeDrawing.drawingId]`.
- **`shellSnapshot` memo**: exactly the seven destructured `cadWorkspace` fields
  (`snapPreferences`, `commandInputValue`, `canUndo`, `canRedo`, `historyDepth`,
  `redoDepth`, `annotationSnapshot`); twelve sub-builder calls in
  `survey → surveyTable → parcel → featureLine → grading → gradingGroups →
  blocks → f2f → surface → volume → profile → section` order; null when
  `!shellLink`; publish effect at the same position with deps
  `[shellLink, shellSnapshot]`; zero builder work / zero publish on unrelated
  render, cursor, pan/zoom, or manager rerender; correct rebuild on
  selection / snap / undo / redo / drawing / surface-CURRENT / surface-FAILED
  / worker-state changes; `selectionPreview.slice(0, 200)`; layer entity counts;
  snap status text; source/current/stale grading / volume / analysis / profile /
  section status; `#191` survey point cap.
- **Action channel**: `shellLink.actions = shellActions` every render with no
  dep array (fresh closures, never notifies); `notifyActions()` only on
  `shellLink` mount/unmount via the `[shellLink]` effect.

The equivalence evidence is the pre-existing literal fixtures
(`tests/cad_shell_registry.test.ts`, `tests/cad_shell_snapshot_contract.test.ts`,
`tests/cad_shell_snapshot_memo_184.test.tsx`,
`tests/cad_shell_actions_extraction_1942.test.tsx`) plus the new 1947 suites;
the expected starter order and the twelve-builder order are written as literal
arrays (not derived from the production output).

## ACCEPTANCE B — `createCadShellCommandStarters`

Context (typed, no `any`, grouped, no flat 100-field bag):

```ts
interface CadShellCommandStarterContext {
  workspace: CadShellCommandStarterWorkspace; // narrow Pick<UseSurveyCadWorkspaceResult, 105 starter methods>
  copiedEntityIds: string[];                  // current render's clipboard snapshot
  startPasteFromClipboard: (_entityIds: string[]) => void;
}
```

- **Keyset/order**: return type `Record<ActiveCommandKey, (() => void) |
  undefined>`; the object literal preserves the former insertion order
  (POINT … PASTE), pinned by a 122-entry literal in
  `tests/cad_shell_command_starters_1947.test.ts` and end-to-end by the
  `availableCommands` order in `tests/cad_shell_registry_snapshot_1947.test.tsx`.
- **Gaps/wrappers**: `SURVEYTABLE: undefined`; the 16 `LINE_*` wrappers call
  `startLineL1Command(key)`; `PARCELSHAREDEDIT` wraps
  `startParcelSharedEditCommand()`; all other entries are direct references.
- **PASTE**: absent (undefined) while `copiedEntityIds` is empty; otherwise
  `() => startPasteFromClipboard(copiedEntityIds)` — the closure captures the
  ids observed on the render that built it.
- **Fresh object per call** (no static registry, no global cache, no render-time
  side effect). The root calls it once per render at the former literal position
  and keeps `shellAvailableCommands` on the exact original deps.

## ACCEPTANCE C — `buildSurveyCadShellSnapshot`

- The root keeps the **original `useMemo` in place with the unchanged dependency
  array** (byte-identical; verified:
  `python: snapshot dep array identical: True`). Only the callback body changed.
- The context object is constructed **inside** the memo callback
  (`buildSurveyCadShellSnapshot({ ... })`), so the parent/context object identity
  is never a memo dependency — there is no `[context]` / `[cadWorkspace]`
  dependency and no custom hook was introduced.
- Context is grouped by domain (`drawing`, `selection`, `command`, `history`,
  `snap`, `catalog`, `grading`, `gradingGroups`, `blocks`, `surface`, `volume`,
  `profile`, `section`, `annotation`, `analysis`, `availableCommands`) and the
  sub-builder option objects are typed via the builders' own `Parameters<...>`
  signatures, so no `any` bag and no drift.
- Preserved verbatim: the seven-field destructure, every snapshot field, the
  twelve sub-builder **call order** (pinned by
  `tests/cad_shell_snapshot_build_1947.test.ts` mocking all twelve and asserting
  the exact sequence), source-revision caches (`revisionIndex`, `syncFallback
  Revisions`, building ids, session diagnostics), `selectionPreview.slice(0, 200)`,
  layer entity counts, snap text, `availableCommands`, and the null-when-no-
  `shellLink` guard. No new cache / clone / stringify.
- Root publish effect stays at the same position with deps
  `[shellLink, shellSnapshot]`; `notifyActions` is untouched.

## Preserved contracts

- `#183` pointer channel / cull, `#184` snapshot memo + point cap, `#185`
  surface revision + contour race, `#186` viewport filter, `#189` selection
  retirement, `#191` point cap — green.
- `#194.1`–`#194.6` extractions untouched.
- 97 `CadShellActions` keys and signatures; `buildCadWorkspaceShellActions`
  still composed fresh every render (never memoized).
- No engine geometry / schema / hash / worker-protocol / persistence change.

## Remaining #194 roadmap

1. The `buildCadWorkspaceShellActions({ core, civil, linear, grading })` call-site
   input assembly (~120 lines of grouped context at the call site) and the
   remaining geometry/snapshot handler bodies — deferred to `#194.8` to avoid a
   giant flat props bag.
2. Root is still 1461 lines (repo 900-line guidance). Honest progress: 1600 →
   1461 (−139).
