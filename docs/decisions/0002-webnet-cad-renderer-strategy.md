# ADR 0002: Renderer Strategy

## Status
Accepted

## Context
WebNet needs a CAD-capable rendering/editing surface, but full framework rewrites or tight viewer coupling would fight current app architecture.

## Decision
Run a renderer adapter spike with native WebNet entities first. Keep custom fallback path open. Do not adopt full viewer UI until framework coupling, ID mapping, layout support, and dependency/license boundaries are proven acceptable.

First spike result:
- native CAD model and renderer-neutral display scene now exist inside WebNet
- internal SVG proof renderer exists
- inferred `mlightcad` export contract exists
- internal selection/snap/command-history proof surface exists
- actual `mlightcad` runtime install is deferred because current lower-level package path appears to pull the LibreDWG converter chain

Go / no-go:
- go: continue native-model-driven command, snapping, and future DXF/export seams
- no-go: do not ship the current GPL-touched runtime path inside core WebNet

## Consequences
- spike branch should focus on adapter and selection mapping
- renderer decision follows evidence, not repo marketing
- next external runtime spike should prefer an MIT-only renderer/data-model path if one can be isolated cleanly

## Alternatives considered
- immediate custom renderer build
- immediate adoption of full external viewer UI
