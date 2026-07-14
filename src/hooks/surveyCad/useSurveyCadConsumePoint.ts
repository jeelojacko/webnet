import {
  buildCadDistanceSummary,
  buildCadInverseSummary,
  cadIntersectPerpendicular,
  formatCadBearing,
} from '../../engine/cad/cadCogo';
import { buildCadCogoComputation } from '../../engine/cad/cadCogoTypes';
import { runCadCommand, type CadHistoryState } from '../../engine/cad/cadUndoRedo';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import { buildTraverseLegInputFromPoints } from './useSurveyCadCommandSession';
import { normalizeDraftPoint } from './useSurveyCadCommandParsing';
import type { SurveyCadReportPublisher } from './useSurveyCadCommandReports';
import { handleSurveyCadArcPointPick } from './useSurveyCadArcPointPick';
import { handleSurveyCadEditPointPick } from './useSurveyCadEditPointPick';
import { handleSurveyCadParcelSplitPointPick } from './useSurveyCadParcelSplitPointPick';

type ReplaceSession = (_nextSession: CommandSession | null) => void;
type ApplyHistoryUpdate = (_updater: (_history: CadHistoryState) => CadHistoryState) => void;
type CommitArcDefinition = (
  _modeLabel: string,
  _arcDefinition: {
    center: { x: number; y: number };
    radius: number;
    startAngleDeg: number;
    endAngleDeg: number;
  } | null,
  _metadata?: Record<string, unknown>,
) => boolean;

interface HandleSurveyCadConsumePointOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  commitArcDefinition: CommitArcDefinition;
  current: CommandSession;
  history: CadHistoryState;
  onReportComputation?: (
    _computation: ReturnType<typeof buildCadCogoComputation> | null,
  ) => void;
  point: CommandPoint;
  projectStationIds: string[];
  publishReport: SurveyCadReportPublisher;
  replaceSession: ReplaceSession;
  reverseDirectionModifier: boolean;
  suppressPointLabel?: boolean;
}

const handleReportPointPick = ({
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

const handleStagedPointPick = (
  current: CommandSession,
  point: CommandPoint,
  replaceSession: ReplaceSession,
): boolean => {
  if (current.key === 'TURNED_POINT') {
    if (!current.occupyPoint) {
      replaceSession({
        ...current,
        occupyPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.backsightPoint) {
      replaceSession({
        ...current,
        backsightPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  if (current.key === 'PI_CURVE') {
    if (!current.piPoint) {
      replaceSession({
        ...current,
        piPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.backTangentPoint) {
      replaceSession({
        ...current,
        backTangentPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  if (current.key === 'CHORD_BEARING_CURVE') {
    if (!current.startPoint) {
      replaceSession({
        ...current,
        startPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  return false;
};

const handleIntersectionPointPick = (
  current: CommandSession,
  point: CommandPoint,
  replaceSession: ReplaceSession,
): boolean => {
  if (
    current.key === 'BEARING_BEARING_INTX' ||
    current.key === 'BEARING_DISTANCE_INTX' ||
    current.key === 'DISTANCE_DISTANCE_INTX'
  ) {
    if (!current.firstPoint) {
      replaceSession({
        ...current,
        firstPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!current.secondPoint) {
      replaceSession({
        ...current,
        secondPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  if (current.key === 'LINE_CIRCLE_INTX' || current.key === 'SKEW_INTX') {
    if (!current.targetPoint) {
      replaceSession({
        ...current,
        targetPoint: point,
        inputValue: '',
        resultText: undefined,
      });
    }
    return true;
  }

  return false;
};

const handlePerpendicularPointPick = ({
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

const handlePolylineOrTraversePointPick = ({
  current,
  point,
  projectStationIds,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'current' | 'point' | 'projectStationIds' | 'replaceSession'
>): boolean => {
  if (current.key !== 'PLINE' && current.key !== 'TRAVERSE') return false;
  const draftPoint =
    current.key === 'TRAVERSE'
      ? normalizeDraftPoint(point, current.inputPoints, projectStationIds)
      : normalizeDraftPoint(point, current.points, projectStationIds);
  replaceSession(
    current.key === 'TRAVERSE'
      ? {
          ...current,
          points: [...current.inputPoints, draftPoint],
          inputPoints: [...current.inputPoints, draftPoint],
          legInputs:
            current.inputPoints.length === 0
              ? current.legInputs
              : [
                  ...current.legInputs,
                  buildTraverseLegInputFromPoints(
                    current.inputPoints[current.inputPoints.length - 1]!,
                    draftPoint,
                  ),
                ],
          adjustment: null,
          inputValue: '',
          resultText: undefined,
        }
      : {
          ...current,
          points: [...current.points, draftPoint],
          inputValue: '',
          resultText: undefined,
        },
  );
  return true;
};

const handleInversePointPick = ({
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

export const handleSurveyCadConsumePoint = (
  options: HandleSurveyCadConsumePointOptions,
): void => {
  const { applyHistoryUpdate, current, point, replaceSession } = options;
  if (current.key === 'POINT') {
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'POINT',
        x: point.x,
        y: point.y,
        label: options.suppressPointLabel ? undefined : point.label,
      }),
    );
    replaceSession(null);
    return;
  }

  if (current.key === 'COGO_POINT') {
    if (!current.startPoint) {
      replaceSession({
        ...current,
        startPoint: point,
        inputValue: '',
        resultText: undefined,
      });
      return;
    }
    const directionLabel = current.inputValue.trim() || point.label;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'COGO_POINT',
        x: point.x,
        y: point.y,
        basisLabel: current.startPoint!.label,
        directionLabel,
      }),
    );
    replaceSession(null);
    return;
  }

  if (current.key === 'MULTI_INVERSE' || current.key === 'AREA') {
    replaceSession({
      ...current,
      points: [...current.points, point],
      inputValue: '',
      resultText: undefined,
    });
    return;
  }

  if (
    handleReportPointPick(options) ||
    handleStagedPointPick(current, point, replaceSession) ||
    handleIntersectionPointPick(current, point, replaceSession) ||
    handlePerpendicularPointPick(options) ||
    handlePolylineOrTraversePointPick(options) ||
    handleSurveyCadArcPointPick(options) ||
    handleLinePointPick(options) ||
    handleSurveyCadEditPointPick(options) ||
    handleSurveyCadParcelSplitPointPick({ current, point, replaceSession }) ||
    handleInversePointPick(options)
  ) {
    return;
  }
};

const handleLinePointPick = ({
  applyHistoryUpdate,
  current,
  point,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'applyHistoryUpdate' | 'current' | 'point' | 'replaceSession'
>): boolean => {
  if (current.key !== 'LINE') return false;
  if (!current.startPoint) {
    replaceSession({
      ...current,
      startPoint: point,
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, {
      key: 'LINE',
      start: current.startPoint!,
      end: point,
    }),
  );
  replaceSession(null);
  return true;
};
