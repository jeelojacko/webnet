1. Core point/line COGO tools

   | Tool                                      | What it does                                                 |
   | ----------------------------------------- | ------------------------------------------------------------ |
   | **Inverse Between Points**                | Pick two points and report bearing/azimuth, horizontal distance, slope distance if elevations exist, delta N/E/Z, grade, and maybe grid/ground distance. |
   | **Multi-Point Inverse**                   | Pick a point sequence and report each leg plus total length/perimeter. Useful for checking deed traverses or field linework. |
   | **Bearing/Azimuth + Distance**            | Create a point or line from a start point using bearing/azimuth and distance. |
   | **Turned Angle + Distance**               | Create a point from occupied point + backsight/reference direction + angle right/left + distance. Very field-survey style. |
   | **Deflection Angle + Distance**           | Continue a line by left/right deflection from previous tangent. Useful for road/curve layout and old plans. |
   | **Perpendicular From Point to Line**      | Drop a perpendicular from a point to a line; optionally create the foot point and report offset distance. |
   | **Point at Fraction/Distance Along Line** | Create a point at a given distance, percentage, or station along a line. |
   | **Extend Line by Distance**               | Extend from one endpoint by a specified distance and bearing of the line. |
   | **Offset Point**                          | Create a point offset left/right from a line or from a bearing. |
   | **Offset Line / Parallel Line**           | Create a parallel line at a given offset distance.           |
   | **Bearing Between Two Points**            | Report only direction info, with quadrant bearing / azimuth / gon / DMS formatting options. |
   | **Distance Between Two Points**           | Report 2D, 3D, grid, ground, and elevation difference.       |

2.Intersection tools

| Tool                               | What it does                                                 |
| ---------------------------------- | ------------------------------------------------------------ |
| **Line-Line Intersection**         | Intersect two infinite lines, rays, or finite segments. Should report whether the intersection is outside the segment limits. |
| **Bearing-Bearing Intersection**   | From Point A on bearing 1 and Point B on bearing 2, compute intersection. |
| **Bearing-Distance Intersection**  | From Point A on bearing, and Point B with radius/distance, compute possible point(s). Usually 0, 1, or 2 solutions. |
| **Distance-Distance Intersection** | Circle-circle intersection from two known points and two distances. Usually 0, 1, or 2 possible points. |
| **Line-Circle Intersection**       | Intersect a line/bearing with a distance radius. Useful for offsets and record retracement. |
| **Arc-Line Intersection**          | Intersect an arc/curve with a line.                          |
| **Arc-Arc Intersection**           | Intersect two curves/arcs.                                   |
| **Offset Intersection**            | Intersect two offset lines without manually creating the offset geometry. |
| **Perpendicular Intersection**     | From a point to a line/alignment, compute the perpendicular foot point. |
| **Skew Intersection**              | Intersect a line/alignment at a specified skew angle instead of 90°. Useful for roads, culverts, utilities, etc.Traverse / deed entry tools |

3.Traverse / deed entry tools

