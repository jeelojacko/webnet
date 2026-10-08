import { bestFitPromptForSession, isBestFitSession } from './useSurveyCadBestFitSession';
import type { CommandSession } from './useSurveyCadCommandTypes';
import { isCadLineL1Key } from './useSurveyCadLineL1Keys';
import { cadLineL1Prompt } from './useSurveyCadLineL1Session';
import { isCurveF1Session } from './useSurveyCadCurveF1Session';
import { promptForCurveF1Session, promptForLegacyArcPickSession } from './useSurveyCadCurveF1Text';
import type { CadLineL1SessionState } from './useSurveyCadCommandTypes';
import {
  plineArcThroughOf,
  plineDrawModeOf,
  plineWidthPhaseOf,
  plineWidthSummary,
  PLINE_WIDTH_PROMPT_MESSAGE,
  type PlineCommandSession,
} from './useSurveyCadPlineSession';

export const polygonModeLabel = (mode: 'inscribed' | 'circumscribed'): string =>
  mode === 'inscribed' ? 'Inscribed' : 'Circumscribed';

const polygonPromptForPhase = (
  session: Extract<CommandSession, { key: 'POLYGON' }>,
): string => {
  if (session.phase === 'sides') return 'POLYGON active. Enter the number of sides (3-1024).';
  if (session.phase === 'mode') {
    return `POLYGON active. ${session.sides} sides. Inscribed or Circumscribed? [I/C] <I>.`;
  }
  const modeLabel = session.mode ? polygonModeLabel(session.mode) : 'Inscribed';
  if (session.phase === 'center') {
    return `POLYGON active. ${session.sides} sides ${modeLabel}. Click or enter the center point.`;
  }
  return `POLYGON active. ${session.sides} sides ${modeLabel}. Center ${session.center!.label} captured. Click or enter the radius point.`;
};

/**
 * Phase C2 PLINE prompt: the draw mode, pending arc state, and active
 * nonzero width are always visible, with the C1 option set extended by
 * A/ARC, L/LINE, and W/WIDTH. Legacy C1 status substrings (`N vertices
 * captured`, `first vertex`) are preserved for existing workflows.
 */
const plinePromptForSession = (session: PlineCommandSession): string => {
  if (plineWidthPhaseOf(session)) return PLINE_WIDTH_PROMPT_MESSAGE;
  const widthSuffix = plineWidthSummary(session) == null ? '' : ` (${plineWidthSummary(session)})`;
  const count = session.points.length;
  if (plineDrawModeOf(session) === 'arc') {
    const options = '[L Line / W Width / C Close / U Undo]';
    if (count === 0) {
      return `PLINE active (Arc). Click or enter the first vertex (arc start).${widthSuffix} ${options}`;
    }
    const start = session.points[session.points.length - 1]!;
    if (plineArcThroughOf(session) == null) {
      return count === 1
        ? `PLINE active (Arc). Start ${start.label} captured. Click or enter the arc through-point.${widthSuffix} ${options}`
        : `PLINE active (Arc). ${count} vertices captured. Start ${start.label} captured. Click or enter the arc through-point.${widthSuffix} ${options}`;
    }
    return `PLINE active (Arc). Through-point captured from ${start.label}. Click or enter the arc end point.${widthSuffix} ${options}`;
  }
  const options =
    count < 2 ? '[A Arc / W Width / U Undo]' : '[A Arc / W Width / C Close / U Undo]';
  if (count === 0) {
    return `PLINE active (Line). Click or enter the first vertex.${widthSuffix} ${options}`;
  }
  if (count === 1) {
    return `PLINE active (Line). 1 vertex captured. Click the next point or type it.${widthSuffix} ${options}`;
  }
  if (count === 2) {
    return `PLINE active (Line). 2 vertices captured. Click the next point or press Enter to finish open.${widthSuffix} ${options}`;
  }
  return `PLINE active (Line). ${count} vertices captured. Press Enter to finish open, or type Close to close the ring.${widthSuffix} ${options}`;
};

