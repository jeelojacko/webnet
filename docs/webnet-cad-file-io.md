# WebNet CAD File I/O

## Purpose
Track preferred file I/O order for Survey CAD.

## Native persistence
Preferred:
- extend current WebNet project persistence with CAD domains

Avoid:
- using DXF as native project format

## Recommended interop order
1. CSV/TXT point import/export
2. native WebNet project persistence with CAD domains
3. DXF export
4. DXF import
5. LandXML parcel/surface support
6. GeoJSON import/export
7. PDF plotting
8. SVG/HTML viewer export
9. LAS/LAZ/COPC viewing path
10. optional DWG import helper

## Test posture
- golden files for DXF/LandXML
- serialization snapshots for native project data
- focused parser/formatter tests per format
