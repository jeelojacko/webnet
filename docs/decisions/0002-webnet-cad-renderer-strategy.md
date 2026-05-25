# ADR 0002: Renderer Strategy

## Status
Proposed

## Context
WebNet needs a CAD-capable rendering/editing surface, but full framework rewrites or tight viewer coupling would fight current app architecture.

## Decision
Run a renderer adapter spike against `mlightcad` lower-level seams first. Keep custom fallback path open. Do not adopt full viewer UI until framework coupling, ID mapping, and layout support are proven acceptable.

## Consequences
- spike branch should focus on adapter and selection mapping
- renderer decision follows evidence, not repo marketing

## Alternatives considered
- immediate custom renderer build
- immediate adoption of full external viewer UI
