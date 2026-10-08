import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import {
  buildCircleCenterDiameterScalar,
  buildCircleCenterRadiusScalar,
  buildCircleThreePoint,
  buildCircleTwoPoint,
  buildRectangleVertices,
  buildRegularPolygonVertices,
} from '../../engine/cad/cadGeometryShapeBuilders';
import {
  isSameCadTangentPrimitive,
  resolveCadTangentSource,
  solveCadCircleTangentTangentTangent,
  type CadTangentSource,
} from '../../engine/cad/cadGeometryCircleTangentSolvers';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type { CadLineL1SessionState } from './useSurveyCadCommandTypes';
import { isCadLineL1Key } from './useSurveyCadLineL1Keys';
import { handleCadLineL1PointPick } from './useSurveyCadLineL1Session';
import { buildTraverseLegInputFromPoints } from './useSurveyCadCommandSession';
import { normalizeDraftPoint } from './useSurveyCadCommandParsing';
import { handleSurveyCadArcPointPick } from './useSurveyCadArcPointPick';
import { handleCurveF1PointPick } from './useSurveyCadCurveF1Submit';
import type {
  HandleSurveyCadConsumePointOptions,
  ReplaceSession,
} from './useSurveyCadConsumePoint.types';
import { handleAnnotationPointPick } from './useSurveyCadAnnotationSessions';
import { handleBestFitPointPick } from './useSurveyCadBestFitSession';
import { handleSurveyCadEditPointPick } from './useSurveyCadEditPointPick';
import { handleSurveyCadTransformPointPick } from './useSurveyCadTransformPointPick';
import { handleSurveyCadParcelSplitPointPick } from './useSurveyCadParcelSplitPointPick';
import { handlePlinePointPick } from './useSurveyCadPlineSession';
import {
  handleInversePointPick,
  handlePerpendicularPointPick,
  handleReportPointPick,
} from './useSurveyCadReportPointPick';
import {
  handlePlineVertexPointPick,
  isPlineVertexSession,
} from './useSurveyCadPolylineVertexSession';

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

