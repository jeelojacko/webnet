# Phase 20F.3 Visual QA — draft per-screenshot inspection

## Method (read first)
This harness had **no vision-capable model available** (the `oracle`/`scout`
subagents do not accept image attachments). The per-screenshot inspection is
therefore **objective**, not eyeballed. Every capture is accompanied by
`docs/evidence/phase20f3/geometry.json`, which records, *at the exact moment of
each screenshot*, the live DOM bounding boxes and scroll/client metrics of the
ribbon, viewport, Toolspace, Properties palette, command input, manager and
criteria panel, plus the Toolspace status attributes, manager row text,
Properties status reason and the enabled/disabled state of every ribbon
grading-group command. Those values are cross-checked against the assertions
that gated the capture. The PNGs were additionally verified for exact
dimensions and non-blank content (grayscale mean, unique-colour count) with
PIL/ImageMagick.

This is a **draft**: the objective DOM evidence below is complete; an
eyeballed pass over the PNGs should be added if a vision model becomes
available.

Image sanity (all 33 PNGs): exact viewport dimensions (1366×768 / 1920×1080 /
2560×1440); grayscale mean 18–33 / 255, 2 084–4 284 unique colours → every
frame is a populated, non-blank UI with real content.

## Cross-cutting verdicts
| Acceptance question | Evidence | Verdict |
|---------------------|----------|---------|
| Manager / Toolspace / Properties agree on group status | `1366-live-building`: Toolspace `BUILDING`, manager row `…Building…`, Properties `Building`. `1366-live-current`: Toolspace `CURRENT`, row `…Current…`, Properties `Current`. | **AGREE** |
| FAILED is obvious and stale is retained | `*-failed-manager`: Toolspace `FAILED`, row `Failed (stale) — CORNER_NO_SOLUTION`; `*-failed-toolspace-properties`: Toolspace `FAILED`, Properties `Failed (stale result withheld) — CORNER_NO_SOLUTION (corner 0): GRADING_ANALYTIC_CORNER_Z`. No FAILED frame contains `Current`. | **OBVIOUS / STALE-RETAINED** |
| Ribbon gates follow snapshot selection | `*-ribbon-unbuilt`: Calc ✓, Extract/Bake ✗. `*-ribbon-current` / `-extract` / `-bake`: Calc ✓, Extract/Bake ✓. `*-shell` (no selection): Calc ✗, Inquiry ✗, Extract/Bake ✗, group buttons ✓. | **CORRECT** |
| Extract / Bake produce exactly one product | `*-ribbon-extract`: `entityCount` +1, one Undo restores. `*-ribbon-bake`: toolspace surface node +1, one Undo restores. | **EXACTLY ONE** |
| No clipping / no page overflow at 1366 | Every capture: `document.scrollWidth/Height == innerWidth/Height`. Properties `(1086,252) 271×…` → right 1357 < 1366. Manager `480×276` → right 1066 < Properties x 1086. | **NO CLIPPING** |
| 1366 usable | Viewport 814×345, ribbon 120, one Properties (271 px) + one command input, Toolspace and manager scrollable internally. | **USABLE** |
| Cut/Fill visible unclipped | `*-cutfill-defaults`: defaults `2:1` / `3:1`, summary valid. `*-cutfill-reopened`: `2H:1V` / `3H:1V`, edit panel `right > innerWidth` check `false`. | **VISIBLE** |

## Per-screenshot inspection
Geometry column format: `ToolspaceStatuses · PropertiesStatus · ManagerBox ·
RibbonGroupCommands(✓enabled / ✗disabled)`.

Recapture note: `1366-failed-manager.png` and `2560-failed-manager.png` were
recaptured after the Flow B capture step was fixed to scroll the manager's
Status column and Extract/Bake actions into frame once recalc settles to
FAILED (the first pair showed the pre-failure criteria-override moment). The
`*-failed-toolspace-properties.png` siblings were already good and are
untouched; `geometry.json` needed no change (the harness records box metrics,
not scroll offsets, so the regenerated entries are identical). A vision pass
was performed on these two frames only — both show `Failed (stale) —
CORNER_NO_SOLUTION` with Extract/Bake visibly dimmed (disabled state also
gated by spec assertions + ribbon gates) — and both fit legibly at their
resolutions. The draft/objective-only disclosure above still stands for the
remaining rows (ribbon/cutfill).

