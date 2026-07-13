import type { CommandSession } from './useSurveyCadCommandTypes';

export const promptForSession = (session: CommandSession | null, fallbackStatus: string): string => {
  if (!session) return fallbackStatus;
  switch (session.key) {
    case 'POINT':
      return session.resultText ?? 'POINT active. Click in model space or enter `x,y` / `LABEL=x,y`, then press Enter.';
    case 'COGO_POINT':
      return session.resultText ??
        (session.startPoint
          ? `COGO_POINT active. Base ${session.startPoint.label} captured. Enter target as \`@azimuth,distance\`, \`N45-00-00E,100\`, or absolute \`x,y\`.`
          : 'COGO_POINT active. Click or enter the base point.');
    case 'LINE':
      return session.resultText ??
        (session.startPoint
          ? `LINE active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`
          : 'LINE active. Click or enter the start point.');
    case 'PLINE':
      return session.resultText ??
        (session.points.length > 0
          ? `PLINE active. ${session.points.length} vertex${session.points.length === 1 ? '' : 'es'} captured. Click the next point or press Enter on an empty input to finish once 2+ vertices exist.`
          : 'PLINE active. Click or enter the first vertex.');
    case 'TRAVERSE':
      return session.resultText ??
        (session.points.length > 0
          ? `TRAVERSE ${session.mode} active. ${session.points.length} station${session.points.length === 1 ? '' : 's'} captured. Enter the next leg as \`@azimuth,distance\` or bearing-distance, or click another point.`
          : 'TRAVERSE active. Click or enter the first station.');
    case 'BATCH_COGO':
      return session.resultText ??
        `BATCH_COGO active. Paste deed calls in the batch panel. Use a selected start point or begin with \`START LABEL=x,y\`.`;
    case 'ARC_3PT':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC_3PT active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC_3PT active. Start ${session.points[0].label} captured. Enter the through point.`
            : `ARC_3PT active. Start ${session.points[0].label} and through ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_SCE':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SCE active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SCE active. Start ${session.points[0].label} captured. Enter the center point.`
            : `ARC SCE active. Start ${session.points[0].label} and center ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_CSE':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC CSE active. Click or enter the center point.'
          : session.points.length === 1
            ? `ARC CSE active. Center ${session.points[0].label} captured. Enter the start point.`
            : `ARC CSE active. Center ${session.points[0].label} and start ${session.points[1]?.label} captured. Enter the end point.`);
    case 'ARC_SCA':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCA active. Click or enter the start point.'
              : `ARC SCA active. Start ${session.points[0].label} captured. Enter the center point.`)
          : `ARC SCA active. Enter the included angle in degrees.${''}`);
    case 'ARC_CSA':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC CSA active. Click or enter the center point.'
              : `ARC CSA active. Center ${session.points[0].label} captured. Enter the start point.`)
          : 'ARC CSA active. Enter the included angle in degrees.');
    case 'ARC_SCL':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC SCL active. Click or enter the start point.'
              : `ARC SCL active. Start ${session.points[0].label} captured. Enter the center point.`)
          : 'ARC SCL active. Enter the chord length.');
    case 'ARC_CSL':
      return session.resultText ??
        (session.points.length < 2
          ? (session.points.length === 0
              ? 'ARC CSL active. Click or enter the center point.'
              : `ARC CSL active. Center ${session.points[0].label} captured. Enter the start point.`)
          : 'ARC CSL active. Enter the chord length.');
    case 'ARC_SEA':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SEA active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SEA active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SEA active. Enter the included angle in degrees.');
    case 'ARC_SED':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SED active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SED active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SED active. Enter the start direction as azimuth or survey bearing.');
    case 'ARC_SER':
      return session.resultText ??
        (session.points.length === 0
          ? 'ARC SER active. Click or enter the start point.'
          : session.points.length === 1
            ? `ARC SER active. Start ${session.points[0].label} captured. Enter the end point.`
            : 'ARC SER active. Enter the radius.');
    case 'CONTINUE_CURVE':
      return session.resultText ??
        `CONTINUE CURVE active. Source arc ${session.sourceArc.id} captured. Enter the next end point.`;
    case 'TANGENT_CURVE':
      return session.resultText ??
        (session.piPoint == null
          ? 'TANGENT_CURVE active. Click or enter the PI point.'
          : session.backTangentPoint == null
            ? `TANGENT_CURVE active. PI ${session.piPoint.label} captured. Enter the back tangent point.`
            : session.aheadTangentPoint == null
              ? `TANGENT_CURVE active. PI ${session.piPoint.label} and back point ${session.backTangentPoint.label} captured. Enter the ahead tangent point.`
              : `TANGENT_CURVE active. Enter the radius for PI ${session.piPoint.label}.`);
    case 'INVERSE':
      return session.resultText ??
        (session.startPoint
          ? `INVERSE active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`
          : 'INVERSE active. Click or enter the first point.');
    case 'MULTI_INVERSE':
      return session.resultText ??
        (session.points.length > 0
          ? `MULTI_INVERSE active. ${session.points.length} point${session.points.length === 1 ? '' : 's'} captured. Click the next point or press Enter on an empty input to report the sequence.`
          : 'MULTI_INVERSE active. Click or enter the first point.');
    case 'AREA':
      return session.resultText ??
        (session.points.length > 0
          ? `AREA active. ${session.points.length} point${session.points.length === 1 ? '' : 's'} captured. Click the next point or press Enter on an empty input to report the loop.`
          : 'AREA active. Click or enter the first point.');
    case 'PARCEL_SPLIT_BEARING':
      return session.resultText ??
        (session.splitPoint == null
          ? `PARCEL SPLIT bearing active on ${session.parcel.parcelName}. Click or enter the through point.`
          : `PARCEL SPLIT bearing active on ${session.parcel.parcelName}. Through point ${session.splitPoint.label} captured. Enter the bearing, then press Enter.`);
    case 'PARCEL_SPLIT_AREA':
      return session.resultText ??
        (session.splitPoint == null
          ? `PARCEL SPLIT area active on ${session.parcel.parcelName}. Click or enter the through point.`
          : `PARCEL SPLIT area active on ${session.parcel.parcelName}. Through point ${session.splitPoint.label} captured. Enter the target area in square meters, then press Enter.`);
    case 'BEARING_REPORT':
      return session.resultText ??
        (session.startPoint
          ? `BEARING report active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`.`
          : 'BEARING report active. Click or enter the first point.');
    case 'DISTANCE_REPORT':
      return session.resultText ??
        (session.startPoint
          ? `DISTANCE report active. Start at ${session.startPoint.label}. Click the end point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`.`
          : 'DISTANCE report active. Click or enter the first point.');
    case 'TURNED_POINT':
      return session.resultText ??
        (session.occupyPoint == null
          ? 'TURNED_POINT active. Click or enter the occupied point.'
          : session.backsightPoint == null
            ? `TURNED_POINT active. Occupied point ${session.occupyPoint.label} captured. Click or enter the backsight point.`
            : `TURNED_POINT active. Enter \`Langle,distance\` or \`Rangle,distance\` from ${session.occupyPoint.label}.`);
    case 'DEFLECT_POINT':
      return session.resultText ??
        `DEFLECT_POINT active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter \`Langle,distance\` or \`Rangle,distance\`.`;
    case 'POINT_ALONG_LINE':
      return session.resultText ??
        `POINT_ALONG_LINE active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter distance or percent like \`25\` or \`50%\`.`;
    case 'EXTEND_LINE':
      return session.resultText ??
        `EXTEND_LINE active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter extension distance.`;
    case 'OFFSET_POINT':
      return session.resultText ??
        `OFFSET_POINT active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Enter \`Loffset,along\` or \`Roffset,along\`, with along as distance or percent.`;
    case 'ALIGNMENT_OFFSET_CREATE':
      return session.resultText ??
        `ALIGN OFF active. Selected alignment ${session.alignment.name}. Enter \`offset\` or \`NAME=offset\`.`;
    case 'ALIGNMENT_STATION_EQUATION':
      return session.resultText ??
        `STA EQ active. Selected alignment ${session.alignment.name}. Enter \`backStation,aheadStation\`.`;
    case 'ALIGNMENT_OFFSET_POINT':
      return session.resultText ??
        `STA PT active. Selected alignment ${session.alignment.name}. Enter \`station,offset\` or \`LABEL=station,offset\`.`;
    case 'ALIGNMENT_INTERVAL_POINTS':
      return session.resultText ??
        `STA INT active. Selected alignment ${session.alignment.name}. Enter \`interval\` or \`start,end,interval\`, with optional \`LABEL=\` prefix.`;
    case 'CURVE_SOLVER':
      return session.resultText ?? 'CURVE_SOLVER active. Enter `param1,param2,value1,value2` such as `radius,delta,200,60`.';
    case 'RADIAL_BEARING':
      return session.resultText ?? `RADIAL_BEARING active. Selected arc ${session.arc.id}. Enter \`PC\`, \`PT\`, or \`MID\`.`;
    case 'POINT_ON_CURVE':
      return session.resultText ?? `POINT_ON_CURVE active. Selected arc ${session.arc.id}. Enter \`ARC,distance\` or \`CHORD,distance\`.`;
    case 'SUBDIVIDE_CURVE':
      return session.resultText ?? `SUBDIVIDE_CURVE active. Selected arc ${session.arc.id}. Enter \`EQUAL,count\`, \`ARC,interval\`, or \`CHORD,interval\`.`;
    case 'OFFSET_CURVE':
      return session.resultText ?? `OFFSET_CURVE active. Selected arc ${session.arc.id}. Enter \`Ldistance\` or \`Rdistance\`.`;
    case 'PI_CURVE':
      return session.resultText ??
        (session.piPoint == null
          ? 'PI_CURVE active. Click or enter the PI point.'
          : session.backTangentPoint == null
            ? `PI_CURVE active. PI ${session.piPoint.label} captured. Click or enter the back tangent point.`
            : `PI_CURVE active. Enter \`Lradius,delta\` or \`Rradius,delta\` from PI ${session.piPoint.label}.`);
    case 'CHORD_BEARING_CURVE':
      return session.resultText ??
        (session.startPoint == null
          ? 'CHORD_BEARING_CURVE active. Click or enter the start point.'
          : `CHORD_BEARING_CURVE active. Enter \`bearing,chord,radius,L|R\` from ${session.startPoint.label}.`);
    case 'REVERSE_CURVE':
      return session.resultText ?? `REVERSE_CURVE active. Selected arc ${session.arc.id}. Enter \`Lradius,delta\` or \`Rradius,delta\`.`;
    case 'COMPOUND_CURVE':
      return session.resultText ?? `COMPOUND_CURVE active. Selected arc ${session.arc.id}. Enter \`Lradius,delta\` or \`Rradius,delta\`.`;
    case 'BEARING_BEARING_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'BEARING_BEARING_INTX active. Click or enter the first origin point.'
          : session.secondPoint == null
            ? `BEARING_BEARING_INTX active. First origin ${session.firstPoint.label} captured. Click or enter the second origin point.`
            : `BEARING_BEARING_INTX active. Enter \`bearing1;bearing2\` from ${session.firstPoint.label} and ${session.secondPoint.label}.`);
    case 'BEARING_DISTANCE_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'BEARING_DISTANCE_INTX active. Click or enter the bearing origin point.'
          : session.secondPoint == null
            ? `BEARING_DISTANCE_INTX active. Bearing origin ${session.firstPoint.label} captured. Click or enter the distance center point.`
            : `BEARING_DISTANCE_INTX active. Enter \`bearing;distance\` from ${session.firstPoint.label} against ${session.secondPoint.label}.`);
    case 'DISTANCE_DISTANCE_INTX':
      return session.resultText ??
        (session.firstPoint == null
          ? 'DISTANCE_DISTANCE_INTX active. Click or enter the first center point.'
          : session.secondPoint == null
            ? `DISTANCE_DISTANCE_INTX active. First center ${session.firstPoint.label} captured. Click or enter the second center point.`
            : `DISTANCE_DISTANCE_INTX active. Enter \`distance1,distance2\` from ${session.firstPoint.label} and ${session.secondPoint.label}.`);
    case 'LINE_CIRCLE_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `LINE_CIRCLE_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the circle center point.`
          : `LINE_CIRCLE_INTX active. Enter the radius from center ${session.targetPoint.label}.`);
    case 'PERP_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `PERP_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the external point.`
          : `PERP_INTX active. Press Enter to create the perpendicular foot from ${session.targetPoint.label}.`);
    case 'OFFSET_INTX':
      return session.resultText ??
        `OFFSET_INTX active. Enter \`Loff1,Roff2\` for ${session.firstLineStart.label}-${session.firstLineEnd.label} and ${session.secondLineStart.label}-${session.secondLineEnd.label}.`;
    case 'SKEW_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? `SKEW_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the source point.`
          : `SKEW_INTX active. Enter \`Langle\` or \`Rangle\` from ${session.targetPoint.label}.`);
    case 'MOVE':
      return session.resultText ??
        (session.startPoint
          ? `MOVE active. Base point ${session.startPoint.label} captured. Click the target point or enter \`@azimuth,distance\` / bearing-distance, then press Enter.`
          : 'MOVE active. Click or enter the base point for the current selection.');
    case 'COPY':
      return session.resultText ??
        (session.startPoint
          ? `COPY active. Base point ${session.startPoint.label} captured. Click the target point or enter \`@azimuth,distance\` / bearing-distance, then press Enter.`
          : 'COPY active. Click or enter the base point for the current selection.');
    case 'EXTEND':
      return session.resultText ??
        (session.firstTargetEntityId == null
          ? 'EXT active. Click the first line, polyline, or arc to extend.'
          : 'EXT active. Source entity captured. Click the boundary line, polyline, or arc to extend to. Enter or Esc ends the command.');
    case 'TRIM':
      return session.resultText ??
        (session.firstEntityId == null
          ? 'TRIM active. Click the first line, polyline, or arc to use as the cutting edge.'
          : 'TRIM active. First entity captured. Click the target portion to trim against it. Enter or Esc ends the command.');
    case 'FILLET':
      return session.resultText ??
        (session.radius == null
          ? 'FILLET active. Enter the fillet radius, then press Enter.'
          : session.firstEntityId == null
            ? `FILLET active. Radius ${session.radius.toFixed(3)} m set. Click the first line, polyline, or arc near the corner to round.`
            : `FILLET active. Radius ${session.radius.toFixed(3)} m set. First entity captured. Click the second line, polyline, or arc near the same corner, or press Enter/Esc to finish.`);
    case 'PASTE':
      return session.resultText ??
        `PASTE active. Clipboard base ${session.startPoint.label} captured. Click the insertion point or enter \`x,y\`, \`@azimuth,distance\`, or \`N45-00-00E,100\`, then press Enter.`;
  }
};

