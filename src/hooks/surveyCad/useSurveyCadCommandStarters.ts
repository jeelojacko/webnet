import { buildBestFitPreseedSamples } from './useSurveyCadBestFitSession';
import type {
  CadArcEntity,
  CadLineEntity,
  CadProject,
} from '../../engine/cad/cadTypes';
import type { CommandSession } from './useSurveyCadCommandTypes';
import { createCadLineL1Session } from './useSurveyCadLineL1Session';
import type { CadLineL1CommandKey } from './useSurveyCadLineL1Keys';
import type {
  SelectedLineCommandPoints,
} from './useSurveyCadCommandSelection';
import {
  continuationSourceOf,
  exactlyOneSelectedLinePair,
  exactlyOneSelectedOf,
  findF1Arc,
  findF1Line,
} from './useSurveyCadCurveF1Session';
import type {
  BuildSurveyCadCommandStartersOptions,
  SurveyCadCommandStarters,
} from './useSurveyCadCommandStarters.types';

const bestFitPreseed = <K extends 'BESTFITLINE' | 'BESTFITARC' | 'BESTFITPARABOLA'>(
  key: K,
  project: BuildSurveyCadCommandStartersOptions['bestFitProject'],
  selectedEntityIds: readonly string[],
): Extract<CommandSession, { key: K }> => {
  const preseed =
    project != null
      ? buildBestFitPreseedSamples(project, selectedEntityIds)
      : { samples: [], skippedNonPointSelection: false };
  return {
    key,
    inputValue: '',
    samples: preseed.samples,
    ...(preseed.skippedNonPointSelection
      ? {
          resultText: `${key} started without preseed: the selection must be all survey points. Click or type sample points.`,
        }
      : {}),
  } as Extract<CommandSession, { key: K }>;
};

const lineCommandSession = (
  key: 'DEFLECT_POINT' | 'POINT_ALONG_LINE' | 'EXTEND_LINE' | 'OFFSET_POINT',
  selectedLineCommandPoints: SelectedLineCommandPoints,
): CommandSession => ({
  key,
  inputValue: '',
  lineStart: selectedLineCommandPoints.start,
  lineEnd: selectedLineCommandPoints.end,
});

const selectedArcCommandSession = (
  key: 'RADIAL_BEARING' | 'POINT_ON_CURVE' | 'SUBDIVIDE_CURVE' | 'OFFSET_CURVE' | 'REVERSE_CURVE' | 'COMPOUND_CURVE',
  arc: CadArcEntity | null,
): CommandSession => ({
  key,
  inputValue: '',
  arc,
});

const LINE_SET = new Set(['line']);
const LINE_OR_ARC_SET = new Set(['line', 'arc']);
const ARC_SET = new Set(['arc']);

const lineMidpoint = (line: CadLineEntity): { x: number; y: number; label: string } => ({
  x: (line.fromX + line.toX) / 2,
  y: (line.fromY + line.toY) / 2,
  label: `${line.fromStationId}-${line.toStationId}`,
});

const arcMidpoint = (arc: CadArcEntity): { x: number; y: number; label: string } => {
  const midDeg = arc.startAngleDeg + (arc.endAngleDeg - arc.startAngleDeg) / 2;
  const radians = (midDeg * Math.PI) / 180;
  return {
    x: arc.centerX + Math.cos(radians) * arc.radius,
    y: arc.centerY + Math.sin(radians) * arc.radius,
    label: `${arc.id}-mid`,
  };
};

const arcNearerEnd = (arc: CadArcEntity, pick: { x: number; y: number }): 'start' | 'end' => {
  const startRadians = (arc.startAngleDeg * Math.PI) / 180;
  const start = { x: arc.centerX + Math.cos(startRadians) * arc.radius, y: arc.centerY + Math.sin(startRadians) * arc.radius };
  const sweep = arc.endAngleDeg - arc.startAngleDeg;
  const endRadians = ((arc.startAngleDeg + sweep) * Math.PI) / 180;
  const end = { x: arc.centerX + Math.cos(endRadians) * arc.radius, y: arc.centerY + Math.sin(endRadians) * arc.radius };
  return Math.hypot(pick.x - end.x, pick.y - end.y) <= Math.hypot(pick.x - start.x, pick.y - start.y) ? 'end' : 'start';
};