| File | Resolution | Claim / state proven | Visible DOM at capture | Dimensions · non-blank | Verdict |
|------|-----------|----------------------|------------------------|------------------------|---------|
| `1366-live-building.png` | 1366x768 | Flow A — group mid-**BUILDING** after the single ribbon Calc click | TS `[BUILDING]` · props `Building` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1366x768 · mean 33 · uniq 3089 | PASS |
| `1920-live-building.png` | 1920x1080 | Flow A — group mid-**BUILDING** after the single ribbon Calc click | TS `[BUILDING]` · props `Building` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1920x1080 · mean 28 · uniq 3512 | PASS |
| `2560-live-building.png` | 2560x1440 | Flow A — group mid-**BUILDING** after the single ribbon Calc click | TS `[BUILDING]` · props `Building` · mgr 480x658 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 2560x1440 · mean 22 · uniq 3768 | PASS |
| `1366-live-current.png` | 1366x768 | Flow A — same group **CURRENT**, no post-click interaction | TS `[CURRENT]` · props `Current` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1366x768 · mean 33 · uniq 3047 | PASS |
| `1920-live-current.png` | 1920x1080 | Flow A — same group **CURRENT**, no post-click interaction | TS `[CURRENT]` · props `Current` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1920x1080 · mean 30 · uniq 3602 | PASS |
| `2560-live-current.png` | 2560x1440 | Flow A — same group **CURRENT**, no post-click interaction | TS `[CURRENT]` · props `Current` · mgr 480x658 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 2560x1440 · mean 26 · uniq 3841 | PASS |
| `1366-failed-manager.png` | 1366x768 | Flow B — row `(stale)` + `CORNER_NO_SOLUTION`, Extract/Bake **disabled** | TS `[FAILED]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1366x768 · mean 33 · uniq 3135 | PASS |
| `1920-failed-manager.png` | 1920x1080 | Flow B — row `(stale)` + `CORNER_NO_SOLUTION`, Extract/Bake **disabled** | TS `[FAILED]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1920x1080 · mean 28 · uniq 3754 | PASS |
| `2560-failed-manager.png` | 2560x1440 | Flow B — row `(stale)` + `CORNER_NO_SOLUTION`, Extract/Bake **disabled** | TS `[FAILED]` · props `—` · mgr 480x682 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 2560x1440 · mean 23 · uniq 4173 | PASS |
| `1366-failed-toolspace-properties.png` | 1366x768 | Flow B — Toolspace diagnostic `GRADING_ANALYTIC_CORNER_Z` + Properties failure | TS `[FAILED]` · props `Failed (stale result withheld)` · mgr — · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1366x768 · mean 26 · uniq 2084 | PASS |
| `1920-failed-toolspace-properties.png` | 1920x1080 | Flow B — Toolspace diagnostic `GRADING_ANALYTIC_CORNER_Z` + Properties failure | TS `[FAILED]` · props `Failed (stale result withheld)` · mgr — · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1920x1080 · mean 22 · uniq 2383 | PASS |
| `2560-failed-toolspace-properties.png` | 2560x1440 | Flow B — Toolspace diagnostic `GRADING_ANALYTIC_CORNER_Z` + Properties failure | TS `[FAILED]` · props `Failed (stale result withheld)` · mgr — · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 2560x1440 · mean 18 · uniq 2543 | PASS |
| `1366-ribbon-unbuilt.png` | 1366x768 | Flow C — UNBUILT selection: Calc **enabled**, Extract/Bake **disabled** | TS `[UNBUILT,UNBUILT]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1366x768 · mean 33 · uniq 3472 | PASS |
| `1920-ribbon-unbuilt.png` | 1920x1080 | Flow C — UNBUILT selection: Calc **enabled**, Extract/Bake **disabled** | TS `[UNBUILT,UNBUILT]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1920x1080 · mean 28 · uniq 3901 | PASS |
| `2560-ribbon-unbuilt.png` | 2560x1440 | Flow C — UNBUILT selection: Calc **enabled**, Extract/Bake **disabled** | TS `[UNBUILT,UNBUILT]` · props `—` · mgr 480x676 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✗ GGBAKE✗ GG✓` | 2560x1440 · mean 23 · uniq 4032 | PASS |
| `1366-ribbon-current.png` | 1366x768 | Flow C — CURRENT selection: Extract+Bake **enabled** | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1366x768 · mean 33 · uniq 3441 | PASS |
| `1920-ribbon-current.png` | 1920x1080 | Flow C — CURRENT selection: Extract+Bake **enabled** | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1920x1080 · mean 30 · uniq 4001 | PASS |
| `2560-ribbon-current.png` | 2560x1440 | Flow C — CURRENT selection: Extract+Bake **enabled** | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x676 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 2560x1440 · mean 26 · uniq 4130 | PASS |
| `1366-ribbon-extract.png` | 1366x768 | Flow C — ribbon Extract added exactly one feature line (one Undo removes) | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1366x768 · mean 33 · uniq 3584 | PASS |
| `1920-ribbon-extract.png` | 1920x1080 | Flow C — ribbon Extract added exactly one feature line (one Undo removes) | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1920x1080 · mean 29 · uniq 4120 | PASS |
| `2560-ribbon-extract.png` | 2560x1440 | Flow C — ribbon Extract added exactly one feature line (one Undo removes) | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x676 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 2560x1440 · mean 24 · uniq 4284 | PASS |
| `1366-ribbon-bake.png` | 1366x768 | Flow C — ribbon Bake added exactly one explicit-TIN surface (one Undo removes) | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1366x768 · mean 33 · uniq 3430 | PASS |
| `1920-ribbon-bake.png` | 1920x1080 | Flow C — ribbon Bake added exactly one explicit-TIN surface (one Undo removes) | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 1920x1080 · mean 29 · uniq 4002 | PASS |
| `2560-ribbon-bake.png` | 2560x1440 | Flow C — ribbon Bake added exactly one explicit-TIN surface (one Undo removes) | TS `[CURRENT,UNBUILT]` · props `—` · mgr 480x676 · ribbon `GRADEGROUP✓ GGCALC✓ GGINQUIRY✓ GGEXTRACTD✓ GGBAKE✓ GG✓` | 2560x1440 · mean 26 · uniq 4127 | PASS |
| `1366-cutfill-defaults.png` | 1366x768 | Flow D — untouched defaults `2:1` / `3:1`, summary not `invalid` | TS `[—]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1366x768 · mean 32 · uniq 2798 | PASS |
| `1920-cutfill-defaults.png` | 1920x1080 | Flow D — untouched defaults `2:1` / `3:1`, summary not `invalid` | TS `[—]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1920x1080 · mean 28 · uniq 3654 | PASS |
| `2560-cutfill-defaults.png` | 2560x1440 | Flow D — untouched defaults `2:1` / `3:1`, summary not `invalid` | TS `[—]` · props `—` · mgr 480x704 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 2560x1440 · mean 24 · uniq 4091 | PASS |
| `1366-cutfill-reopened.png` | 1366x768 | Flow D — reopened `2H:1V` / `3H:1V`, edit panel unclipped | TS `[—]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1366x768 · mean 33 · uniq 3041 | PASS |
| `1920-cutfill-reopened.png` | 1920x1080 | Flow D — reopened `2H:1V` / `3H:1V`, edit panel unclipped | TS `[—]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1920x1080 · mean 28 · uniq 3933 | PASS |
| `2560-cutfill-reopened.png` | 2560x1440 | Flow D — reopened `2H:1V` / `3H:1V`, edit panel unclipped | TS `[—]` · props `—` · mgr 480x814 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 2560x1440 · mean 24 · uniq 4249 | PASS |
| `1366-shell.png` | 1366x768 | §22 — one 120 px band, single Properties/command, no page overflow | TS `[—]` · props `—` · mgr 480x276 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1366x768 · mean 32 · uniq 3037 | PASS |
| `1920-shell.png` | 1920x1080 | §22 — one 120 px band, single Properties/command, no page overflow | TS `[—]` · props `—` · mgr 480x526 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 1920x1080 · mean 27 · uniq 3599 | PASS |
| `2560-shell.png` | 2560x1440 | §22 — one 120 px band, single Properties/command, no page overflow | TS `[—]` · props `—` · mgr 480x658 · ribbon `GRADEGROUP✓ GGCALC✗ GGINQUIRY✗ GGEXTRACTD✗ GGBAKE✗ GG✓` | 2560x1440 · mean 22 · uniq 4015 | PASS |

## Dimensions
All 33 PNGs match their viewport exactly:
- `1366-*` → 1366×768 (11 files)
- `1920-*` → 1920×1080 (11 files)
- `2560-*` → 2560×1440 (11 files)

## Hash-duplication audit
`sha256` over all 33 PNGs: **33 files, 33 unique digests, 0 duplicate groups** —
every resolution/state frame is a distinct image (no copy/paste or stale
re-save). Command used:

```bash
python3 - <<'PY'
import glob,hashlib,os
seen={}
for f in sorted(glob.glob('docs/evidence/phase20f3/*.png')):
    h=hashlib.sha256(open(f,'rb').read()).hexdigest()
    seen.setdefault(h,[]).append(os.path.basename(f))
print(len(seen),'unique of',len(glob.glob('docs/evidence/phase20f3/*.png')))
PY
```

## Restrictions / notes
- No grading math, `cadGradingGroupShell.ts`, `cadCommandRegistry.ts` group
  logic, or `cadShellSnapshotEqual.ts` semantics were changed to make these
  frames pass.
- `docs/evidence/phase20f2/` was **not** overwritten; the 20F.2 visual pass is
  unchanged apart from the append-only erratum in `phase20f2-visual-qa.md`.
- Full flow detail, error counts and the §22 numbers: `phase20f3-browser-qa.md`.
