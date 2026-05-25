# ADR 0001: WebNet CAD Source of Truth

## Status
Proposed

## Context
WebNet Survey CAD may reuse external viewer/rendering packages, but WebNet already owns survey-specific metadata and persistence workflows that generic CAD tools do not model well.

## Decision
WebNet's native survey/CAD project model will remain authoritative. Renderers, DXF/DWG parsers, and export formats will remain adapters or exchange boundaries.

## Consequences
- native entities and transactions must exist before deep renderer adoption
- adapters need stable mapping from rendered objects back to native IDs
- exchange formats may lose metadata; native project files must not

## Alternatives considered
- external viewer entities as project truth
- DXF as native project format