export const helpTextForSession = (session: CommandSession | null): string => {
  if (!session) {
      return 'Interactive commands accept `x,y`, optional `LABEL=x,y`, `@azimuth,distance`, and survey bearing-distance like `N45-00-00E,100`.';
  }
  switch (session.key) {
    case 'POINT':
      return 'POINT input: click in the model space, or type `x,y` / `LABEL=x,y`. Enter commits. Esc cancels.';
    case 'COGO_POINT':
      return session.startPoint
        ? 'COGO_POINT target: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or survey bearing-distance like `N45-00-00E,100` from the base point.'
        : 'COGO_POINT base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'LINE':
      return session.startPoint
        ? 'LINE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or `N45-00-00E,100` from the first point.'
        : 'LINE first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'PLINE':
      return session.points.length > 0
        ? 'PLINE next vertex: click in the model space or type `x,y`, `@azimuth,distance`, or bearing-distance from the last vertex. Press Enter on an empty input to finish after 2+ vertices.'
        : 'PLINE first vertex: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'TRAVERSE':
      return session.points.length > 0
        ? session.mode === 'point-to-point'
          ? 'TRAVERSE next leg: click the next station, or type `@azimuth,distance` / `N45-00-00E,100` from the last station. Select a survey point as the close target before finishing point-to-point traverse.'
          : 'TRAVERSE next leg: click the next station, or type `@azimuth,distance` / `N45-00-00E,100` from the last station. Press Enter on an empty input to finish after 2+ stations.'
        : 'TRAVERSE first station: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'BATCH_COGO':
      return 'BATCH_COGO input lives in the batch panel. Supported rows: `START LABEL=x,y`, deed bearing-distance like `N 35°24\'10" E 125.32`, `LABEL=N45-00-00E,100`, `@45,100`, and tangent curves like `CURVE LEFT R 50 DELTA 30`.';
    case 'ARC_3PT':
      return session.points.length < 2
        ? 'ARC 3PT point input: click in the model space or type `x,y` / `LABEL=x,y`. The through point fixes the arc side, so Ctrl flip is not used here.'
        : 'ARC 3PT end point: click in the model space or type `x,y` / `LABEL=x,y` to commit the arc. The through point fixes the arc side, so Ctrl flip is not used here.';
    case 'ARC_SCE':
      return session.points.length < 2
        ? 'ARC Start-Center-End point input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.'
        : 'ARC Start-Center-End end point input: click in model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.';
    case 'ARC_CSE':
      return session.points.length < 2
        ? 'ARC Center-Start-End point input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.'
        : 'ARC Center-Start-End end point input: click in model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the arc direction.';
    case 'ARC_SCA':
      return session.points.length < 2
        ? 'ARC Start-Center-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Angle value input: enter a positive included angle in degrees. Hold Ctrl to reverse direction.';
    case 'ARC_CSA':
      return session.points.length < 2
        ? 'ARC Center-Start-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Center-Start-Angle value input: enter a positive included angle in degrees. Hold Ctrl to reverse direction.';
    case 'ARC_SCL':
      return session.points.length < 2
        ? 'ARC Start-Center-Length point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-Center-Length value input: enter a positive chord length. Hold Ctrl to reverse direction.';
    case 'ARC_CSL':
      return session.points.length < 2
        ? 'ARC Center-Start-Length point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Center-Start-Length value input: enter a positive chord length. Hold Ctrl to reverse direction.';
    case 'ARC_SEA':
      return session.points.length < 2
        ? 'ARC Start-End-Angle point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Angle value input: enter a positive included angle in degrees. Hold Ctrl to use the opposite bulge.';
    case 'ARC_SED':
      return session.points.length < 2
        ? 'ARC Start-End-Direction point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Direction value input: enter a start tangent azimuth or survey bearing. Hold Ctrl to reverse the turn side.';
    case 'ARC_SER':
      return session.points.length < 2
        ? 'ARC Start-End-Radius point input: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'ARC Start-End-Radius value input: enter a positive radius. Hold Ctrl to use the opposite bulge.';
    case 'CONTINUE_CURVE':
      return 'Continue Curve input: click in the model space or type `x,y` / `LABEL=x,y`. Hold Ctrl to reverse the continuation side.';
    case 'TANGENT_CURVE':
      return session.aheadTangentPoint
        ? 'Tangent curve radius input: numeric radius only.'
        : 'Tangent curve point input: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'INVERSE':
      return session.startPoint
        ? 'INVERSE second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'INVERSE first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'MULTI_INVERSE':
      return session.points.length > 0
        ? 'MULTI_INVERSE next point: click in model space or type `x,y` / relative bearing-distance. Press Enter on an empty input to finish the report.'
        : 'MULTI_INVERSE first point: click in model space or type `x,y` / `LABEL=x,y`.';
    case 'AREA':
      return session.points.length > 0
        ? 'AREA next point: click in model space or type `x,y` / relative bearing-distance. Press Enter on an empty input to close and report the loop after 3+ points.'
        : 'AREA first point: click in model space or type `x,y` / `LABEL=x,y`.';
    case 'PARCEL_SPLIT_BEARING':
      return session.splitPoint == null
        ? 'PARCEL SPLIT bearing through point: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'PARCEL SPLIT bearing input: enter an azimuth or survey bearing like `N45-00-00E`.';
    case 'PARCEL_SPLIT_AREA':
      return session.splitPoint == null
        ? 'PARCEL SPLIT area through point: click in the model space or type `x,y` / `LABEL=x,y`.'
        : 'PARCEL SPLIT area input: enter the target child area in square meters.';
    case 'BEARING_REPORT':
      return session.startPoint
        ? 'BEARING report second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'BEARING report first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'DISTANCE_REPORT':
      return session.startPoint
        ? 'DISTANCE report second point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the first point.'
        : 'DISTANCE report first point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'TURNED_POINT':
      return session.backsightPoint
        ? 'TURNED_POINT value input: enter `Langle,distance` or `Rangle,distance`. Angle accepts decimal degrees or `dd-mm-ss`.'
        : 'TURNED_POINT point input: click in model space or type `x,y` / `LABEL=x,y` for occupied and backsight points.';
    case 'DEFLECT_POINT':
      return 'DEFLECT_POINT value input: enter `Langle,distance` or `Rangle,distance`. Angle accepts decimal degrees or `dd-mm-ss`.';
    case 'POINT_ALONG_LINE':
      return 'POINT_ALONG_LINE input: enter distance from start, or percent like `50%`.';
    case 'EXTEND_LINE':
      return 'EXTEND_LINE input: enter extension distance from the selected line end.';
    case 'OFFSET_POINT':
      return 'OFFSET_POINT input: enter `Loffset,along` or `Roffset,along`; along may be distance or percent like `50%`.';
    case 'ALIGNMENT_OFFSET_CREATE':
      return 'ALIGN OFF input: enter `offset` or `NAME=offset`. Positive offset follows the current station report sign.';
    case 'ALIGNMENT_STATION_EQUATION':
      return 'STA EQ input: enter `backStation,aheadStation`; ahead must stay at or above back.';
    case 'ALIGNMENT_OFFSET_POINT':
      return 'STA PT input: enter `station,offset` or `LABEL=station,offset`. Positive offset follows the current station report sign.';
    case 'ALIGNMENT_INTERVAL_POINTS':
      return 'STA INT input: enter `interval` for full alignment coverage or `start,end,interval`; optional `LABEL=` sets a point-label prefix.';
    case 'CURVE_SOLVER':
      return 'CURVE_SOLVER input: enter `param1,param2,value1,value2`, for example `radius,delta,200,60` or `arc,chord,125,120`.';
    case 'RADIAL_BEARING':
      return 'RADIAL_BEARING input: enter `PC`, `PT`, or `MID` for the selected arc.';
    case 'POINT_ON_CURVE':
      return 'POINT_ON_CURVE input: enter `ARC,distance` or `CHORD,distance` from the selected arc start.';
    case 'SUBDIVIDE_CURVE':
      return 'SUBDIVIDE_CURVE input: enter `EQUAL,count`, `ARC,interval`, or `CHORD,interval`.';
    case 'OFFSET_CURVE':
      return 'OFFSET_CURVE input: enter `Ldistance` or `Rdistance` from the selected arc.';
    case 'PI_CURVE':
      return session.backTangentPoint
        ? 'PI_CURVE value input: enter `Lradius,delta` or `Rradius,delta`.'
        : 'PI_CURVE point input: click in model space or type `x,y` / `LABEL=x,y` for PI and back tangent points.';
    case 'CHORD_BEARING_CURVE':
      return session.startPoint
        ? 'CHORD_BEARING_CURVE input: enter `bearing,chord,radius,L|R`.'
        : 'CHORD_BEARING_CURVE point input: click in the model space or type `x,y` / `LABEL=x,y` for the start point.';
    case 'REVERSE_CURVE':
      return 'REVERSE_CURVE input: enter `Lradius,delta` or `Rradius,delta` to continue opposite the selected arc.';
    case 'COMPOUND_CURVE':
      return 'COMPOUND_CURVE input: enter `Lradius,delta` or `Rradius,delta` to continue same-side from the selected arc.';
    case 'BEARING_BEARING_INTX':
      return session.secondPoint
        ? 'BEARING_BEARING_INTX input: enter `bearing1;bearing2`, for example `N45-00-00E;S10-00-00E`.'
        : 'BEARING_BEARING_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for both origin points.';
    case 'BEARING_DISTANCE_INTX':
      return session.secondPoint
        ? 'BEARING_DISTANCE_INTX input: enter `bearing;distance`, for example `N45-00-00E;25.000`.'
        : 'BEARING_DISTANCE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the bearing origin and distance center.';
    case 'DISTANCE_DISTANCE_INTX':
      return session.secondPoint
        ? 'DISTANCE_DISTANCE_INTX input: enter `distance1,distance2`.'
        : 'DISTANCE_DISTANCE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for both circle centers.';
    case 'LINE_CIRCLE_INTX':
      return session.targetPoint
        ? 'LINE_CIRCLE_INTX input: enter the circle radius as a positive number.'
        : 'LINE_CIRCLE_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the circle center.';
    case 'PERP_INTX':
      return session.targetPoint
        ? 'PERP_INTX creates the perpendicular foot immediately after the external point is captured.'
        : 'PERP_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the external point.';
    case 'OFFSET_INTX':
      return 'OFFSET_INTX input: enter `Loff1,Roff2` style offsets for the two selected lines.';
    case 'SKEW_INTX':
      return session.targetPoint
        ? 'SKEW_INTX input: enter `Langle` or `Rangle`, for example `R30`.'
        : 'SKEW_INTX point input: click in model space or type `x,y` / `LABEL=x,y` for the source point.';
    case 'MOVE':
      return session.startPoint
        ? 'MOVE target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'MOVE base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'COPY':
      return session.startPoint
        ? 'COPY target point: `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the base point.'
        : 'COPY base point: click in the model space or type `x,y` / `LABEL=x,y`.';
    case 'EXTEND':
      return session.firstTargetEntityId == null
        ? 'EXT input: click the line, polyline, or arc you want to extend.'
        : 'EXT boundary pick: click the line, polyline, or arc to extend to. After commit, EXT resets for the next source/boundary pair until Enter, Esc, or empty-space double-click ends it.';
    case 'TRIM':
      return session.firstEntityId == null
        ? 'TRIM input: click the first line, polyline, or arc as the cutting edge.'
        : 'TRIM target pick: click the target portion to remove against the captured cutting edge. After commit, TRIM resets for the next first-entity/second-entity pair until Enter, Esc, or empty-space double-click ends it.';
    case 'FILLET':
      return session.radius == null
        ? 'FILLET input: enter a zero-or-greater radius, then click the first and second line, polyline, or arc near the corner. Radius 0 keeps a hard intersection corner. The same radius stays active until Enter, Esc, or empty-space double-click ends the tool.'
        : 'FILLET picks: click two lines, polylines, or arcs near the corner to round. The current radius stays active for repeated corners until Enter, Esc, or empty-space double-click ends the tool.';
    case 'PASTE':
      return 'PASTE insertion point: click in the model space or type `x,y`, `LABEL=x,y`, `@azimuth,distance`, or bearing-distance from the clipboard base point.';
  }
};
