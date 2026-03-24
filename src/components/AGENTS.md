# UI guidance

## Scope
This directory contains app-shell, report, map, modal, import-review, export, and operator-workflow UI.

## Component rules
- Use React functional components and hooks.
- Keep components focused; move reusable stateful behavior into hooks.
- Prefer existing shared report, map, compare, and review primitives before creating new patterns.
- Preserve lazy-loading and first-render performance work already in place.

## UX invariants
- Do not remove operator traceability features such as source-line jumps, pinned review rows, compare workflows, or report/map synchronized selection unless explicitly requested.
- Preserve report ordering, filter behavior, load-more and windowing behavior, and recovery behavior.
- Keep modal draft, apply, cancel, and restore semantics stable.
- Dense-network map behavior must remain responsive; avoid changes that reintroduce expensive always-on labels or geometry churn.

## Styling
- Use existing Tailwind patterns.
- Avoid inline styles unless needed for computed geometry or canvas behavior.
- Preserve the compact Project Options layout patterns and existing tab organization unless the task asks for a redesign.

## Validation when touching UI code
Run the most relevant UI or jsdom suites plus:
- `npm run lint`
- `npm run typecheck`
- `npm run test:run`
