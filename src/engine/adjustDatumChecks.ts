import type {
  CoordInputClass,
  DatumSufficiencyReport,
  Observation,
  ParseOptions,
  StationMap,
} from '../types';

export const evaluateGridInputGate = ({
  activeObservations,
  crsId,
  gnssFrameConfirmed,
  parseState,
  stations,
}: {
  activeObservations: Observation[];
  crsId: string;
  gnssFrameConfirmed: boolean;
  parseState?: ParseOptions;
  stations: StationMap;
}): {
  blocked: boolean;
  reasons: string[];
  suggestions: string[];
} => {
  const classes = new Set<CoordInputClass>();
  Object.values(stations).forEach((station) => {
    const hasControlLikeInput =
      (station.fixedX ?? false) ||
      (station.fixedY ?? false) ||
      Number.isFinite(station.sx ?? Number.NaN) ||
      Number.isFinite(station.sy ?? Number.NaN) ||
      station.coordInputClass === 'geodetic' ||
      (station.coordInputClass != null && station.coordInputClass !== 'unknown');
    if (!hasControlLikeInput) return;
    classes.add(station.coordInputClass ?? 'unknown');
  });
  const hasGrid = classes.has('grid');
  const hasGeodetic = classes.has('geodetic');
  const hasLocal = classes.has('local');
  const hasUnknown = classes.has('unknown');
  const reasons: string[] = [];
  const suggestions: string[] = [];

  if (hasUnknown) {
    reasons.push(
      'Grid mode input class check failed: one or more stations are UNKNOWN class (including geodetic records missing CRS/datum tagging).',
    );
    suggestions.push(
      'Tag geodetic records with explicit CRS/datum or re-enter as grid/projected coordinates.',
    );
  }
  if (hasLocal && (hasGrid || hasGeodetic)) {
    reasons.push(
      'Grid mode input class check failed: LOCAL coordinates mixed with GRID/GEODETIC coordinates without localization transform.',
    );
    suggestions.push(
      'Remove local records or define a localization workflow before mixing systems.',
    );
  }
  if (hasGeodetic && (!crsId || !crsId.trim())) {
    reasons.push(
      'Grid mode input class check failed: GEODETIC coordinates provided but CRS id is missing.',
    );
    suggestions.push('Set project CRS id before running a grid solve.');
  }

  const unknownGnssRows = activeObservations.filter(
    (obs) =>
      obs.type === 'gps' &&
      (obs.gnssVectorFrame ?? parseState?.gnssVectorFrameDefault ?? 'gridNEU') ===
        'unknown' &&
      !((obs.gnssFrameConfirmed ?? false) || gnssFrameConfirmed),
  );
  if (unknownGnssRows.length > 0) {
    reasons.push(
      `Grid mode GNSS frame check failed: ${unknownGnssRows.length} vector(s) are UNKNOWN frame and not confirmed.`,
    );
    suggestions.push(
      'Set .GPS FRAME to a known frame (GRIDNEU/ENULOCAL/ECEFDELTA/LLHBASELINE) or confirm unknown frame usage.',
    );
  }

  return {
    blocked: reasons.length > 0,
    reasons,
    suggestions,
  };
};

export const evaluateDatumSufficiency = ({
  activeObservations,
  is2D,
  stations,
}: {
  activeObservations: Observation[];
  is2D: boolean;
  stations: StationMap;
}): DatumSufficiencyReport => {
  const reasons: string[] = [];
  const suggestions: string[] = [];
  let status: DatumSufficiencyReport['status'] = 'ok';

  const hasDistanceLike = activeObservations.some(
    (obs) => obs.type === 'dist' || obs.type === 'gps',
  );
  const hasAngularFamilies = activeObservations.some(
    (obs) =>
      obs.type === 'angle' ||
      obs.type === 'bearing' ||
      obs.type === 'dir' ||
      obs.type === 'direction',
  );
  const weightedOrFixedXYCount = Object.values(stations).filter((station) => {
    const fixedXY = (station.fixedX ?? false) && (station.fixedY ?? false);
    const weightedXY =
      Number.isFinite(station.sx ?? Number.NaN) && Number.isFinite(station.sy ?? Number.NaN);
    return fixedXY || weightedXY;
  }).length;
  const weightedOrFixedHCount = Object.values(stations).filter((station) => {
    const fixedH = station.fixedH ?? false;
    const weightedH = Number.isFinite(station.sh ?? Number.NaN);
    return fixedH || weightedH;
  }).length;

  if (is2D) {
    const scaleDefined =
      hasDistanceLike ||
      weightedOrFixedXYCount >= 2 ||
      (weightedOrFixedXYCount >= 1 && !hasAngularFamilies);
    if (!scaleDefined) {
      status = 'hard-fail';
      reasons.push(
        '2D datum sufficiency failed: scale is undefined (no distance-like constraints and control does not constrain scale).',
      );
      suggestions.push(
        'Add at least one distance-like constraint (distance/GNSS) or add fixed/weighted coordinate control that constrains scale.',
      );
    } else if (weightedOrFixedXYCount < 2) {
      status = 'soft-warn';
      reasons.push(
        '2D datum sufficiency warning: weak horizontal datum control (few fixed/weighted coordinate constraints).',
      );
      suggestions.push(
        'Add a second fixed/weighted control point or a fixed azimuth/bearing constraint to strengthen orientation.',
      );
    }
  } else {
    if (weightedOrFixedXYCount === 0) {
      status = 'hard-fail';
      reasons.push(
        '3D datum sufficiency failed: horizontal datum is undefined (no fixed/weighted XY control).',
      );
      suggestions.push('Add fixed or weighted XY control points.');
    } else if (weightedOrFixedXYCount < 2) {
      status = 'soft-warn';
      reasons.push(
        '3D datum sufficiency warning: weak horizontal control (single fixed/weighted XY constraint).',
      );
      suggestions.push('Add another fixed/weighted control point to stabilize orientation/scale.');
    }
    if (weightedOrFixedHCount === 0) {
      status = 'hard-fail';
      reasons.push(
        '3D datum sufficiency failed: vertical datum is undefined (no fixed/weighted height control).',
      );
      suggestions.push('Add fixed/weighted height control or leveling/GNSS height constraints.');
    }
  }

  return { status, reasons, suggestions };
};
