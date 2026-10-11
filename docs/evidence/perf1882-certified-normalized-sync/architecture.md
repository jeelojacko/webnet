# PERF-188.2 — Certified-normalized persistence sync: architecture

- Baseline: `92ba37e15f4e47ce1853e86bb3359b139975e64a` (PR #262 merge, PERF-188
  wrapper no-op guard + clone-then-compare persistence path).
- Branch: `perf/issue1882-certified-normalized-sync` (from the pinned merge, no
  rebase, no force push).
- Refs #188 only — the parent owns issue state and PR creation. 14 pre-existing
  stashes, ignored fixtures, and `.pi/lsp.json` untouched.

## Problem

PERF-188 (#188, PR #262) removed the wrapper's redundant clone on history
no-ops but deliberately kept the persistence effect cloning **before** it can
compare:

```ts
const nextState = cloneCadDrawingDocument({ ...current, project: cadProject, ... });
if (sigSame && layoutSame && labelsSame) return current; // discard the clone
return nextState;
```

That clone is the normalization boundary and cannot be skipped on a raw
signature match: `cloneCadProject` sets `version: 2`, defaults
`cogoComputations`, migrates legacy `pointGroupId -> pointGroupIds`, sanitizes
surface purpose, and rebuilds nested key order; the drawing clone also
re-sanitizes the draft. A controlled/legacy drawing can be raw-equal to
`cadProject` and still owe normalization.

The one case where the clone is provably redundant is when the parent document
is *already* the wrapper's own ownership-boundary clone for the *same* inputs.
On every genuine commit the wrapper clones first (to publish an independent
document) and then the persistence sync clones a second, equal copy that it
immediately discards. That second clone is the 2 -> 1 target.

## Design — a per-workspace provenance certificate

`useSurveyCadWorkspacePersistence.ts` exports a small per-instance hook
`useCadNormalizedSyncCertificate(drawing, resetKey)` that owns one `useRef`
holding a single, most-recent record (`CadNormalizedSyncCertificate`), written
**only** where the wrapper's `cloneCadDrawingDocument` call produces its
published document:

```ts
{ publishId, owned, drawingId, sourceProject, layoutRef, labels }
```

`useSurveyCadWorkspacePersistence` receives that handle and returns `current`
untouched **iff all** hold:

- `current === cert.owned` — the parent document is the exact wrapper clone,
- `current.drawingId === cert.drawingId`,
- `cadProject === cert.sourceProject` — same history project reference,
- `parcelLayoutState === cert.layoutRef` — same layout reference,
- `showParcelLabels === cert.labels`.

Every check is **reference/identity** equality. There is no extra signature
traversal, no canonical comparator, no global cache/`WeakSet`, no mutation, no
`deepFreeze`, no marker smuggled into a persisted object, and no module-scoped
mutable state. The certificate holds only plain references.

`publishId` is internal sequencing: React StrictMode double-invokes the state
updater in dev and keeps the first produced value, so `beginPublish()` mints
one id per wrapper publish and `record(...)` stores only the first clone for
that id (replayed invocations are ignored).

Because `cloneCadDrawingDocument` is the same normalization the persistence
sync would run, an `owned` document certified for these inputs is already
canonical. Skipping the clone is therefore exactly the existing `sigSame &&
layoutSame && labelsSame -> return current` outcome, without paying for the
clone that would be discarded.

### Invalidation / fail-closed

- Any mismatch (external publish, drawing switch, layout or label change,
  different source project) falls through to the **unmodified clone-first
  path** — nothing about the normalization behavior changes.
- A hygiene effect inside `useCadNormalizedSyncCertificate`, keyed on
  `[drawing, resetKey]`, clears the certificate when the current drawing is not
  the certified one (drawing switch, external open/linked-rerun publish) **or
  when the reset key changes even if the parent hands back the exact same
  drawing reference** (a tracked previous-reset-key ref, `useRef(resetKey)`).
  A reset rebuilds the history baseline, so no certificate can survive it. The
  hook is called before the persistence hook so this effect runs first; an
  identity miss alone already fails closed, so this is defense in depth.
- The persistence effect's dependencies are unchanged and in the same order:
  `[cadProject, onDrawingChange, parcelLayoutState, showParcelLabels]`
  (`cert` is a ref and is intentionally not a dependency; `drawing` is still
  intentionally excluded).

### Boundaries intentionally preserved

- The **first** (ownership-boundary) clone is never removed: its output is the
  independent published document, and the certificate now documents it.
- No engine clone/serializer file is touched (`cadDrawingFile.ts`,
  `cadPersistence.ts`, clone helpers), nor `useSurveyCadDrawingSource.ts`, the
  history hook, shell wiring, or any other `cloneCadDrawingDocument` caller.
- The legacy `onPersistedStateChange` fallback rebuilds an equivalent document
  on every persisted write, so `current !== cert.owned` there by construction
  and the clone-first path runs — an honest residual, never a raw-equality
  short-circuit.

### Single publish site + draft-clear correction

The wrapper's two former draft/no-draft publish branches were collapsed into
one so the certificate is written from exactly one place. The collapse also
corrects the cleared-draft case: the expression is
`...(propagatedDraft !== undefined ? { draft: propagatedDraft ?? undefined } : {})`.

- `undefined` (draft unchanged) omits the key, so the sticky current draft is
  retained by the clone.
- a non-`undefined` draft is always published, **including a cleared draft**
  (`null`, e.g. a `PROJECTTRANSFORM` draft reverted by undo). The boundary maps
  `null -> undefined` because `CadDrawingDocument.draft?: DraftDocument`; at
  runtime `cloneCadDrawingDocument` rebuilds a **blank** draft for a
  null/undefined draft (`sanitizeDraftDocument(...) ?? createBlankDraftDocument`),
  so the sticky previous draft is not retained. (`propagatedDraft !== undefined`
  with a literal `draft: null` does not typecheck.)

This is a small deliberate behavior correction versus the pre-change code,
which used the falsy test `propagatedDraft ? ...` and therefore omitted `null`
(sticky). The existing draft/sheet/project-transform suites cover the transform
draft path.

## Residual and negative-control posture

- Controlled commit/undo/redo, batched commits, LandXML imported-TIN commit,
  draft/`plotFrame:false`, layout and label propagation: the skipped clone is
  real (provenance), not content guessing.
- Non-canonical mounts (legacy `pointGroupId`, reordered imported TIN, unknown
  surface purpose) still normalize; a raw-signature bypass would leak them.
- External/nested updates and drawing switches never carry the certificate.
