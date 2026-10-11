# STRUCT-241.16 Validation

Branch: refactor/issue24116-sheet-viewport-polyline-topology-command-types.
Base: 82cce548b3af56c0802d7b0be98bb8a0b5cf28c0.

## Suites (real runs)
- New tests/cad_sheet_viewport_polyline_topology_command_type_leaves_24116.test.ts:
  67/67 pass (parent re-ran focused: 67 passed, 21.57s).
- Historic roll-forward (worker run): 24116 (67) + 2411/2412/24111 (134) +
  24112/24113/24114/24115 (277) + 2413/2414/2415/2416 (309) +
  2417/2418/2419/24110 (421) + 19511/19512/195.7 (78) + 19514 (34)
  = 1320 passed, 0 failed. True filenames run; nothing claimed unrun.
- Flatten helpers in 2411/2412/24111/24112/24113/24114/24115 learn both aliases
  narrowly; expected flatten 168 unchanged; counts 55/11/37/7.
- Negative in-memory controls (20, no disk writes): per-field drops/widens /
  optionality for all 8 keys, C3-comment edit, F1 removal, missing/swapped
  splices, reorder, synthetic leaf->hub back-edge, VALUE import — each fails
  the same positive pin. Worktree-clean guard included.
- Timeouts: scoped-graph 30s, full-src 120s, mutations 30s; no global change;
  195.14 30s mutation timeout preserved.

## Commands (real)
- npx tsc --noEmit: clean (parent re-verified).
- npm run lint: 0 errors, 9 pre-existing warnings (none in touched files).
- npm run check:portable-paths: 6425 paths, 0 violations (parent re-verified).
- npm run build: success 11.86s (worker run).
- test:agent: deferred to exact-head CI per controller gate (focused + historic
  suites green above); known 3 unrelated ignored/private Study Desktop
  real-data fixture failures not touched.

## Reviewer
- reviewer-24116 (read-only, current combined exact state): APPROVE, no findings.
  Checked 8 bodies + headers, 168 variants, 248 keys, inert emit, graph,
  negative controls, scope, stashes, fixtures/settings.

## Risks
- Spec's "~495/2412" scoped figure does not reproduce on this checkout;
  measured pinned baseline is 511/2483 (matches spec's prechange contract).
  Recorded measured values only.
- Double F1 header (key-union + command-union) and leaf doc comments quoting
  headers required code-position (not substring) pins — done in suite.
- Exact-head five-job CI is controller's final gate; PR stays OPEN UNMERGED.
