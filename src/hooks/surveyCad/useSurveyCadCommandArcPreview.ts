import {
  cadArcEndPoint,
  cadBuildArcFromStartCenterAngle,
  cadBuildArcFromStartCenterChord,
  cadBuildArcFromStartCenterEnd,
  cadBuildArcFromStartEndAngle,
  cadBuildArcFromStartEndDirection,
  cadBuildArcFromStartEndRadius,
  cadBuildArcFromThreePoints,
  cadBuildContinuedArc,
  cadBuildTangentCurve,
  cadParseBearingDegrees,
  type CadNamedPoint,
} from '../../engine/cad/cadGeometry';
import type { CommandPoint, CommandSession } from './useSurveyCadCommandTypes';
import type { CadCommandPreviewState } from './useSurveyCadCommandPreview';

type ArcPointCommandKey =
  | 'ARC_3PT'
  | 'ARC_SCE'
  | 'ARC_CSE'
  | 'ARC_SCA'
  | 'ARC_CSA'
  | 'ARC_SCL'
  | 'ARC_CSL'
  | 'ARC_SEA'
  | 'ARC_SED'
  | 'ARC_SER';

type ArcPointsSession = {
  key: ArcPointCommandKey;
  inputValue: string;
  points: CommandPoint[];
  resultText?: string;
};

type ArcPreviewSession =
  | ArcPointsSession
  | Extract<CommandSession, { key: 'CONTINUE_CURVE' }>
  | Extract<CommandSession, { key: 'TANGENT_CURVE' }>;

const buildCenterFirstArcDefinition = (
  commandKey: 'ARC_CSE' | 'ARC_CSA' | 'ARC_CSL',
  points: CadNamedPoint[],
  value: number | null,
  reverseDirectionModifier: boolean,
) => {
  if (points.length < 2) return null;
  if (commandKey === 'ARC_CSE') {
    if (points.length < 3) return null;
    return cadBuildArcFromStartCenterEnd(
      points[1]!,
      points[0]!,
      points[2]!,
      reverseDirectionModifier,
    );
  }
  if (value == null) return null;
  return commandKey === 'ARC_CSA'
    ? cadBuildArcFromStartCenterAngle(points[1]!, points[0]!, value, reverseDirectionModifier)
    : cadBuildArcFromStartCenterChord(points[1]!, points[0]!, value, reverseDirectionModifier);
};

const buildArcShapePreview = (
  center: { x: number; y: number },
  radius: number,
  startAngleDeg: number,
  endAngleDeg: number,
): CadCommandPreviewState => ({
  kind: 'arc',
  center,
  radius,
  startAngleDeg,
  endAngleDeg,
});

const buildThreePointArcPreview = (
  session: ArcPointsSession,
  previewPoint: { x: number; y: number; label: string } | null,
): CadCommandPreviewState | null => {
  if (!previewPoint) return null;
  if (session.points.length === 0) {
    return {
      kind: 'point',
      point: { x: previewPoint.x, y: previewPoint.y },
    };
  }
  if (session.points.length === 1) {
    return {
      kind: 'line',
      points: [
        { x: session.points[0].x, y: session.points[0].y },
        { x: previewPoint.x, y: previewPoint.y },
      ],
    };
  }
  const previewArc = cadBuildArcFromThreePoints(session.points[0], session.points[1], previewPoint);
  return previewArc
    ? buildArcShapePreview(
        previewArc.center,
        previewArc.radius,
        previewArc.startAngleDeg,
        previewArc.endAngleDeg,
      )
    : {
        kind: 'polyline',
        points: [
          { x: session.points[0].x, y: session.points[0].y },
          { x: session.points[1].x, y: session.points[1].y },
          { x: previewPoint.x, y: previewPoint.y },
        ],
      };
};

