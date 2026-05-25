# WebNet CAD Data Model

## Purpose
Define the initial native Survey CAD data model direction without coupling it to any renderer.

## Core rules
- stable string IDs
- deterministic serialization order
- geometry precision stored independently from display rounding
- survey metadata preserved even when exported to thinner exchange formats

## Base entity shape

```ts
type EntityId = string;
type LayerId = string;
type StyleId = string;

interface BaseCadEntity {
  id: EntityId;
  type: string;
  layerId: LayerId;
  styleId?: StyleId;
  visible?: boolean;
  locked?: boolean;
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}
```

## Survey-rich point direction
Point entities must support more than generic CAD points:
- point number/name
- northing/easting/elevation
- raw/original coordinates
- adjusted coordinates
- active coordinate reference/system
- description and feature code
- import/source lineage
- observation/adjustment participation flags
- covariance/ellipse references when available
- symbol/layer/style references

## Candidate entity families
- `SurveyPoint`
- `Line`
- `Arc`
- `Curve`
- `Polyline`
- `Polygon`
- `Parcel`
- `FeatureFigure`
- `Text`
- `MText`
- `Leader`
- `Dimension`
- `BlockReference`
- `ObservationVector`
- `ErrorEllipse`
- `TinSurface`
- `Breakline`
- `Contour`
- `PointCloudLayer`
- `Layout`
- `Sheet`
- `Viewport`

## Layer/style model
Need separate persisted domains for:
- layers
- text styles
- line styles/linetypes
- point styles/symbol definitions
- plot styles
- annotation presets

## Serialization posture
Persist as normalized project data, not denormalized renderer state.

Likely persisted groups:
- entity table
- layer/style tables
- selection-free workspace preferences
- layouts/sheets
- CAD command preferences

## Open decisions
- whether parcel metadata lives inside `Parcel` or separate legal/report domain
- whether observation vectors and ellipses are persisted entities or generated overlays with optional pinning
- whether blocks/inserts are needed before layout/plotting phase
