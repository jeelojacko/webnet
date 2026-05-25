# WebNet CAD Licensing Notes

## Purpose
This document records the engineering licensing posture for future WebNet Survey CAD work. It is not legal advice.

## Current planning picture
Observed public licenses:
- `mlightcad/cad-viewer`: MIT
- `mlightcad/libredwg-web`: GPL-3.0
- GNU LibreDWG: GPLv3+

Primary links:
- https://github.com/mlightcad/cad-viewer
- https://github.com/mlightcad/libredwg-web
- https://www.gnu.org/software/libredwg/

## What MIT means here
MIT is a permissive license. In practical engineering terms it generally allows:
- use
- modification
- redistribution
- inclusion in broader projects

Typical obligations:
- preserve copyright/license notices

## What GPL means here
GPL is a copyleft license. In practical engineering terms it generally imposes stronger redistribution obligations when GPL-covered code is included in a distributed program or combined distribution.

Engineering takeaway:
- GPL components cannot be treated like generic permissive dependencies
- if WebNet ships GPL DWG functionality in distributed builds, that choice must be explicit and documented

## Why this matters for Survey CAD
The top-level `cad-viewer` repo being MIT does not automatically make every DWG-capable path MIT-safe.

DWG warning path:
- viewer layer may be MIT
- DWG parser/helper may rely on GPL `libredwg-web`
- resulting shipped feature set may therefore carry GPL obligations

## Recommended safe boundary

### Core WebNet Survey CAD
Preferred posture:
- keep core Survey CAD workflow on WebNet license terms
- prioritize native project model, DXF, LandXML, GeoJSON, CSV/TXT, PDF, SVG/HTML

### Optional DWG boundary
Recommended posture:
- treat DWG as optional helper/plugin/converter boundary
- do not let DWG support define the architecture
- document when a build includes GPL-touched functionality

## README / license hygiene if GPL path is used
If WebNet directly uses or distributes GPL DWG functionality, at minimum do all of the following:
- add clear README licensing note
- include correct GPL license text where required
- preserve copyright notices
- document modifications to GPL-covered code if applicable
- ensure package manifests and license claims stop implying MIT-only distribution if no longer true

Suggested README wording if needed later:

```md
## Licensing Notes

This project may include or optionally integrate with third-party CAD/DWG tooling.

- WebNet's original code is licensed as stated in this repository.
- Some optional DWG-related functionality may rely on GPL-licensed LibreDWG-derived code or packages.
- If GPL-licensed DWG functionality is included in a distributed build, the relevant GPL license terms apply to that component and potentially to the combined distribution.
- See `docs/webnet-cad-licensing-notes.md` for dependency-level licensing details.
```

## Current planning recommendation
- safe default: core CAD work remains MIT/project-license-friendly
- DXF is first-class interop path
- DWG remains optional until license boundary is intentionally chosen

## Practical decision rules
- If feature only needs DXF, prefer DXF.
- If feature needs DWG for convenience but not core value, keep it outside core build.
- If future distribution intentionally includes GPL DWG functionality, record that choice in ADR 0003 before shipping.

## Immediate next step
During renderer spike:
- inventory actual dependency chain for DXF-only usage
- inventory additional dependency chain for DWG usage
- record exact packages and licenses before any install lands in WebNet
