import {
  buildCadDistanceSummary,
  buildCadInverseSummary,
  cadIntersectPerpendicular,
  formatCadBearing,
} from '../../engine/cad/cadCogo';
import { buildCadCogoComputation } from '../../engine/cad/cadCogoTypes';
import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import type { HandleSurveyCadConsumePointOptions } from './useSurveyCadConsumePoint.types';

export const handleReportPointPick = ({
  current,
  point,
  publishReport,
  replaceSession,
}: Pick<HandleSurveyCadConsumePointOptions, 'current' | 'point' | 'publishReport' | 'replaceSession'>): boolean => {
  if (current.key !== 'BEARING_REPORT' && current.key !== 'DISTANCE_REPORT') return false;
  if (!current.startPoint) {
    replaceSession({
      ...current,
      startPoint: point,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }

  const startPoint = current.startPoint;
  const inverse = buildCadInverseSummary(startPoint, point);
  const distance = buildCadDistanceSummary(startPoint, point);
  if (current.key === 'BEARING_REPORT') {
    publishReport(
      'BEARING_REPORT',
      'Bearing Between Points',
      `Computed bearing from ${startPoint.label} to ${point.label}`,
      [
        { label: 'From', value: startPoint.label },
        { label: 'To', value: point.label },
        { label: 'Bearing', value: inverse.bearing },
        { label: 'Azimuth', value: inverse.azimuthDeg.toFixed(4), unit: 'deg' },
      ],
    );
    replaceSession({
      ...current,
      startPoint: null,
      inputValue: '',
      resultText: `BEARING ${startPoint.label} -> ${point.label}: ${inverse.bearing}, azimuth ${inverse.azimuthDeg.toFixed(4)} deg.`,
    });
    return true;
  }

  publishReport(
    'DISTANCE_REPORT',
    'Distance Between Points',
    `Computed distance from ${startPoint.label} to ${point.label}`,
    [
      { label: 'From', value: startPoint.label },
      { label: 'To', value: point.label },
      { label: 'Distance', value: distance.distance2d.toFixed(3), unit: 'm' },
      { label: 'dE', value: distance.deltaX.toFixed(3), unit: 'm' },
      { label: 'dN', value: distance.deltaY.toFixed(3), unit: 'm' },
    ],
  );
  replaceSession({
    ...current,
    startPoint: null,
    inputValue: '',
    resultText: `DISTANCE ${startPoint.label} -> ${point.label}: ${distance.distance2d.toFixed(3)} m.`,
  });
  return true;
};

export const handlePerpendicularPointPick = ({
  applyHistoryUpdate,
  current,
  point,
  publishReport,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'applyHistoryUpdate' | 'current' | 'point' | 'publishReport' | 'replaceSession'
>): boolean => {
  if (current.key !== 'PERP_INTX') return false;
  const solution = cadIntersectPerpendicular({
    lineStart: current.lineStart,
    lineEnd: current.lineEnd,
    fromPoint: point,
    lineLabel: `${current.lineStart.label}-${current.lineEnd.label}`,
    pointLabel: point.label,
  });
  if (!solution) {
    replaceSession({
      ...current,
      resultText: 'PERP_INTX could not compute a perpendicular foot from that point.',
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'POINT',
      x: solution.point.x,
      y: solution.point.y,
    }),
  );
  publishReport(
    'PERP_INTX',
    'Perpendicular Intersection',
    `Computed perpendicular foot from ${point.label} to ${current.lineStart.label}-${current.lineEnd.label}`,
    [
      { label: 'Point', value: point.label },
      { label: 'Line', value: `${current.lineStart.label}-${current.lineEnd.label}` },
      { label: 'Northing', value: solution.point.y.toFixed(3), unit: 'm' },
      { label: 'Easting', value: solution.point.x.toFixed(3), unit: 'm' },
      {
        label: 'Offset',
        value: buildCadDistanceSummary(point, solution.point).distance2d.toFixed(3),
        unit: 'm',
      },
    ],
  );
  replaceSession(null);
  return true;
};

export const handleInversePointPick = ({
  current,
  onReportComputation,
  point,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'current' | 'onReportComputation' | 'point' | 'replaceSession'
>): boolean => {
  if (current.key !== 'INVERSE') return false;
  if (!current.startPoint) {
    replaceSession({
      ...current,
      startPoint: point,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  const inverse = buildCadInverseSummary(current.startPoint, point);
  onReportComputation?.(
    buildCadCogoComputation({
      createdEntities: [],
      report: {
        title: 'Inverse',
        summary: `Computed inverse from ${current.startPoint.label} to ${point.label}`,
        rows: [
          { label: 'From', value: current.startPoint.label },
          { label: 'To', value: point.label },
          { label: 'Distance', value: inverse.distance.toFixed(3), unit: 'm' },
          { label: 'Azimuth', value: inverse.azimuthDeg.toFixed(4), unit: 'deg' },
          { label: 'Bearing', value: formatCadBearing(inverse.azimuthDeg) },
        ],
      },
      warnings: [],
      provenance: {
        id: `inverse:${current.startPoint.label}:${point.label}:${inverse.distance.toFixed(6)}:${inverse.azimuthDeg.toFixed(6)}`,
        toolKey: 'INVERSE',
        inputs: {
          from: current.startPoint,
          to: point,
        },
        resultSummary: `Inverse ${current.startPoint.label} to ${point.label}`,
        createdAtIso: new Date().toISOString(),
      },
    }),
  );
  replaceSession({
    ...current,
    startPoint: null,
    inputValue: '',
    resultText: `INVERSE ${current.startPoint.label} -> ${point.label}: distance ${inverse.distance.toFixed(3)}, azimuth ${inverse.azimuthDeg.toFixed(4)} deg, bearing ${inverse.bearing}.`,
  });
  return true;
};
