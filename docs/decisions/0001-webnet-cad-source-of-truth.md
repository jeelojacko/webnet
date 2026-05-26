# ADR 0001: WebNet CAD Source of Truth

## Status
Accepted

## Context
WebNet Survey CAD may reuse external viewer/rendering packages, but WebNet already owns survey-specific metadata and persistence workflows that generic CAD tools do not model well.

## Decision
WebNet's native survey/CAD project model will remain authoritative. Renderers, DXF/DWG parsers, and export formats will remain adapters or exchange boundaries.

Evidence from spike:
- native entity/state model exists in `src/engine/cad/`
- renderer-neutral display scene exists
- command history and snapping operate without any external viewer runtime as source of truth
- inferred external adapter export keeps native IDs authoritative

## Consequences
- native entities and transactions must exist before deep renderer adoption
- adapters need stable mapping from rendered objects back to native IDs
- exchange formats may lose metadata; native project files must not

## Alternatives considered
- external viewer entities as project truth
- DXF as native project format
