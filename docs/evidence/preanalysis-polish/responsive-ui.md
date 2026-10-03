# Responsive UI (Waves F/G)

## Toolbar tiers (`AppToolbar.tsx`, existing icons only)
- ≥1280 (`xl`): full labels, single wrap-capable row.
- 1024–1279: same buttons icon-only; run phase box fluid.
- <1024: header + action groups wrap into rows (`flex-wrap` + `gap-x`/`gap-y`) —
  deliberate wrapping, never overlap.
- Fixed `min-w-[10rem]/[12rem]` select and `sm:w-[23rem]` progress box replaced
  with `min-w-0` / `max-w-full` / `sm:flex-1 sm:max-w-[26rem]`; inner progress
  `min-w-[…]` spans dropped; duplicated `hidden sm:flex` / `sm:hidden` button
  pairs merged (one button per action, label compacts by breakpoint).
- Icon-only controls: `aria-label` + `title`, native focus ring + keyboard.
  Adjust/Cancel/mobile toggle covered. Run status + Adjust stay prominent.
- Nearby (H): progress box renders only while `status === 'running'`, so stale
  phase/progress clears on complete/cancel/failed; result chip stays visible.

## ReportToolbar
Container + action group `flex flex-wrap` with `gap-x-2 gap-y-2` (~8 px row
gap); `ml-auto` unit scale; order/enabled semantics unchanged; tooltips added.

## Tests
- `tests/toolbar_responsive_layout.test.tsx` 4/4 (jsdom).
- `tests-browser/toolbar-responsive-layout.spec.ts` 8/8 (Chromium):
  non-overlap + no page/toolbar overflow at 1920/1366/1280/1100/980/768,
  wrapped-row positive vertical gaps, required controls visible every tier,
  ReportToolbar wrap gap at 480. Harness: `toolbar-harness.html` +
  `src/dev/toolbarHarness.tsx` (matches existing harness convention).