/** Line-pair preseed: two selected lines → both slots; one line → first slot. */
const linePairPreseed = (
  project: CadProject | null,
  selectedEntityIds: readonly string[],
): {
  firstEntityId: string | null;
  firstPickPoint: { x: number; y: number; label: string } | null;
  secondEntityId: string | null;
  secondPickPoint: { x: number; y: number; label: string } | null;
  invalidMessage: string | null;
} => {
  const empty = {
    firstEntityId: null,
    firstPickPoint: null,
    secondEntityId: null,
    secondPickPoint: null,
    invalidMessage: null as string | null,
  };
  if (!project || selectedEntityIds.length === 0) return empty;
  const pair = exactlyOneSelectedLinePair(project, selectedEntityIds);
  if (pair) {
    return {
      firstEntityId: pair[0].id,
      firstPickPoint: lineMidpoint(pair[0]),
      secondEntityId: pair[1].id,
      secondPickPoint: lineMidpoint(pair[1]),
      invalidMessage: null,
    };
  }
  const singleId = exactlyOneSelectedOf(project, selectedEntityIds, LINE_SET);
  if (singleId) {
    const line = findF1Line(project, singleId);
    return {
      firstEntityId: singleId,
      firstPickPoint: line ? lineMidpoint(line) : null,
      secondEntityId: null,
      secondPickPoint: null,
      invalidMessage: null,
    };
  }
  return {
    ...empty,
    invalidMessage: 'The current selection holds no usable line. Click two line bodies to begin; the session stays active.',
  };
};