| Tool                                          | What it does                                                 |
| --------------------------------------------- | ------------------------------------------------------------ |
| **Traverse Editor**                           | Enter a sequence of bearings/azimuths/angles and distances to build connected linework and points. Civil 3D’s Traverse Editor creates lines and COGO points as traverse data is entered, which is the kind of workflow you probably want. ([Autodesk Help](https://help.autodesk.com/cloudhelp/2027/ENG/Civil3D-UserGuide/files/GUID-973DF386-7999-487E-8C79-54091CED481E.htm?utm_source=chatgpt.com)) |
| **Sideshot Entry**                            | From occupied point and backsight/reference direction, compute independent side shots. |
| **Open Traverse**                             | Enter traverse legs without requiring closure.               |
| **Closed Traverse**                           | Enter traverse and compute closure back to start or known endpoint. |
| **Point-to-Point Traverse**                   | Start from known point and close onto another known point.   |
| **Bearing/Distance Deed Entry**               | Enter legal-description style calls: `N 35°24'10" E 125.32`, curves, along line, etc. |
| **Batch COGO Input**                          | Paste multiple calls from text and build geometry automatically. |
| **Traverse Closure Report**                   | Misclosure north/east, linear misclosure, closure ratio, total traverse length, angular misclosure. |
| **Compass/Bowditch Adjustment**               | Distribute closure error proportional to line lengths.       |
| **Transit Rule Adjustment**                   | Distribute error based on latitudes/departures.              |
| **Angular Balance**                           | Adjust angles before coordinate balancing.                   |
| **Crandall Adjustment**                       | Optional, more advanced traverse adjustment.                 |
| **Least Squares Traverse/Network Adjustment** | More advanced; Civil 3D has least-squares analysis for survey observations, but for Webnet this may belong closer to your existing network-adjustment side than basic CAD COGO. ([Autodesk Help](https://help.autodesk.com/view/CIV3D/2017/ENU/?caas=caas%2Fdocumentation%2FCIV3D%2F2014%2FENU%2FfilesCUG%2FGUID-DEBE28FD-94A2-4162-9098-CB432B45A529-htm.html&utm_source=chatgpt.com)) |

4.Curve COGO tools

| Tool                                                         | What it does                                                 |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| **Curve Calculator**                                         | Given two curve parameters, solve the rest: radius, delta, arc length, chord, tangent, external, middle ordinate, chord bearing, etc. ArcGIS describes this exact style of COGO curve calculator: two known parameters produce the full curve characteristics. ([ArcGIS Desktop](https://desktop.arcgis.com/en/arcmap/latest/manage-data/creating-new-features/calculating-cogo-curve-parameters.htm?utm_source=chatgpt.com)) |
| **Create Arc by 3 Points**                                   | Create curve through start, mid, end.                        |
| **Create Arc by Start-End-Radius**                           | Common record-plan input.                                    |
| **Create Arc by Start-End-Delta**                            | Useful for deed calls.                                       |
| **Create Arc by Start-Tangent-Radius**                       | Begin curve from tangent direction.                          |
| **Create Arc by PI-Radius-Delta**                            | Classic road/survey curve definition.                        |
| **Tangent Curve Between Two Lines**                          | Fillet two tangents with a radius, creating PC/PT.           |
| **Curve From Chord Bearing + Chord Distance + Radius/Delta** | Very common plan/deed style input.                           |
| **Curve Direction Toggle**                                   | Left/right, clockwise/counterclockwise, concave side.        |
| **Reverse Curve**                                            | Two tangent curves in opposite directions.                   |
| **Compound Curve**                                           | Two or more same-direction curves with different radii.      |
| **Radial Bearing Tool**                                      | Compute radial direction at PC/PT or any point on arc.       |
| **Point on Curve by Arc Distance**                           | Create point a set arc length from PC.                       |
| **Point on Curve by Chord Distance**                         | Create point along curve using chord increment.              |
| **Offset Curve**                                             | Create curve parallel to original with adjusted radius.      |
| **Curve Subdivision**                                        | Create points along curve at station interval, chord interval, or equal divisions. |
| **Spiral / Clothoid Tools**                                  | Advanced road design; not essential for boundary COGO MVP, but useful later. |

Minimum curve data you should store:

```
start point
end point
center point
radius
delta
arc length
chord length
chord bearing
tangent length
direction: CW/CCW
curve side: left/right
PI, PC, PT if applicable
```

5.Stationing / alignment COGO

| Tool                               | What it does                                                 |
| ---------------------------------- | ------------------------------------------------------------ |
| **Create Alignment from Polyline** | Treat selected line/arc chain as a centerline.               |
| **Station Along Alignment**        | Report station at clicked point along alignment.             |
| **Station + Offset to Point**      | Create a point from station and left/right offset. Carlson calls this kind of workflow “Station Store,” while its Point Projection does the reverse: point to station/offset. ([web.carlsonsw.com](https://web.carlsonsw.com/files/knowledgebase/kbase_attach/632/SurvCE_V2_Tutorial.pdf?utm_source=chatgpt.com)) |
| **Point to Station/Offset**        | Project an existing point to an alignment and report station, offset, side, and perpendicular/radial foot. Carlson’s Point Projection and Trimble’s project-point methods both support this kind of calculation. ([help.carlsonsw.com](https://help.carlsonsw.com/en/survpc/main-menu/cogo/point-projection/point-projection.html?utm_source=chatgpt.com)) |
| **Station Equation Support**       | Handle equations like `10+00 back = 12+50 ahead`.            |
| **Create Offset Alignment**        | Generate left/right offset baseline.                         |
| **Perpendicular/Skew Offset Line** | Create cross-section line at a station.                      |
| **Points at Station Interval**     | Generate points every 10 m, 20 m, 25 m, etc.                 |
| **Label Station/Offset**           | Dynamic label for selected points/features.                  |

6.Area and parcel tools

| Tool                         | What it does                                                 |
| ---------------------------- | ------------------------------------------------------------ |
| **Area by Polygon**          | Report area, perimeter, closure, clockwise/counterclockwise. |
| **Area by Point Sequence**   | Pick points in order and compute area without needing a polygon first. |
| **Area Unit Conversion**     | m², hectares, acres, ft², yd².                               |
| **Create Parcel from Lines** | Detect closed loops from selected linework.                  |
| **Split Parcel by Line**     | Cut polygon with a line.                                     |
| **Split Parcel by Bearing**  | Create a split line through a point at a bearing.            |
| **Split Parcel by Area**     | Adjust a split line until target area is achieved.           |
| **Hinged Area**              | Rotate a line from a hinge point until target area is met. Carlson’s COGO menu includes area and hinged-area style tools, so this is a normal survey-CAD expectation. ([help.carlsonsw.com](https://help.carlsonsw.com/en/survpc/map-screen/cogo/cogo.html?utm_source=chatgpt.com)) |
| **Sliding Area**             | Move a parallel line until target area is met.               |
| **Radial Area Split**        | Split around a curve/radial line, more advanced.             |
| **Best-Fit Closure Gap**     | Detect small gaps/overlaps in parcel linework.               |
| **Parcel Report**            | Bearing/distance/curve table around boundary.                |

7.Transformation tools

| Tool                                        | What it does                                                 |
| ------------------------------------------- | ------------------------------------------------------------ |
| **Translate**                               | Move selected points/linework by delta N/E/Z or from-point/to-point. |
| **Rotate**                                  | Rotate around base point by angle, or align one bearing to another. |
| **Scale**                                   | Scale selected geometry from base point.                     |
| **Rotate + Translate by Two Points**        | Match local drawing to known control using one base point and one direction point. |
| **2D Helmert / Similarity Transform**       | Best-fit translate/rotate/scale from multiple matched points. |
| **Affine Transform**                        | More flexible transform, but should be used carefully because it can distort geometry. |
| **Mirror**                                  | Mirror geometry across line.                                 |
| **Grid-to-Ground / Ground-to-Grid Scaling** | Apply combined scale factor from a chosen origin.            |
| **Elevate / Set Z**                         | Assign elevation, add delta elevation, interpolate elevations. |

8.Coordinate and bearing utilities

| Tool                                    | What it does                                                 |
| --------------------------------------- | ------------------------------------------------------------ |
| **Coordinate Parser**                   | Accept `N,E,Z`, `E,N,Z`, comma-separated, space-separated, etc. |
| **Bearing Parser**                      | Accept quadrant bearings, azimuths, DMS, decimal degrees, gons. |
| **Bearing Converter**                   | Convert `N 12°34'56" E` to azimuth, decimal degrees, DMS, etc. |
| **Angle Math**                          | Add/subtract bearings, compute deflection, interior/exterior angle. |
| **Bearing Averaging**                   | Average directions correctly using circular math.            |
| **Distance Converter**                  | m, ft, US survey ft, chains, links if you care about old plans. |
| **Slope/Horizontal Distance Converter** | Convert slope distance + zenith/vertical angle to horizontal/vertical components. |
| **Grade Calculator**                    | Percent grade, ratio, vertical difference over horizontal distance. |
| **Azimuth Between Coordinates**         | Direct coordinate-to-direction computation.                  |
| **Lat/Departure Calculator**            | Compute northing/easting components from bearing and distance. |

9.Reports and annotations

| Tool                          | What it does                                              |
| ----------------------------- | --------------------------------------------------------- |
| **Bearing/Distance Labels**   | Label selected lines dynamically.                         |
| **Curve Labels**              | Radius, arc, chord, delta, tangent, chord bearing.        |
| **Line/Curve Table**          | Generate legal-style table from selected boundary.        |
| **Point Report**              | Point number, northing, easting, elevation, description.  |
| **Inverse Report**            | Multi-leg bearing/distance report.                        |
| **Traverse Report**           | Raw calls, coordinates, closure, adjustment.              |
| **Parcel Closure Report**     | Boundary calls and closing error.                         |
| **COGO History Log**          | Every calculation stored as reproducible command history. |
| **Export Computation Report** | TXT, CSV, PDF, or markdown.                               |

A killer feature: every created point should know **how it was created**. Example:

```
Point 105
Created by: Bearing-Distance
From: Point 101
Bearing: N 42°15'20" E
Distance: 35.250 m
Timestamp: ...
```

## Recommended build order for Webnet

### Phase 1 — Essential MVP

Build these first:

1. Inverse between points
2. Bearing/azimuth + distance point creation
3. Turned angle + distance
4. Line-line intersection
5. Bearing-bearing intersection
6. Bearing-distance intersection
7. Distance-distance intersection
8. Point projection to line
9. Offset line / offset point
10. Basic curve calculator
11. Arc creation from common inputs
12. Traverse editor with closure report
13. Area by polygon / point sequence
14. Bearing-distance and curve labels

That would already feel like a real survey COGO system.

### Phase 2 — Serious survey CAD

Add:

1. Traverse adjustment: compass/Bowditch, transit rule, angular balance
2. Deed entry / batch COGO parser
3. Parcel split by area
4. Hinged/sliding area tools
5. Station-offset alignment tools
6. Line/curve tables
7. Multi-point transformation with residuals
8. Grid/ground scaling
9. More curve construction methods
10. COGO history/replay system

### Phase 3 — High-end tools

Add:

1. Least-squares traverse/network adjustment integration
2. Spiral/clothoid tools
3. Best-fit line/arc through points
4. Advanced parcel topology tools
5. Legal-description generator
6. Dynamic dependency graph, where computed points update when source geometry changes
7. Field export/stakeout point package

## Implementation note

For Webnet, I would not make these all separate random commands internally. I’d make a shared COGO engine like:

```
type CogoResult = {
  pointsCreated: Point[];
  linesCreated: Line[];
  arcsCreated: Arc[];
  polygonsCreated: Polygon[];
  report: CogoReport;
  warnings: CogoWarning[];
  alternatives?: CogoResult[];
};
```

Then every tool can support:

```
Preview
Create geometry
Store points
Create labels
Generate report
Undo/redo
Save computation history
```

