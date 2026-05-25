# ADR 0003: DWG License Boundary

## Status
Proposed

## Context
Current public evidence suggests MIT viewer layers may still rely on GPL LibreDWG-derived tooling for DWG parsing.

## Decision
Treat DWG support as optional until the exact dependency/license chain is documented. Core Survey CAD should prioritize native persistence, DXF, LandXML, and PDF/SVG outputs first.

## Consequences
- DWG must not block early CAD phases
- any future GPL-touched path requires explicit documentation and distribution review

## Alternatives considered
- shipping DWG support in core path immediately
- refusing all DWG work permanently