export const useSurveyCadCommandStarters = ({
  beginSession,
  buildBatchCogoDraftForInput,
  selectedArcForContinue,
  selectedArcForCurveCogo,
  selectedLineCommandPoints,
  selectedLinePairCommandPoints,
  selectedAlignmentForStationing,
  selectedParcelForBearingSplit,
  selectedParcelForAreaSplit,
  selectedParcelEntityIds = [],
  selectionCount,
  selectedEntityIds = [],
  surveyPointEntityIdsInStationOrder = [],
  selectedEditablePolylineId = null,
  bestFitProject = null,
}: BuildSurveyCadCommandStartersOptions): SurveyCadCommandStarters => {
  // CAD Curves F1 preseed source: the live project (same reference the Best
  // Fit preseed uses). Null = pick-only sessions.
  const f1Project = bestFitProject;
  return {
  startLineL1Command: (key: CadLineL1CommandKey) => {
    const referenceStart =
      key === 'LINE_ANGLE' || key === 'LINE_DEFLECTION' ? selectedLineCommandPoints?.start ?? null : null;
    const referenceEnd =
      key === 'LINE_ANGLE' || key === 'LINE_DEFLECTION' ? selectedLineCommandPoints?.end ?? null : null;
    const alignmentId = key === 'LINE_STATION_OFFSET' ? selectedAlignmentForStationing?.id ?? null : null;
    beginSession(
      createCadLineL1Session(key, { referenceStart, referenceEnd, alignmentId }),
    );
  },
  startPointCommand: () => beginSession({ key: 'POINT', inputValue: '' }),
  startCogoPointCommand: () =>
    beginSession({
      key: 'COGO_POINT',
      inputValue: '',
      startPoint: null,
    }),
  startLineCommand: () =>
    beginSession({
      key: 'LINE',
      inputValue: '',
      startPoint: null,
    }),
  startRectangleCommand: () =>
    beginSession({
      key: 'RECTANGLE',
      inputValue: '',
      firstCorner: null,
    }),
  startCircleCommand: () =>
    beginSession({
      key: 'CIRCLE',
      inputValue: '',
      center: null,
    }),
  startCircleDiameterCommand: () =>
    beginSession({
      key: 'CIRCLECD',
      inputValue: '',
      center: null,
    }),
  startCircleTwoPointCommand: () =>
    beginSession({
      key: 'CIRCLE2P',
      inputValue: '',
      first: null,
    }),
  startCircleThreePointCommand: () =>
    beginSession({
      key: 'CIRCLE3P',
      inputValue: '',
      points: [],
    }),
  startCircleTangentTangentRadiusCommand: () =>
    beginSession({
      key: 'CIRCLETTR',
      inputValue: '',
      first: null,
      second: null,
    }),
  startCircleTangentTangentTangentCommand: () =>
    beginSession({
      key: 'CIRCLETTT',
      inputValue: '',
      picks: [],
    }),
  startPolygonCommand: () =>
    beginSession({
      key: 'POLYGON',
      inputValue: '',
      phase: 'sides',
      sides: null,
      mode: null,
      center: null,
    }),
  startPolylineCommand: () =>
    beginSession({
      key: 'PLINE',
      inputValue: '',
      points: [],
      plineDrawMode: 'line',
      plineArcThrough: null,
      plineWidthPhase: false,
      plineDefaultWidth: { startWidth: 0, endWidth: 0 },
    }),
  startPlineInsertVertexCommand: () =>
    beginSession({
      key: 'PLINEINSERTVERTEX',
      inputValue: '',
      polylineId: selectedEditablePolylineId,
    }),
  startPlineDeleteVertexCommand: () =>
    beginSession({
      key: 'PLINEDELETEVERTEX',
      inputValue: '',
      polylineId: selectedEditablePolylineId,
    }),
  startTraverseCommand: () =>
    beginSession({
      key: 'TRAVERSE',
      inputValue: '',
      points: [],
      inputPoints: [],
      legInputs: [],
      mode: 'open',
      closePoint: null,
      sideshots: [],
      adjustment: null,
    }),
  startBatchCogoCommand: () =>
    beginSession({
      key: 'BATCH_COGO',
      inputValue: '',
      draft: buildBatchCogoDraftForInput(''),
    }),
  startParcelSplitBearingCommand: () => {
    if (!selectedParcelForBearingSplit) return;
    beginSession({
      key: 'PARCEL_SPLIT_BEARING',
      inputValue: '',
      parcel: selectedParcelForBearingSplit,
      splitPoint: null,
    });
  },
  startParcelSplitAreaCommand: () => {
    if (!selectedParcelForAreaSplit) return;
    beginSession({
      key: 'PARCEL_SPLIT_AREA',
      inputValue: '',
      parcel: selectedParcelForAreaSplit,
      splitPoint: null,
    });
  },
  startParcelDesignateCommand: () => {
    if (selectedParcelEntityIds.length === 0) return;
    beginSession({ key: 'PARCELDESIGNATE', inputValue: '', parcelEntityIds: selectedParcelEntityIds });
  },
  startParcelNumberCommand: () => {
    if (selectedParcelEntityIds.length === 0) return;
    beginSession({ key: 'PARCELNUMBER', inputValue: '', parcelEntityIds: selectedParcelEntityIds });
  },
  startParcelLinkCommand: () => {
    if (selectedParcelEntityIds.length < 2) return;
    beginSession({ key: 'PARCELLINK', inputValue: '', parcelEntityIds: selectedParcelEntityIds });
  },
  startParcelUnlinkCommand: () => {
    if (selectedParcelEntityIds.length === 0) return;
    beginSession({ key: 'PARCELUNLINK', inputValue: '', parcelEntityIds: selectedParcelEntityIds });
  },
  startParcelCheckCommand: () => {
    beginSession({ key: 'PARCELCHECK', inputValue: '', parcelEntityIds: selectedParcelEntityIds });
  },
  startParcelScheduleCommand: () => {
    beginSession({ key: 'PARCELSCHEDULE', inputValue: '', parcelEntityIds: selectedParcelEntityIds });
  },
  startParcelSharedEditCommand: (linkId?: string) => {
    beginSession({ key: 'PARCELSHAREDEDIT', inputValue: '', linkId: linkId ?? null });
  },
  startArc3PointCommand: () => beginSession({ key: 'ARC_3PT', inputValue: '', points: [] }),
  startArcStartCenterEndCommand: () => beginSession({ key: 'ARC_SCE', inputValue: '', points: [] }),
  startArcCenterStartEndCommand: () => beginSession({ key: 'ARC_CSE', inputValue: '', points: [] }),
  startArcStartCenterAngleCommand: () => beginSession({ key: 'ARC_SCA', inputValue: '', points: [] }),
  startArcCenterStartAngleCommand: () => beginSession({ key: 'ARC_CSA', inputValue: '', points: [] }),
  startArcStartCenterChordCommand: () => beginSession({ key: 'ARC_SCL', inputValue: '', points: [] }),
  startArcCenterStartChordCommand: () => beginSession({ key: 'ARC_CSL', inputValue: '', points: [] }),
  startArcStartEndAngleCommand: () => beginSession({ key: 'ARC_SEA', inputValue: '', points: [] }),
  startArcStartEndDirectionCommand: () => beginSession({ key: 'ARC_SED', inputValue: '', points: [] }),
  startArcStartEndRadiusCommand: () => beginSession({ key: 'ARC_SER', inputValue: '', points: [] }),
  startContinueCurveCommand: () => {
    if (!selectedArcForContinue) return;
    beginSession({
      key: 'CONTINUE_CURVE',
      inputValue: '',
      sourceArc: selectedArcForContinue,
    });
  },
  startTangentCurveCommand: () =>
    beginSession({
      key: 'TANGENT_CURVE',
      inputValue: '',
      piPoint: null,
      backTangentPoint: null,
      aheadTangentPoint: null,
    }),
  startInverseCommand: () => beginSession({ key: 'INVERSE', inputValue: '', startPoint: null }),
  startMultiInverseCommand: () => beginSession({ key: 'MULTI_INVERSE', inputValue: '', points: [] }),
  startAreaCommand: () => beginSession({ key: 'AREA', inputValue: '', points: [] }),
  startBearingReportCommand: () => beginSession({ key: 'BEARING_REPORT', inputValue: '', startPoint: null }),
  startDistanceReportCommand: () => beginSession({ key: 'DISTANCE_REPORT', inputValue: '', startPoint: null }),
  startTurnedPointCommand: () =>
    beginSession({
      key: 'TURNED_POINT',
      inputValue: '',
      occupyPoint: null,
      backsightPoint: null,
    }),
  startDeflectionPointCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('DEFLECT_POINT', selectedLineCommandPoints));
  },
  startPointAlongLineCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('POINT_ALONG_LINE', selectedLineCommandPoints));
  },
  startExtendLineCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('EXTEND_LINE', selectedLineCommandPoints));
  },
  startOffsetPointCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession(lineCommandSession('OFFSET_POINT', selectedLineCommandPoints));
  },
  startAlignmentOffsetCreateCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_OFFSET_CREATE',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startAlignmentStationEquationCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_STATION_EQUATION',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startAlignmentOffsetPointCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_OFFSET_POINT',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startAlignmentIntervalPointsCommand: () => {
    if (!selectedAlignmentForStationing) return;
    beginSession({
      key: 'ALIGNMENT_INTERVAL_POINTS',
      inputValue: '',
      alignment: selectedAlignmentForStationing,
    });
  },
  startCurveSolverCommand: () => beginSession({ key: 'CURVE_SOLVER', inputValue: '' }),
  startRadialBearingCommand: () => {
    // Dead-click fix: an arc-less start prompts for an arc pick (never a silent no-op).
    beginSession(selectedArcCommandSession('RADIAL_BEARING', selectedArcForCurveCogo));
  },
  startPointOnCurveCommand: () => {
    beginSession(selectedArcCommandSession('POINT_ON_CURVE', selectedArcForCurveCogo));
  },
  startSubdivideCurveCommand: () => {
    beginSession(selectedArcCommandSession('SUBDIVIDE_CURVE', selectedArcForCurveCogo));
  },
  startOffsetCurveCommand: () => {
    beginSession(selectedArcCommandSession('OFFSET_CURVE', selectedArcForCurveCogo));
  },
  startPiCurveCommand: () =>
    beginSession({
      key: 'PI_CURVE',
      inputValue: '',
      piPoint: null,
      backTangentPoint: null,
    }),
  startChordBearingCurveCommand: () =>
    beginSession({
      key: 'CHORD_BEARING_CURVE',
      inputValue: '',
      startPoint: null,
    }),
  startReverseCurveCommand: () => {
    beginSession(selectedArcCommandSession('REVERSE_CURVE', selectedArcForCurveCogo));
  },
  startCompoundCurveCommand: () => {
    beginSession(selectedArcCommandSession('COMPOUND_CURVE', selectedArcForCurveCogo));
  },
  startCurveBetweenTwoLinesCommand: () => {
    const preseed = linePairPreseed(f1Project, selectedEntityIds);
    beginSession({
      key: 'CURVE_BETWEEN_TWO_LINES',
      inputValue: '',
      firstEntityId: preseed.firstEntityId,
      firstPickPoint: preseed.firstPickPoint,
      secondEntityId: preseed.secondEntityId,
      secondPickPoint: preseed.secondPickPoint,
      metricMode: null,
      metricValue: null,
      ...(preseed.invalidMessage ? { resultText: preseed.invalidMessage } : {}),
    });
  },
  startCurveOnTwoLinesCommand: () => {
    const preseed = linePairPreseed(f1Project, selectedEntityIds);
    beginSession({
      key: 'CURVE_ON_TWO_LINES',
      inputValue: '',
      firstEntityId: preseed.firstEntityId,
      firstPickPoint: preseed.firstPickPoint,
      secondEntityId: preseed.secondEntityId,
      secondPickPoint: preseed.secondPickPoint,
      metricMode: null,
      metricValue: null,
      ...(preseed.invalidMessage ? { resultText: preseed.invalidMessage } : {}),
    });
  },
  startCurveThroughPointCommand: () => {
    const preseed = linePairPreseed(f1Project, selectedEntityIds);
    beginSession({
      key: 'CURVE_THROUGH_POINT',
      inputValue: '',
      firstEntityId: preseed.firstEntityId,
      firstPickPoint: preseed.firstPickPoint,
      secondEntityId: preseed.secondEntityId,
      secondPickPoint: preseed.secondPickPoint,
      throughPoint: null,
      candidateSide: null,
      ...(preseed.invalidMessage ? { resultText: preseed.invalidMessage } : {}),
    });
  },
  startMultipleCurvesCommand: () => {
    const preseed = linePairPreseed(f1Project, selectedEntityIds);
    beginSession({
      key: 'MULTIPLE_CURVES',
      inputValue: '',
      firstEntityId: preseed.firstEntityId,
      firstPickPoint: preseed.firstPickPoint,
      secondEntityId: preseed.secondEntityId,
      secondPickPoint: preseed.secondPickPoint,
      count: null,
      floatingIndex: null,
      segments: [],
      ...(preseed.invalidMessage ? { resultText: preseed.invalidMessage } : {}),
    });
  },
  startCurveFromEndCommand: () => {
    if (f1Project) {
      const sourceId = exactlyOneSelectedOf(f1Project, selectedEntityIds, LINE_OR_ARC_SET);
      if (sourceId) {
        const source = continuationSourceOf(f1Project, sourceId);
        const arc = findF1Arc(f1Project, sourceId);
        const line = source && source.kind === 'line' ? findF1Line(f1Project, sourceId) : null;
        const mid = line ? lineMidpoint(line) : arc ? arcMidpoint(arc) : null;
        let end: 'start' | 'end' = 'end';
        if (line && mid) {
          end = 'end';
        } else if (arc && mid) {
          end = arcNearerEnd(arc, mid);
        }
        beginSession({
          key: 'CURVE_FROM_END',
          inputValue: '',
          sourceEntityId: sourceId,
          pickPoint: mid,
          end,
          mode: null,
          endPoint: null,
          signedRadius: null,
          extentMode: null,
          extentValue: null,
        });
        return;
      }
    }
    beginSession({
      key: 'CURVE_FROM_END',
      inputValue: '',
      sourceEntityId: null,
      pickPoint: null,
      end: null,
      mode: null,
      endPoint: null,
      signedRadius: null,
      extentMode: null,
      extentValue: null,
      ...(selectedEntityIds.length > 0 ? { resultText: 'The current selection holds no usable line-or-arc source. Click a line-or-arc body near the end to continue from; the session stays active.' } : {}),
    });
  },
  startReverseOrCompoundCommand: () => {
    if (f1Project) {
      const sourceId = exactlyOneSelectedOf(f1Project, selectedEntityIds, ARC_SET);
      if (sourceId) {
        beginSession({
          key: 'REVERSE_OR_COMPOUND',
          inputValue: '',
          sourceEntityId: sourceId,
          // Preseed defaults to the end; a click near either end re-fixes it.
          end: 'end',
          rcMode: null,
          radius: null,
          extentMode: null,
          extentValue: null,
          pointEnd: null,
        });
        return;
      }
    }
    beginSession({
      key: 'REVERSE_OR_COMPOUND',
      inputValue: '',
      sourceEntityId: null,
      end: null,
      rcMode: null,
      radius: null,
      extentMode: null,
      extentValue: null,
      pointEnd: null,
      ...(selectedEntityIds.length > 0 ? { resultText: 'The current selection holds no usable arc source. Click an arc body near the endpoint to continue from; the session stays active.' } : {}),
    });
  },
  startBearingBearingIntersectionCommand: () =>
    beginSession({
      key: 'BEARING_BEARING_INTX',
      inputValue: '',
      firstPoint: null,
      secondPoint: null,
    }),
  startBearingDistanceIntersectionCommand: () =>
    beginSession({
      key: 'BEARING_DISTANCE_INTX',
      inputValue: '',
      firstPoint: null,
      secondPoint: null,
    }),
  startDistanceDistanceIntersectionCommand: () =>
    beginSession({
      key: 'DISTANCE_DISTANCE_INTX',
      inputValue: '',
      firstPoint: null,
      secondPoint: null,
    }),
  startLineCircleIntersectionCommand: () => {
    // Preferred path: one selected line + one selected circle preseed the
    // native circle entity (actual center/radius geometry at commit). Legacy
    // center+radius typing stays as the fallback; otherwise prompt picks.
    if (f1Project && selectedEntityIds.length > 0) {
      const lines = selectedEntityIds
        .map((id) => findF1Line(f1Project, id))
        .filter((entry): entry is CadLineEntity => entry != null);
      const circles = selectedEntityIds
        .map((id) => {
          const entity = f1Project.entities.find((entry) => entry.id === id) ?? null;
          return entity?.type === 'circle' ? entity : null;
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry != null);
      if (lines.length === 1 || circles.length === 1) {
        const line = lines.length === 1 ? lines[0]! : null;
        const circle = circles.length === 1 ? circles[0]! : null;
        if (lines.length <= 1 && circles.length <= 1 && (line || circle)) {
          beginSession({
            key: 'LINE_CIRCLE_INTX',
            inputValue: '',
            lineStart: line ? { x: line.fromX, y: line.fromY, label: line.fromStationId } : null,
            lineEnd: line ? { x: line.toX, y: line.toY, label: line.toStationId } : null,
            targetPoint: null,
            circleEntityId: circle ? circle.id : null,
          });
          return;
        }
      }
      if (selectedLineCommandPoints) {
        beginSession({
          key: 'LINE_CIRCLE_INTX',
          inputValue: '',
          lineStart: selectedLineCommandPoints.start,
          lineEnd: selectedLineCommandPoints.end,
          targetPoint: null,
          circleEntityId: null,
        });
        return;
      }
      beginSession({
        key: 'LINE_CIRCLE_INTX',
        inputValue: '',
        lineStart: null,
        lineEnd: null,
        targetPoint: null,
        circleEntityId: null,
        resultText: 'The current selection holds no usable line/circle pair. Click a line body first, then a native circle body; the session stays active.',
      });
      return;
    }
    if (!selectedLineCommandPoints) {
      beginSession({
        key: 'LINE_CIRCLE_INTX',
        inputValue: '',
        lineStart: null,
        lineEnd: null,
        targetPoint: null,
        circleEntityId: null,
      });
      return;
    }
    beginSession({
      key: 'LINE_CIRCLE_INTX',
      inputValue: '',
      lineStart: selectedLineCommandPoints.start,
      lineEnd: selectedLineCommandPoints.end,
      targetPoint: null,
      circleEntityId: null,
    });
  },
  startPerpendicularIntersectionCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession({
      key: 'PERP_INTX',
      inputValue: '',
      lineStart: selectedLineCommandPoints.start,
      lineEnd: selectedLineCommandPoints.end,
      targetPoint: null,
    });
  },
  startOffsetIntersectionCommand: () => {
    if (!selectedLinePairCommandPoints) return;
    beginSession({
      key: 'OFFSET_INTX',
      inputValue: '',
      firstLineStart: selectedLinePairCommandPoints.first.start,
      firstLineEnd: selectedLinePairCommandPoints.first.end,
      secondLineStart: selectedLinePairCommandPoints.second.start,
      secondLineEnd: selectedLinePairCommandPoints.second.end,
    });
  },
  startSkewIntersectionCommand: () => {
    if (!selectedLineCommandPoints) return;
    beginSession({
      key: 'SKEW_INTX',
      inputValue: '',
      lineStart: selectedLineCommandPoints.start,
      lineEnd: selectedLineCommandPoints.end,
      targetPoint: null,
    });
  },
  // Phase 18O annotation creation sessions (fixed anchors; text via input).
  startMTextCommand: () => beginSession({ key: 'MTEXT', inputValue: '', point: null, lines: [] }),
  startLeaderCommand: () => beginSession({ key: 'LEADER', inputValue: '', arrowPoint: null, lines: [] }),
  startDimCommand: () => beginSession({ key: 'DIM', inputValue: '', points: [] }),
  startDimLinearCommand: () => beginSession({ key: 'DIMLINEAR', inputValue: '', points: [] }),
  startDimAlignedCommand: () => beginSession({ key: 'DIMALIGNED', inputValue: '', points: [] }),
  startDimAngularCommand: () => beginSession({ key: 'DIMANGULAR', inputValue: '', points: [] }),
  startDimRadiusCommand: () => beginSession({ key: 'DIMRADIUS', inputValue: '', points: [] }),
  startDimDiameterCommand: () => beginSession({ key: 'DIMDIAMETER', inputValue: '', points: [] }),
  startBearingLabelCommand: () =>
    beginSession({ key: 'BDLABEL', inputValue: '', points: [], sourceEntityId: null }),
  startCurveLabelCommand: () =>
    beginSession({ key: 'CURVELABEL', inputValue: '', points: [], sourceEntityId: null }),
  startBestFitLineCommand: () =>
    beginSession(bestFitPreseed('BESTFITLINE', bestFitProject, selectedEntityIds)),
  startBestFitArcCommand: () =>
    beginSession(bestFitPreseed('BESTFITARC', bestFitProject, selectedEntityIds)),
  startBestFitParabolaCommand: () =>
    beginSession(bestFitPreseed('BESTFITPARABOLA', bestFitProject, selectedEntityIds)),
  startMoveCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'MOVE', inputValue: '', startPoint: null });
  },
  startRotateCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'ROTATE', inputValue: '', basePoint: null, refPoint: null });
  },
  startScaleCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'SCALE', inputValue: '', basePoint: null });
  },
  startMirrorCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'MIRROR', inputValue: '', firstPoint: null, secondPoint: null, eraseSource: null });
  },
  startAlign2DCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'ALIGN2D', inputValue: '', source1: null, source2: null, target1: null, target2: null, scaleToFit: null });
  },
  startHelmert2DCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'HELMERT2D', inputValue: '', mode: 'SIMILARITY', pairs: [], pendingSource: null });
  },
  startGridGroundCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'GRIDGROUND', inputValue: '', origin: null, combinedScaleFactor: null, direction: 'GRID_TO_GROUND' });
  },
  // Whole-drawing scope: no selection required.
  startProjectTransformCommand: () => {
    beginSession({
      key: 'PROJECTTRANSFORM',
      inputValue: '',
      projectMode: 'HELMERT',
      helmertMode: 'SIMILARITY',
      pairs: [],
      pendingSource: null,
      origin: null,
      combinedScaleFactor: null,
      direction: 'GRID_TO_GROUND',
    });
  },
  startCopyCommand: () => {
    if (selectionCount === 0) return;
    beginSession({ key: 'COPY', inputValue: '', startPoint: null });
  },
  startExtendCommand: () =>
    beginSession({
      key: 'EXTEND',
      inputValue: '',
      firstTargetEntityId: null,
      firstTargetPickPoint: null,
      firstTargetSegmentId: undefined,
    }),
  startTrimCommand: () =>
    beginSession({
      key: 'TRIM',
      inputValue: '',
      firstEntityId: null,
      firstPickPoint: null,
      firstSegmentId: undefined,
    }),
  startFilletCommand: () =>
    beginSession({
      key: 'FILLET',
      inputValue: '',
      radius: null,
      firstEntityId: null,
      firstPickPoint: null,
      firstSegmentId: undefined,
    }),
  startPasteCommand: (sourceEntityIds, basePoint) => {
    if (sourceEntityIds.length === 0) return;
    beginSession({
      key: 'PASTE',
      inputValue: '',
      startPoint: basePoint,
      sourceEntityIds,
    });
  },
  startLineTableCommand: () => {
    if (selectedEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'LINETABLE',
      tableKind: 'line',
      sourceEntityIds: selectedEntityIds,
      insertion: null,
    });
  },
  startCurveTableCommand: () => {
    if (selectedEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'CURVETABLE',
      tableKind: 'curve',
      sourceEntityIds: selectedEntityIds,
      insertion: null,
    });
  },
  startParcelTableCommand: () => {
    if (selectedEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'PARCELTABLE',
      tableKind: 'parcel-course',
      sourceEntityIds: selectedEntityIds,
      insertion: null,
    });
  },
  startPointTableCommand: () => {
    const sourceEntityIds =
      selectedEntityIds.length > 0 ? selectedEntityIds : surveyPointEntityIdsInStationOrder;
    if (sourceEntityIds.length === 0) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'POINTTABLE',
      tableKind: 'point',
      sourceEntityIds,
      insertion: null,
    });
  },
  startParcelReportCommand: () => {
    const parcelEntityId = selectedEntityIds[0];
    if (parcelEntityId == null) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'PARCELREPORT',
      tableKind: 'parcel-summary',
      sourceEntityIds: [parcelEntityId],
      insertion: null,
    });
  },
  startParcelDescCommand: () => {
    const parcelEntityId = selectedEntityIds[0];
    if (parcelEntityId == null) return;
    beginSession({
      key: 'SURVEYTABLE',
      inputValue: '',
      engineKey: 'PARCELDESC',
      tableKind: 'parcel-course',
      sourceEntityIds: [parcelEntityId],
      insertion: null,
    });
  },
};
};