const buildStartCenterEndArcPreview = (
  session: ArcPointsSession,
  previewPoint: { x: number; y: number; label: string } | null,
  reverseDirectionModifier: boolean,
): CadCommandPreviewState | null => {
  if (!previewPoint) return null;
  if (session.points.length === 0) {
    return { kind: 'point', point: { x: previewPoint.x, y: previewPoint.y } };
  }
  if (session.points.length === 1) {
    return {
      kind: 'line',
      points: [
        { x: session.points[0].x, y: session.points[0].y },
        { x: previewPoint.x, y: previewPoint.y },
      ],
    };
  }
  const previewArc =
    session.key === 'ARC_SCE'
      ? cadBuildArcFromStartCenterEnd(
          session.points[0],
          session.points[1],
          previewPoint,
          reverseDirectionModifier,
        )
      : buildCenterFirstArcDefinition(
          'ARC_CSE',
          [...session.points, previewPoint as CadNamedPoint],
          null,
          reverseDirectionModifier,
        );
  return previewArc
    ? buildArcShapePreview(
        previewArc.center,
        previewArc.radius,
        previewArc.startAngleDeg,
        previewArc.endAngleDeg,
      )
    : {
        kind: 'polyline',
        points: [
          { x: session.points[0].x, y: session.points[0].y },
          { x: session.points[1].x, y: session.points[1].y },
          { x: previewPoint.x, y: previewPoint.y },
        ],
      };
};

const buildTwoPointValueArcPreview = (
  session: ArcPointsSession,
  previewPoint: { x: number; y: number; label: string } | null,
  reverseDirectionModifier: boolean,
): CadCommandPreviewState | null => {
  if (session.points.length === 0) {
    if (!previewPoint) return null;
    return { kind: 'point', point: { x: previewPoint.x, y: previewPoint.y } };
  }
  if (session.points.length === 1) {
    if (!previewPoint) return null;
    return {
      kind: 'line',
      points: [
        { x: session.points[0].x, y: session.points[0].y },
        { x: previewPoint.x, y: previewPoint.y },
      ],
    };
  }
  const rawInput = session.inputValue.trim();
  if (rawInput.length === 0) {
    return {
      kind: 'line',
      points: [
        { x: session.points[0].x, y: session.points[0].y },
        { x: session.points[1].x, y: session.points[1].y },
      ],
    };
  }
  const numericValue = Number(rawInput);
  const directionValue =
    cadParseBearingDegrees(rawInput) ?? (Number.isFinite(numericValue) ? numericValue : null);
  const previewArc =
    session.key === 'ARC_SCA'
      ? cadBuildArcFromStartCenterAngle(
          session.points[0],
          session.points[1],
          numericValue,
          reverseDirectionModifier,
        )
      : session.key === 'ARC_CSA'
        ? buildCenterFirstArcDefinition(
            'ARC_CSA',
            session.points,
            numericValue,
            reverseDirectionModifier,
          )
      : session.key === 'ARC_SCL'
        ? cadBuildArcFromStartCenterChord(
            session.points[0],
            session.points[1],
            numericValue,
            reverseDirectionModifier,
          )
        : session.key === 'ARC_CSL'
          ? buildCenterFirstArcDefinition(
              'ARC_CSL',
              session.points,
              numericValue,
              reverseDirectionModifier,
            )
        : session.key === 'ARC_SEA'
          ? cadBuildArcFromStartEndAngle(
              session.points[0],
              session.points[1],
              numericValue,
              reverseDirectionModifier,
            )
          : session.key === 'ARC_SER'
            ? cadBuildArcFromStartEndRadius(
                session.points[0],
                session.points[1],
                numericValue,
                reverseDirectionModifier,
              )
            : directionValue == null
              ? null
              : cadBuildArcFromStartEndDirection(
                  session.points[0],
                  session.points[1],
                  directionValue,
                  reverseDirectionModifier,
                );
  return previewArc
    ? buildArcShapePreview(
        previewArc.center,
        previewArc.radius,
        previewArc.startAngleDeg,
        previewArc.endAngleDeg,
      )
    : {
        kind: 'line',
        points: [
          { x: session.points[0].x, y: session.points[0].y },
          { x: session.points[1].x, y: session.points[1].y },
        ],
      };
};