const handlePolylineOrTraversePointPick = ({
  current,
  point,
  projectStationIds,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'current' | 'point' | 'projectStationIds' | 'replaceSession'
>): boolean => {
  // Phase C2: PLINE owns arc legs, the pending through-point, and the
  // width-phase point law; TRAVERSE keeps the legacy append path below.
  if (current.key === 'PLINE') {
    return handlePlinePointPick({ point, projectStationIds, replaceSession, session: current });
  }
  if (current.key !== 'TRAVERSE') return false;
  const draftPoint = normalizeDraftPoint(point, current.inputPoints, projectStationIds);
  replaceSession({
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
  });
  return true;
};

const handleSurveyTablePointPick = ({
  applyHistoryUpdate,
  current,
  point,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'applyHistoryUpdate' | 'current' | 'point' | 'replaceSession'
>): boolean => {
  if (current.key !== 'SURVEYTABLE') return false;
  const { engineKey, sourceEntityIds } = current;
  applyHistoryUpdate((existing) => {
    switch (engineKey) {
      case 'LINETABLE':
        return runCadCommand(existing, {
          key: 'LINETABLE',
          insertX: point.x,
          insertY: point.y,
          sourceEntityIds,
        });
      case 'CURVETABLE':
        return runCadCommand(existing, {
          key: 'CURVETABLE',
          insertX: point.x,
          insertY: point.y,
          sourceEntityIds,
        });
      case 'PARCELTABLE':
        return runCadCommand(existing, {
          key: 'PARCELTABLE',
          insertX: point.x,
          insertY: point.y,
          sourceEntityIds,
        });
      case 'POINTTABLE':
        return runCadCommand(existing, {
          key: 'POINTTABLE',
          insertX: point.x,
          insertY: point.y,
          sourceEntityIds,
        });
      case 'PARCELREPORT':
      case 'PARCELDESC': {
        const parcelEntityId = sourceEntityIds[0];
        if (parcelEntityId == null) return existing;
        return runCadCommand(existing, {
          key: engineKey,
          parcelEntityId,
          insertX: point.x,
          insertY: point.y,
        });
      }
      default:
        return existing;
    }
  });
  replaceSession(null);
  return true;
};

export const handleSurveyCadConsumePoint = (
  options: HandleSurveyCadConsumePointOptions,
): void => {
  const { applyHistoryUpdate, current, point, replaceSession } = options;
  // CAD Draw L1: the 16 Line-creation modes own point picks (draft, source
  // selection, tangent/perp commit); never fall through to the point parser.
  if (
    isCadLineL1Key(current.key) &&
    handleCadLineL1PointPick({
      applyHistoryUpdate,
      current: current as CadLineL1SessionState,
      point,
      project: options.history.present.project,
      replaceSession,
      pickToleranceWorld: options.pickToleranceWorld,
      rawWorldPoint: options.rawWorldPoint,
      pickViewportGeneration: options.pickViewportGeneration,
    })
  ) {
    return;
  }
  // Phase 18O annotation creation picks (fixed anchors; eager dimension/label commits).
  if (
    handleAnnotationPointPick({
      current,
      point,
      project: options.history.present.project,
      applyHistoryUpdate,
      replaceSession,
    })
  ) {
    return;
  }
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
    handleCurveF1PointPick({
      current: options.current,
      point: options.point,
      replaceSession: options.replaceSession,
      project: options.history.present.project,
      applyHistoryUpdate: options.applyHistoryUpdate,
      publishReport: options.publishReport,
    }) ||
    handleIntersectionPointPick(current, point, replaceSession) ||
    handleBestFitPointPick({
      current,
      point,
      project: options.history.present.project,
      replaceSession,
    }) ||
    handlePerpendicularPointPick(options) ||
    handlePolylineOrTraversePointPick(options) ||
    handleSurveyCadTransformPointPick({
      applyHistoryUpdate: options.applyHistoryUpdate,
      current: options.current,
      history: options.history,
      point: options.point,
      replaceSession: options.replaceSession,
    }) ||
    handleSurveyCadArcPointPick(options) ||
    handleShapePointPick({
      applyHistoryUpdate: options.applyHistoryUpdate,
      current: options.current,
      point: options.point,
      replaceSession: options.replaceSession,
    }) ||
    handleCircleConstructionPointPick(options) ||
    handleLinePointPick(options) ||
    handleSurveyCadEditPointPick(options) ||
    handleSurveyCadParcelSplitPointPick({ current, point, replaceSession }) ||
    (isPlineVertexSession(current) &&
      handlePlineVertexPointPick({
        applyHistoryUpdate,
        current,
        history: options.history,
        pickToleranceWorld: options.pickToleranceWorld,
        point,
        replaceSession,
      })) ||
    handleSurveyTablePointPick({ applyHistoryUpdate, current, point, replaceSession }) ||
    handleInversePointPick(options)
  ) {
    return;
  }
};

const handleShapePointPick = ({
  applyHistoryUpdate,
  current,
  point,
  replaceSession,
}: Pick<
  HandleSurveyCadConsumePointOptions,
  'applyHistoryUpdate' | 'current' | 'point' | 'replaceSession'
>): boolean => {
  if (current.key === 'RECTANGLE') {
    if (!current.firstCorner) {
      replaceSession({
        ...current,
        firstCorner: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (!buildRectangleVertices(current.firstCorner, point)) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'RECTANGLE corners degenerate. Pick a distinct opposite corner.',
      });
      return true;
    }
    const firstCorner = current.firstCorner;
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, {
        key: 'RECTANGLE',
        firstCorner,
        oppositeCorner: point,
      }),
    );
    replaceSession(null);
    return true;
  }
  if (current.key === 'POLYGON') {
    if (current.phase === 'center' && !current.center) {
      replaceSession({
        ...current,
        center: point,
        phase: 'radius',
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    if (
      current.phase === 'radius' &&
      current.center != null &&
      current.sides != null &&
      current.mode != null
    ) {
      const { center, sides, mode } = current;
      if (!buildRegularPolygonVertices(center, point, sides, mode)) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'POLYGON radius degenerate. Pick a radius point away from the center.',
        });
        return true;
      }
      applyHistoryUpdate((existing) =>
        runCadCommand(existing, {
          key: 'POLYGON',
          center,
          through: point,
          sides,
          mode,
        }),
      );
      replaceSession(null);
      return true;
    }
    return false;
  }
  if (current.key === 'CIRCLE' || current.key === 'CIRCLECD') {
    if (!current.center) {
      replaceSession({
        ...current,
        center: point,
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    const center = current.center;
    const distance = Math.hypot(point.x - center.x, point.y - center.y);
    const built = current.key === 'CIRCLE'
      ? buildCircleCenterRadiusScalar(center, distance)
      : buildCircleCenterDiameterScalar(center, distance);
    if (!built) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText:
          current.key === 'CIRCLE'
            ? 'CIRCLE radius degenerate. Pick a radius point away from the center.'
            : 'CIRCLECD diameter degenerate. Pick a diameter point away from the center.',
      });
      return true;
    }
    const committedCenter = center;
    const committedDistance = distance;
    applyHistoryUpdate((existing) =>
      current.key === 'CIRCLE'
        ? runCadCommand(existing, { key: 'CIRCLE', center: committedCenter, radius: built.radius })
        : runCadCommand(existing, { key: 'CIRCLECD', center: committedCenter, diameter: committedDistance }),
    );
    replaceSession(null);
    return true;
  }
  return false;
};

