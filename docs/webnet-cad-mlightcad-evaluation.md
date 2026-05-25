# WebNet CAD Evaluation: `mlightcad/cad-viewer`

## Purpose
This document records the current planning-stage evaluation of `mlightcad/cad-viewer` as a possible renderer/editor substrate for WebNet Survey CAD.

Primary source links:
- https://github.com/mlightcad/cad-viewer
- https://github.com/mlightcad/cad-simple-viewer-example
- https://github.com/mlightcad/cad-viewer-example
- https://github.com/mlightcad/libredwg-web

## Current observed repo shape
From the public GitHub repo:
- monorepo with `packages/`
- package names visible in repo include:
  - `cad-simple-viewer`
  - `cad-viewer`
  - `three-renderer`
  - `svg-renderer`
  - `cad-html-exporter`
  - examples
- repo README advertises MIT license at repo level
- repo README explicitly describes modular architecture and browser-only DWG/DXF handling

Inference from published structure:
- `cad-viewer` appears to be the full-featured packaged viewer UI
- `cad-simple-viewer` appears intended as lower-level viewer surface with less UI coupling
- `three-renderer` and `svg-renderer` suggest renderer seams worth auditing before any adoption

## Answers to immediate planning questions

### Can it be embedded without rewriting WebNet UI?
Probable answer: yes, if WebNet uses lower-level or framework-agnostic viewer packages rather than the full packaged UI.

Why:
- public docs describe modular architecture
- repo exposes `cad-simple-viewer` separately from `cad-viewer`
- public description says the full `cad-viewer` package adds a Vue 3 UI layer on top of lower-level viewer logic

Planning conclusion:
- do not target full `cad-viewer` UI first
- evaluate `cad-simple-viewer` and renderer packages first

### Which packages look useful?
Most promising from current evidence:
- `cad-simple-viewer`
- `three-renderer`
- `svg-renderer`
- `cad-html-exporter` for later sharing/export ideas

Potentially useful later:
- DXF parsing/conversion pieces if they stay decoupled from the external entity model

### Which packages look Vue-specific?
Likely Vue-coupled:
- full `cad-viewer`
- example app layers that package toolbar/menu/command line/status bar UI

Need spike confirmation:
- inspect package manifests and imports to confirm whether `cad-simple-viewer` itself is framework-agnostic

### Can WebNet keep its own model?
Planning answer: only if WebNet adds an adapter boundary and refuses to let mlightcad entities become project truth.

Required boundary:
- WebNet native CAD/survey entities remain authoritative
- adapter translates WebNet entities into whatever display payload the chosen mlightcad layer needs
- selection and edit actions map back to WebNet IDs

### Can selection map back to WebNet IDs?
Unknown until spike. Must be treated as a hard success criterion.

Spike requirement:
- every rendered entity gets stable back-reference metadata
- selection callback returns enough information to resolve to WebNet entity ID

### How are model/layout space handled?
Public repo docs advertise:
- layout/paper-space rendering
- viewport entity support

Planning implication:
- good signal for later plotting/layout support
- still needs verification that model/layout state can be driven externally rather than stored only in viewer-native structures

### How are DXF and DWG parsed?
Observed public statements:
- DXF and DWG loading are first-class features in repo README
- README explicitly says DWG path uses LibreDWG and inherits some limitations from it

Planning implication:
- DXF path may be safer for early interop work
- DWG path must stay license-reviewed and optional

### Licensing implications
Current public picture:
- `mlightcad/cad-viewer` repo: MIT
- `mlightcad/libredwg-web`: GPL-3.0
- DWG path likely crosses into GPL territory if it depends on `libredwg-web`

Planning implication:
- treat DWG import as optional plugin/helper boundary
- do not assume the entire mlightcad stack is MIT-safe just because the top viewer repo is MIT

### Reuse, fork, adapt, or reference only?
Current planning recommendation:
- reuse/adapt lower-level renderer ideas or packages if adapter boundary is clean
- do not adopt full external project model
- fork only if needed after spike proves strong value but insufficient integration seams
- use as reference only if selection, model ownership, or framework coupling becomes problematic

## Recommended spike checklist

### Spike A: package audit
- inspect package manifests for Vue dependencies
- inspect package boundaries for direct state/model assumptions
- record precise dependency graph for DXF-only and DWG-capable paths

### Spike B: render WebNet-native geometry
- render points
- render lines/polylines
- render polygons
- render text/labels
- render error ellipses as custom overlays if native entity type support is weak

### Spike C: selection round-trip
- select one entity
- resolve returned object to WebNet entity ID
- verify deterministic repeat behavior across rerenders

### Spike D: state-driven visibility
- toggle layers from WebNet state
- verify external visibility changes do not require rebuilding the whole viewer model in fragile ways

### Spike E: model/layout seam
- test whether layouts/viewports can be fed externally
- document whether layout model belongs in WebNet or in adapter-owned temporary state

### Spike F: export loop
- export simple WebNet-native subset to DXF
- reload it in mlightcad path
- compare topology and metadata that survives the exchange

### Spike G: license decision
- separate MIT-only path from GPL-touched path
- document ship/no-ship boundary for DWG

## Success criteria
- WebNet remains source of truth
- no forced Vue rewrite
- adapter can attach stable native IDs
- points/lines/polygons/text render acceptably
- layer visibility can be driven from WebNet state
- license story is documented and intentional

## Failure criteria
- external viewer model must become authoritative
- selection cannot reliably map back to WebNet IDs
- lower-level viewer still drags in strong framework coupling
- performance is poor on realistic survey plans
- DXF-only path is usable but every meaningful CAD workflow requires GPL DWG modules

## Current planning recommendation
Proceed with future branch:

```txt
spike/mlightcad-renderer-adapter
```

Do not start with:
- parcel implementation
- field-to-finish
- surfaces
- point clouds

Renderer/model boundary needs proof first.