const buildContinueCurvePreview = (
  session: Extract<ArcPreviewSession, { key: 'CONTINUE_CURVE' }>,
  previewPoint: { x: number; y: number; label: string } | null,
  reverseDirectionModifier: boolean,
): CadCommandPreviewState | null => {
  if (!previewPoint) return null;
  const previewArc = cadBuildContinuedArc(
    session.sourceArc,
    previewPoint,
    reverseDirectionModifier,
  );
  return previewArc
    ? buildArcShapePreview(
        previewArc.center,
        previewArc.radius,
        previewArc.startAngleDeg,
        previewArc.endAngleDeg,
      )
    : {
        kind: 'line',
        points: [cadArcEndPoint(session.sourceArc), { x: previewPoint.x, y: previewPoint.y }],
      };
};

const buildTangentCurvePreview = (
  session: Extract<ArcPreviewSession, { key: 'TANGENT_CURVE' }>,
  previewPoint: { x: number; y: number; label: string } | null,
): CadCommandPreviewState | null => {
  if (session.piPoint == null && !previewPoint) return null;
  if (session.piPoint == null) {
    if (!previewPoint) return null;
    return {
      kind: 'point',
      point: { x: previewPoint.x, y: previewPoint.y },
    };
  }
  if (session.backTangentPoint == null) {
    if (!previewPoint) return null;
    return {
      kind: 'line',
      points: [
        { x: session.piPoint.x, y: session.piPoint.y },
        { x: previewPoint.x, y: previewPoint.y },
      ],
    };
  }
  if (session.aheadTangentPoint == null) {
    if (!previewPoint) return null;
    return {
      kind: 'polyline',
      points: [
        { x: session.backTangentPoint.x, y: session.backTangentPoint.y },
        { x: session.piPoint.x, y: session.piPoint.y },
        { x: previewPoint.x, y: previewPoint.y },
      ],
    };
  }
  if (session.inputValue.trim().length > 0) {
    const radius = Number(session.inputValue.trim());
    if (Number.isFinite(radius) && radius > 0) {
      const previewArc = cadBuildTangentCurve(
        session.piPoint,
        session.backTangentPoint,
        session.aheadTangentPoint,
        radius,
      );
      if (previewArc) {
        return buildArcShapePreview(
          previewArc.center,
          previewArc.radius,
          previewArc.startAngleDeg,
          previewArc.endAngleDeg,
        );
      }
    }
  }
  return {
    kind: 'polyline',
    points: [
      { x: session.backTangentPoint.x, y: session.backTangentPoint.y },
      { x: session.piPoint.x, y: session.piPoint.y },
      { x: session.aheadTangentPoint.x, y: session.aheadTangentPoint.y },
    ],
  };
};

export const buildArcCommandPreview = (
  session: ArcPreviewSession,
  previewPoint: { x: number; y: number; label: string } | null,
  reverseDirectionModifier: boolean,
): CadCommandPreviewState | null => {
  switch (session.key) {
    case 'ARC_3PT':
      return buildThreePointArcPreview(session, previewPoint);
    case 'ARC_SCE':
    case 'ARC_CSE':
      return buildStartCenterEndArcPreview(session, previewPoint, reverseDirectionModifier);
    case 'ARC_SCA':
    case 'ARC_CSA':
    case 'ARC_SCL':
    case 'ARC_CSL':
    case 'ARC_SEA':
    case 'ARC_SED':
    case 'ARC_SER':
      return buildTwoPointValueArcPreview(session, previewPoint, reverseDirectionModifier);
    case 'CONTINUE_CURVE':
      return buildContinueCurvePreview(session, previewPoint, reverseDirectionModifier);
    case 'TANGENT_CURVE':
      return buildTangentCurvePreview(session, previewPoint);
  }
};
