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

Additional package metadata observed during this spike from npm package manifests:
- `@mlightcad/cad-viewer@1.5.0`
  - peer deps include `vue`, `vue-i18n`, `element-plus`, `@vueuse/core`, and `@mlightcad/cad-simple-viewer`
- `@mlightcad/cad-simple-viewer@1.5.0`
  - peer deps include `three`, `lodash-es`, and `@mlightcad/data-model`
  - direct dependency includes `@mlightcad/libredwg-converter`
- `@mlightcad/libredwg-converter@3.5.40`
  - direct dependency includes `@mlightcad/libredwg-web`
- `@mlightcad/libredwg-web@0.7.1`
  - license is `GPL-3.0`

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
- do not install `cad-simple-viewer` into core WebNet blindly while it still appears to drag the LibreDWG chain

### Which packages look useful?
Most promising from current evidence:
- `three-renderer`
- `svg-renderer`
- `data-model`
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

Current WebNet spike conclusion:
- current branch is model-space only
- layouts, sheets, and viewports should remain future WebNet-owned domains rather than viewer-runtime truth
- adapter output should treat layout-space as another disposable projection once Phase 6 starts

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

## What this spike implemented in WebNet
This branch now includes:
- native Survey CAD entities under `src/engine/cad/`
- layer/style library defaults plus deterministic project-state helpers
- renderer-neutral display scene adapter
- inferred `mlightcad` export contract that preserves native WebNet IDs
- internal SVG proof renderer in the Survey CAD workspace tab
- selection, command-history, spatial-index, and snap-manager seams on top of the native model

## Current WebNet render primitives worth reusing
Current WebNet already has reusable render patterns that Survey CAD should adapt rather than replace:
- point, line, label, and ellipse primitive shaping from the current SVG/map selector stack
- separation between world-space geometry derivation and final screen-space projection
- deterministic mapping from rendered object back to app-owned IDs
- layered rendering posture where static geometry and interaction overlays can evolve independently
- existing workspace command/status surfaces already proven in the main app shell

This branch intentionally does not install `cad-simple-viewer` or `cad-viewer` into core WebNet yet.

Reason:
- current package chain suggests the easiest lower-level viewer path still drags the LibreDWG converter dependency into the app dependency graph
- that is too much license/runtime ambiguity for a first core-app spike

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

## Current recommendation
Renderer/model spike status:

- native-model spike complete
- layer/style spike complete
- adapter-contract spike complete
- internal preview spike complete
- internal selection/snap command surface complete
- actual external-package runtime spike still pending

Go / no-go update:
- go for continuing WebNet-native CAD model, snapping, commands, and DXF-boundary planning
- no-go for installing the current `mlightcad` runtime path into core WebNet until an MIT-only path or explicit optional GPL boundary is proven

Future external runtime work should proceed in a follow-up branch only after choosing an MIT-only path or an explicit optional GPL boundary.

Renderer/model boundary needs proof first.