const handleCircleConstructionPointPick = (
  options: Pick<
    HandleSurveyCadConsumePointOptions,
    'applyHistoryUpdate' | 'current' | 'point' | 'replaceSession' | 'history'
  >,
): boolean => {
  const { applyHistoryUpdate, current, point, replaceSession } = options;
  if (current.key === 'CIRCLE2P') {
    if (!current.first) {
      replaceSession({ ...current, first: point, inputValue: '', resultText: undefined });
      return true;
    }
    const first = current.first;
    if (!buildCircleTwoPoint(first, point)) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'CIRCLE2P endpoints are coincident. Pick a distinct second endpoint.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, { key: 'CIRCLE2P', first, second: point }),
    );
    replaceSession(null);
    return true;
  }
  if (current.key === 'CIRCLE3P') {
    if (current.points.length < 2) {
      replaceSession({
        ...current,
        points: [...current.points, point],
        inputValue: '',
        resultText: undefined,
      });
      return true;
    }
    const [first, second] = current.points;
    if (!first || !second || !buildCircleThreePoint(first, second, point)) {
      replaceSession({
        ...current,
        inputValue: '',
        resultText: 'CIRCLE3P third point is collinear or coincident. Pick a distinct third point.',
      });
      return true;
    }
    applyHistoryUpdate((existing) =>
      runCadCommand(existing, { key: 'CIRCLE3P', first, second, third: point }),
    );
    replaceSession(null);
    return true;
  }
  if (current.key !== 'CIRCLETTR' && current.key !== 'CIRCLETTT') return false;
  const entityId = point.snapSourceEntityId;
  const source = entityId
    ? resolveCadTangentSource(
        options.history.present.project,
        entityId,
        { x: point.x, y: point.y },
        point.snapSourceSegmentId,
      )
    : null;
  if (!source) {
    replaceSession({
      ...current,
      inputValue: '',
      resultText: `${current.key} needs a direct line, polyline, arc, or circle body click. Background points do not define a tangent.`,
    });
    return true;
  }
  if (current.key === 'CIRCLETTR') {
    if (!current.first) {
      replaceSession({
        ...current,
        first: source,
        inputValue: '',
        resultText: 'CIRCLETTR first tangent captured. Pick the second tangent object.',
      });
      return true;
    }
    if (!current.second) {
      if (isSameCadTangentPrimitive(current.first.primitive, source.primitive)) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'CIRCLETTR ignored the same object twice. Pick a different second tangent.',
        });
        return true;
      }
      replaceSession({
        ...current,
        second: source,
        awaitingSecondRepick: false,
        inputValue: '',
        resultText: 'CIRCLETTR tangents captured. Enter the radius and press Enter.',
      });
      return true;
    }
    if (current.awaitingSecondRepick) {
      // Repick law: the next distinct tangent object replaces the second source.
      const repeated =
        isSameCadTangentPrimitive(current.first.primitive, source.primitive) ||
        isSameCadTangentPrimitive(current.second.primitive, source.primitive);
      if (repeated) {
        replaceSession({
          ...current,
          inputValue: '',
          resultText: 'CIRCLETTR ignored a repeated tangent. Pick a different second tangent.',
        });
        return true;
      }
      replaceSession({
        ...current,
        second: source,
        awaitingSecondRepick: false,
        inputValue: '',
        resultText: 'CIRCLETTR second tangent replaced. Enter the radius and press Enter.',
      });
      return true;
    }
    replaceSession({
      ...current,
      inputValue: '',
      resultText: 'CIRCLETTR has both tangents. Enter the radius and press Enter.',
    });
    return true;
  }
  const picks = current.picks;
  if (picks.some((existing) => isSameCadTangentPrimitive(existing.primitive, source.primitive))) {
    replaceSession({
      ...current,
      inputValue: '',
      resultText: 'CIRCLETTT ignored a repeated tangent. Pick a different object.',
    });
    return true;
  }
  if (picks.length < 2) {
    replaceSession({
      ...current,
      picks: [...picks, source],
      inputValue: '',
      resultText: undefined,
    });
    return true;
  }
  const [first, second] = picks;
  if (!first || !second) return true;
  const solved = solveCadCircleTangentTangentTangent(first, second, source);
  if (solved.status !== 'SOLVED' || !solved.center || solved.radius == null) {
    replaceSession({
      ...current,
      inputValue: '',
      resultText:
        solved.status === 'AMBIGUOUS'
          ? 'CIRCLETTT is ambiguous for those picks. Pick a different third tangent object.'
          : 'CIRCLETTT found no tangent circle through those objects. Pick a different third tangent.',
    });
    return true;
  }
  applyHistoryUpdate((existing) =>
    runCadCommand(existing, { key: 'CIRCLETTT', first, second, third: source }),
  );
  replaceSession(null);
  return true;
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
