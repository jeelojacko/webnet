# Phase 18G — surface manual QA checklist

Automated cover: `tests-browser/cad-surface-18g.spec.ts` (18G-A core flow,
18G-B worker protocol, 18G-C substantial-surface responsiveness), all green
on Chromium. The steps below are the human pass — feel against the 18F
baseline, at three resolutions. Screenshots are committed under
`docs/evidence/phase18g/` as review evidence (18D-qa precedent).

## Setup

1. `npm run dev -- --host 127.0.0.1 --port 4174`, open `/cad`.
2. Open `tests-browser/fixtures/cad-surface-18g-seed.wncad`
   (30-point grid + All/High groups + `QA Constraints` surface with
   point-chain breakline, outer ring, void ring).
3. Ribbon → Surface tab; Toolspace → Survey tab (surface tree lives there).

## Checklist (each resolution: 1366×768, 1920×1080, 2560×1440)

- [ ] Manager opens (Surface tab → any Surface button): create row, surface
      list with Name/Style/Layer/Status/Verts/Tris, definition editor,
      inquiry panel — no overflow, no clipped controls.
- [ ] Toolspace Survey → Surfaces tree: `QA Constraints — Unbuilt` with
      Definition (`Point Groups (1)`, `breaklines 1 · outer 1 void 1`) and
      `Statistics: no mesh — rebuild.` children.
- [ ] TIN display after Rebuild: triangulated mesh + brighter boundary ring
      visible in the viewport; void hole visibly empty; stats read
      `40v 32t`, area `1100.000 m²`.
- [ ] Breakline effect: mesh edges follow the mid-row chain (compare with
      the chain removed via the definition editor → area/count change).
- [ ] BUILDING state: click Rebuild and watch — `Building` status + the
      `building…` notice appear without freezing the UI (switch ribbon
      tabs mid-build; they must respond).
- [ ] NEEDS_REBUILD: MOVE any source point → status flips, old mesh stays
      dashed with the `STALE — Needs Rebuild` badge (never labeled Current).
- [ ] FAILED: attach a group that breaks the build (or reproduce the void
      crossing) → `Failed` + diagnostic line, previous mesh retained,
      never CURRENT.
- [ ] Inquiry: E `15` N `15` → `elevation 102.250`; a point inside the void
      → `No surface elevation at point`; before any build → the honest
      rebuild-first text.
- [ ] Layer OFF/ON (Layer manager → General): derived surface paths vanish
      and return; rebuild state is untouched.
- [ ] Save Drawing → reopen: surfaces listed, status Unbuilt (meshes never
      persist), one Rebuild → Current.
- [ ] Large TIN: generate a 10k drawing
      (`npx tsx scripts/phase18gSurfaceBrowserPerf.ts --scale=10000`);
      rebuild ≈1.5 s, pan/zoom stays usable, vertex nodes capped
      (no per-vertex clutter).

## Screenshot list (committed review evidence)

`18g-A-current.png`, `18g-A-inquiry.png`, `18g-A-constraints.png`,
`18g-A-needs-rebuild.png`, `18g-A-layer-off.png`, `18g-A-layer-on.png`,
`18g-A-reopened.png`, `18g-C-big.png` — captured automatically by the spec
(the STALE badge, BUILDING notice, and FAILED diagnostic are covered by
`-needs-rebuild` / `-current` / manual FAILED above).

## Visual-review questions

1. Is CURRENT vs NEEDS_REBUILD vs FAILED vs BUILDING obvious at a glance
   (text + stale styling, never color-only)?
2. Does BUILDING ever block input (ribbon, Toolspace, viewport)?
3. At 10k triangles, is the single-path mesh readable (boundary distinct,
   no vertex soup), and does pan/zoom stay smooth?
4. After save/reopen, is it obvious the surface needs a rebuild (no stale
   CURRENT claim)?
5. Does the void read as a hole, and does the breakline read as enforced
   linework rather than mesh noise?