export const promptForSession = (session: CommandSession | null, fallbackStatus: string): string => {
  if (!session) return fallbackStatus;
  if (isCadLineL1Key(session.key)) return cadLineL1Prompt(session as CadLineL1SessionState);
  if (isBestFitSession(session)) return bestFitPromptForSession(session);
  if (isCurveF1Session(session)) return promptForCurveF1Session(session);
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
    case 'RECTANGLE':
      return session.resultText ??
        (session.firstCorner
          ? `RECTANGLE active. First corner ${session.firstCorner.label} captured. Click or enter the opposite corner.`
          : 'RECTANGLE active. Click or enter the first corner.');
    case 'CIRCLE':
      return session.resultText ??
        (session.center
          ? `CIRCLE active. Center ${session.center.label} captured. Click or enter the radius (point or positive number).`
          : 'CIRCLE active. Click or enter the center point.');
    case 'CIRCLECD':
      return session.resultText ??
        (session.center
          ? `CIRCLECD active. Center ${session.center.label} captured. Click or enter the diameter (point or positive number); radius is half the diameter.`
          : 'CIRCLECD active. Click or enter the center point.');
    case 'CIRCLE2P':
      return session.resultText ??
        (session.first
          ? `CIRCLE2P active. First endpoint ${session.first.label} captured. Click or enter the opposite diameter endpoint.`
          : 'CIRCLE2P active. Click or enter the first diameter endpoint.');
    case 'CIRCLE3P':
      return session.resultText ??
        (session.points.length === 0
          ? 'CIRCLE3P active. Click or enter the first point.'
          : session.points.length === 1
            ? `CIRCLE3P active. First point ${session.points[0].label} captured. Enter the second point.`
            : 'CIRCLE3P active. Two points captured. Enter the third point to commit.');
    case 'CIRCLETTR':
      return session.resultText ??
        (!session.first
          ? 'CIRCLETTR active. Pick the first tangent line, polyline, arc, or circle.'
          : !session.second
            ? 'CIRCLETTR active. First tangent captured. Pick the second tangent object.'
            : 'CIRCLETTR active. Tangents captured. Enter the radius and press Enter.');
    case 'CIRCLETTT':
      return session.resultText ??
        `CIRCLETTT active. ${session.picks.length} tangent object${session.picks.length === 1 ? '' : 's'} captured. Pick a line, polyline, arc, or circle.`;
    case 'POLYGON':
      return session.resultText ?? polygonPromptForPhase(session);
    case 'PLINE':
      return session.resultText ?? plinePromptForSession(session);
    case 'PLINEINSERTVERTEX':
      return session.resultText ??
        (session.polylineId == null
          ? 'PLINEINSERTVERTEX active. Click an editable polyline, or type `x,y` / `C<n>` after selecting one.'
          : 'PLINEINSERTVERTEX active. Click on a course to insert a vertex there, or type `x,y` / `C<n>`.');
    case 'PLINEDELETEVERTEX':
      return session.resultText ??
        (session.polylineId == null
          ? 'PLINEDELETEVERTEX active. Click an editable polyline, or type `V<n>` after selecting one.'
          : 'PLINEDELETEVERTEX active. Click a vertex to delete it, or type `V<n>`.');
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
          ? 'TANGENT_CURVE active (WebNet-native 3-point tangent law: PI + back-tangent + ahead-tangent + radius). Click or enter the PI point.'
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
      return session.arc == null
        ? promptForLegacyArcPickSession(session, '')
        : promptForLegacyArcPickSession(session, `RADIAL_BEARING active. Selected arc ${session.arc.id}. Enter \`PC\`, \`PT\`, or \`MID\`.`);
    case 'POINT_ON_CURVE':
      return session.arc == null
        ? promptForLegacyArcPickSession(session, '')
        : promptForLegacyArcPickSession(session, `POINT_ON_CURVE active. Selected arc ${session.arc.id}. Enter distance as \`ARC,distance\` or \`CHORD,distance\` from the arc start.`);
    case 'SUBDIVIDE_CURVE':
      return session.arc == null
        ? promptForLegacyArcPickSession(session, '')
        : promptForLegacyArcPickSession(session, `SUBDIVIDE_CURVE active. Selected arc ${session.arc.id}. Enter \`EQUAL,count\`, \`ARC,interval\`, or \`CHORD,interval\` to place marker points.`);
    case 'OFFSET_CURVE':
      return session.arc == null
        ? promptForLegacyArcPickSession(session, '')
        : promptForLegacyArcPickSession(session, `OFFSET_CURVE active. Selected arc ${session.arc.id}. Enter \`Ldistance\` or \`Rdistance\`.`);
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
      return session.arc == null
        ? promptForLegacyArcPickSession(session, '')
        : promptForLegacyArcPickSession(session, `REVERSE_CURVE active. Selected arc ${session.arc.id}. Enter \`Lradius,delta\` or \`Rradius,delta\`.`);
    case 'COMPOUND_CURVE':
      return session.arc == null
        ? promptForLegacyArcPickSession(session, '')
        : promptForLegacyArcPickSession(session, `COMPOUND_CURVE active. Selected arc ${session.arc.id}. Enter \`Lradius,delta\` or \`Rradius,delta\`.`);
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
        (session.lineStart == null || session.lineEnd == null
          ? 'LINE_CIRCLE_INTX active. Click a line body first (the infinite line through it is tested, not the segment).'
          : session.circleEntityId != null
            ? `LINE_CIRCLE_INTX active. Line ${session.lineStart.label}-${session.lineEnd.label} + circle ${session.circleEntityId} captured (infinite-line law). Click another circle or press Enter.`
            : session.targetPoint == null
              ? `LINE_CIRCLE_INTX active. Infinite line through ${session.lineStart.label}-${session.lineEnd.label} captured. Click a native circle body, or type the circle center as \`x,y\`.`
              : `LINE_CIRCLE_INTX active. Enter the radius from center ${session.targetPoint.label} (legacy center+radius path).`);
    case 'PERP_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? (session.lineStart == null || session.lineEnd == null
              ? 'PERP_INTX active. Select a line first.'
              : `PERP_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the external point.`)
          : `PERP_INTX active. Press Enter to create the perpendicular foot from ${session.targetPoint.label}.`);
    case 'OFFSET_INTX':
      return session.resultText ??
        `OFFSET_INTX active. Enter \`Loff1,Roff2\` for ${session.firstLineStart.label}-${session.firstLineEnd.label} and ${session.secondLineStart.label}-${session.secondLineEnd.label}.`;
    case 'SKEW_INTX':
      return session.resultText ??
        (session.targetPoint == null
          ? (session.lineStart == null || session.lineEnd == null
              ? 'SKEW_INTX active. Select a line first.'
              : `SKEW_INTX active. Selected line ${session.lineStart.label}-${session.lineEnd.label}. Click or enter the source point.`)
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
    case 'ROTATE':
      return session.resultText ??
        (!session.basePoint
          ? 'ROTATE active. Click or enter the base point for the current selection.'
          : !session.refPoint
            ? `ROTATE active. Base ${session.basePoint.label} captured. Type the angle in degrees (positive = counter-clockwise) and press Enter, or click a reference point.`
            : `ROTATE active. Base ${session.basePoint.label} and reference ${session.refPoint.label} captured. Click the new direction, or type the angle in degrees and press Enter.`);
    case 'SCALE':
      return session.resultText ??
        (session.basePoint
          ? `SCALE active. Base ${session.basePoint.label} captured. Type a positive scale factor and press Enter.`
          : 'SCALE active. Click or enter the base point for the current selection.');
    case 'MIRROR':
      return session.resultText ??
        (!session.firstPoint
          ? 'MIRROR active. Click or enter the first mirror-axis point.'
          : !session.secondPoint
            ? `MIRROR active. First axis point ${session.firstPoint.label} captured. Click or enter the second axis point.`
            : 'MIRROR active. Axis captured. Erase source objects? [Yes/No] <No>.');
    case 'ALIGN2D':
      return session.resultText ??
        (!session.source1
          ? 'ALIGN2D active. Click or enter the first source point.'
          : !session.source2
            ? `ALIGN2D active. First source ${session.source1.label} captured. Click or enter the second source point.`
            : !session.target1
              ? 'ALIGN2D active. Source pair captured. Click or enter the first target point.'
              : !session.target2
                ? `ALIGN2D active. First target ${session.target1.label} captured. Click or enter the second target point.`
                : 'ALIGN2D active. Points captured. Scale objects based on alignment points? [Yes/No] <No>.');
    case 'HELMERT2D':
      return session.resultText ??
        (session.pendingSource
          ? `HELMERT2D ${session.mode} active. Source ${session.pendingSource.label} captured (${session.pairs.length} pair${session.pairs.length === 1 ? '' : 's'}). Click or enter the target point, or type \`sx,sy,tx,ty\` to add a pair.`
          : session.pairs.length < 2
            ? `HELMERT2D ${session.mode} active. Click or enter source ${session.pairs.length + 1}, then its target (need ${2 - session.pairs.length} more pair${2 - session.pairs.length === 1 ? '' : 's'} to preview).`
            : `HELMERT2D ${session.mode} active. ${session.pairs.length} pairs; live preview with solved fit. Add more pairs, type \`APPLY\` to commit, or use the panel.`);
    case 'GRIDGROUND':
      return session.resultText ??
        (!session.origin
          ? 'GRIDGROUND active. Click or enter the origin E/N (scale center).'
          : session.combinedScaleFactor == null
            ? `GRIDGROUND ${session.direction === 'GRID_TO_GROUND' ? 'Grid->Ground' : 'Ground->Grid'} active. Origin ${session.origin.label} captured. Type the combined scale factor and press Enter.`
            : `GRIDGROUND ${session.direction === 'GRID_TO_GROUND' ? 'Grid->Ground' : 'Ground->Grid'} active. Factor ${session.combinedScaleFactor} captured. Type \`APPLY\` to commit, or use the panel.`);
    case 'PROJECTTRANSFORM':
      return session.resultText ??
        (session.projectMode === 'HELMERT'
          ? session.pendingSource
            ? `PROJECTTRANSFORM Helmert ${session.helmertMode} (whole drawing). Source ${session.pendingSource.label} captured (${session.pairs.length} pairs). Pick or type its target.`
            : `PROJECTTRANSFORM Helmert ${session.helmertMode} (whole drawing). Add ${2 - session.pairs.length > 0 ? '2+' : 'more'} control pairs, then \`APPLY\` or use the panel.`
          : !session.origin
            ? 'PROJECTTRANSFORM Grid/Ground (whole drawing). Click or enter the origin E/N (scale center).'
            : session.combinedScaleFactor == null
              ? `PROJECTTRANSFORM ${session.direction === 'GRID_TO_GROUND' ? 'Grid->Ground' : 'Ground->Grid'} (whole drawing). Origin ${session.origin.label} captured. Type the CSF.`
              : `PROJECTTRANSFORM ${session.direction === 'GRID_TO_GROUND' ? 'Grid->Ground' : 'Ground->Grid'} (whole drawing). CSF ${session.combinedScaleFactor} captured. Type \`APPLY\` to commit.`);
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
    case 'MTEXT':
      return session.resultText ??
        (session.point
          ? `MTEXT active. Insertion captured. Type a line and press Enter (repeat for more lines), then Esc to commit${session.lines.length > 0 ? ` (${session.lines.length} line${session.lines.length === 1 ? '' : 's'}).` : '.'}`
          : 'MTEXT active. Click the insertion point.');
    case 'LEADER':
      return session.resultText ??
        (session.arrowPoint
          ? 'LEADER active. Arrow point captured. Type the note and press Enter, then Esc to commit.'
          : 'LEADER active. Click the arrow point.');
    case 'DIM':
    case 'DIMLINEAR':
      return session.resultText ?? 'DIMLINEAR active. Click two definition points, then the dimension-line point.';
    case 'DIMALIGNED':
      return session.resultText ?? 'DIMALIGNED active. Click two definition points, then the dimension-line point.';
    case 'DIMANGULAR':
      return session.resultText ?? 'DIMANGULAR active. Click the vertex, two ray points, then the dimension-line point.';
    case 'DIMRADIUS':
      return session.resultText ?? 'DIMRADIUS active. Click on the arc, then the dimension-line point.';
    case 'DIMDIAMETER':
      return session.resultText ?? 'DIMDIAMETER active. Click on the arc, then the dimension-line point.';
    case 'BDLABEL':
      return session.resultText ?? 'BDLABEL active. Click a line to label, then Esc to commit.';
    case 'CURVELABEL':
      return session.resultText ?? 'CURVELABEL active. Click an arc to label.';
    case 'SURVEYTABLE':
      return session.resultText ??
        (session.insertion
          ? 'SURVEYTABLE insertion captured.'
          : 'SURVEYTABLE active. Click the table insertion point.');
    case 'PARCELDESIGNATE':
      return session.resultText ?? `PARCELDESIGNATE active. ${session.parcelEntityIds.length} parcel(s) selected. Type \`designation[; role][; description]\` and press Enter.`;
    case 'PARCELNUMBER':
      return session.resultText ?? `PARCELNUMBER active. ${session.parcelEntityIds.length} parcel(s) selected. Type \`[prefix][, start][, pad]\` (empty = Lot 1, 2, …) and press Enter.`;
    case 'PARCELLINK':
      return session.resultText ?? `PARCELLINK active. ${session.parcelEntityIds.length} parcel(s) selected. Press Enter to link coincident courses.`;
    case 'PARCELUNLINK':
      return session.resultText ?? `PARCELUNLINK active. Press Enter to list links on the selected parcels, then type 1–N or ALL.`;
    case 'PARCELCHECK':
      return session.resultText ?? 'PARCELCHECK active. Press Enter to run plan-topology QA (read-only).';
    case 'PARCELSCHEDULE':
      return session.resultText ?? 'PARCELSCHEDULE active. Press Enter to derive the live parcel schedule (read-only).';
    case 'PARCELSHAREDEDIT':
      return session.resultText ?? 'PARCELSHAREDEDIT active. Press Enter for usage, then type `from x,y`, `to x,y`, `line`, or `bulge <n>`.';
  }
};

export { helpTextForSession } from './useSurveyCadCommandHelpText';
