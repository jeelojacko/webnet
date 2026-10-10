# STRUCT-241.8 Validation

Branch: `refactor/issue2418-tin-provenance-surface-edit-types` at
`539e87d58d9a3690bd1e69653312ce5ef2b60f8e` (exact main, ff-only, no
reset/force; 14 stashes preserved; `.pi/lsp.json` untouched).

## Source/AST and emit parity

- 11/11 + 14/14 leaf declarations byte-identical vs hub baseline regions
  (Worker A + Worker B diff proofs; parent independently re-verified
  post-integration: PROV BYTE-IDENTICAL true, EDIT BYTE-IDENTICAL true;
  127-test suite pins shapes, optionality, discriminants, union orders, and
  JSDoc positions/markers).
- Hub retains grouped `import type` + `export type` of all 25; zero leftover
  original declarations (grep for the 25: empty).
- `CadSurfaceDefinition` (`edits?: CadSurfaceEdit[]`,
  `importedTin?: ImportedTinPayload`,
  `sourceKind?: 'native' | 'imported-tin' | 'explicit-tin'`) and all 5 runtime
  value exports (`surfacePointGroupIds`, `isExplicitTopologyDefinition`,
  `isExplicitSurfaceDefinition`, `isNativeSurfaceDefinition`,
  `isImportedTinDefinition`) stay in the hub (suite-pinned).
- `CadEntity` 19-member order, `CadBlockChild` 6-member order + parabola
  exclusion preserved (tsc clean, suite-pinned).
- Leaf stripped emits: `export {};` (both). Hub emit byte-identical:
  transpileModule-stripped 680 bytes sha256
  `3744535788de61cc48666898669382da2312a59764ce06a96dc017936319d454` —
  same as the 241.7 baseline pin (independently recomputed post-change with
  `removeComments: true`).
- No value-graph edges changed; no consumer rewritten.

## Graphs (measured, not guessed)

- CAD+F2F: 495/2440 -> 497/2444 (+2 nodes / +4 type edges: provenance 0 out +
  hub import + hub export; edit 0 out + hub import + hub export; no retired
  hub edge; multiplicity-checked per key). Full src: 1667/7551 -> 1669/7555
  (same allowlist; every 241.8 edge resolves inside `src`).
- Scoped value/mixed 1585 edges / 1567 pairs digest `0bc9bae1…fcb7` unchanged;
  full value/mixed 4444/4385 digest `415f97f0…2448` unchanged.
- Scoped VALUE/TYPE SCC 0/0; full VALUE 0, TYPE 7 SCC / 38 modules.
- Historical SHAs, exact edge fixtures, graph-negative controls preserved;
  only affected count guards rolled forward (2412/2413/2414/2415/2416/2417
  counts, 2413 hub line count 1048, 19511/19512/19514 delta consts), each with
  a documented 241.8 allowlist. No weakening/deletion/skip.

## Test evidence (observed, not fabricated)

- New suite: 127/127 pass (one initial negative-control target corrected:
  analyticKinds flip hits the design-patch first occurrence; re-ran green).
- Prior suites rolled forward and green: 2411 (40/40 unaffected), 2412/2414/
  2415/2416/2417 counts, 2413 (65/65 incl. line count), 1957/19511/19512/19514
  (112/112 across 4 files).
- Neighbours green (observed): surface TIN/topology/bake/compose/edits/
  persist (88/88 across 6 files), point-edits/LandXML/downstream/
  transactions/19510/1959/lifecycle (115/115 across 6 files).
- `npx tsc --noEmit` clean; `npm run lint` 0 errors (9 pre-existing warnings);
  `npm run check:portable-paths` 6384/0; `npm run build` clean (11.57 s).
- `npm run test:agent`: PENDING at doc-write time (run once pre-PR; record
  outcome in PR body).
- Exact-head GitHub CI (5 jobs) is authoritative; controller merges.

## Reviewer disposition

- APPROVED: three fresh independent read-only review rounds (openai-codex/gpt-6-sol).
  Round 1 blocked on one P2 (worktree-hygiene check inside the negative-controls
  describe overstating the control count); remediated same-phase (hygiene moved
  to its own describe, claim corrected to 20 controls + hygiene check; suite
  re-ran 127/127). Round 2 blocked on one P2 (stale "21" claim lingering in the
  architecture.md Risks section); remediated same-phase (one docs sentence;
  grep-verified absent repo-wide). Round 3 APPROVE of the exact integrated
  state: 25/25 byte-identical moves, import-free leaves, hub emit 680 B
  37445357, measured +2/+4 graphs, limited guard roll-forwards, clean hygiene.

## Worktree hygiene

- `git status`: only intended files (2 new leaves, hub splice, new suite,
  rolled-forward guards, TODO, docs). No unrelated edits, no fixture
  overwrites, no settings changes.
- 14 user stashes preserved in identical order (verified before/after).
- Ignored PRIVATE Study Desktop real-data fixtures untouched.
- Historical THREE unrelated local-only study-desktop failures may appear in
  `test:agent`; not touched, not "fixed".
