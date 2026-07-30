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

export { helpTextForSession } from './useSurveyCadCommandHelpText';
