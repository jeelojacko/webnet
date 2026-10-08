import type { CadBatchCogoDraft } from '../../engine/cad/cadBatchCogo';
import type { CadLineSegmentInput, CadLineSide } from '../../engine/cad/cadLineTypes';
import type { RegularPolygonMode } from '../../engine/cad/cadGeometryShapeBuilders';
import type { CadCurveMetricMode } from '../../engine/cad/cadCurveMetricsSolver';
import type { CadCurveF1ExtentMode } from './useSurveyCadCurveF1Session';
import type { CadLineL1CommandKey } from './useSurveyCadLineL1Keys';
import type { CadTangentSource } from '../../engine/cad/cadGeometryCircleTangentSolvers';
import type {
  CadTraverseAdjustmentMethod,
  CadTraverseAdjustmentSummary,
} from '../../engine/cad/cadCogo';
import type { CadNamedPoint } from '../../engine/cad/cadGeometry';
import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadParcelEntity,
  CadPolylineSegmentGeometry,
  CadPolylineSegmentWidth,
  CadSnapKind,
  CadSurveyTableKind,
} from '../../engine/cad/cadTypes';

export type CommandPoint = CadNamedPoint & {
  snapSourceSegmentId?: string;
  snapSourceEntityId?: string;
  snapKind?: CadSnapKind;
  /**
   * World-unit snap tolerance the consumed snap was computed at (viewport
   * scale proxy). Used by the corrected L1 on-source pick to reject a snap
   * that is stale after a viewport change; absent for raw/typed points.
   */
  snapComputedScale?: number;
  /** Viewport generation the consumed snap was computed at (freshness stamp). */
  snapViewportGeneration?: number;
  extendMode?: boolean;
  /**
   * CAD Draw L1 label provenance: true when `label` is an authoritative
   * station id resolved from a survey-point entity. Resolved station ids
   * bypass auto-label rewriting (`L<n>`) entirely; only locally-generated
   * free points get ordinals. Never inferred from the label text.
   */
  labelIsStationId?: boolean;
};

export type TraverseDraftMode = 'open' | 'closed' | 'point-to-point';

export type PolygonSessionPhase = 'sides' | 'mode' | 'center' | 'radius';

/** Phase 18Q HELMERT2D session state: explicit control pairs only (no name-matching). */
export type HelmertSessionMode = 'RIGID' | 'SIMILARITY';

export interface HelmertSessionPair {
  source: CommandPoint;
  target: CommandPoint;
}

export type GridGroundSessionDirection = 'GRID_TO_GROUND' | 'GROUND_TO_GRID';

export interface TraverseSideshotDraft {
  occupyLabel: string;
  backsightLabel: string;
  side: 'left' | 'right';
  angleDeg: number;
  distance: number;
  inputValue: string;
  point: {
    label: string;
    x: number;
    y: number;
  };
}

export interface TraverseAdjustmentDraft {
  method: CadTraverseAdjustmentMethod;
  summary: CadTraverseAdjustmentSummary;
}

export type ActiveCommandKey =
  | 'POINT'
  | 'COGO_POINT'
  | 'LINE'
  | 'RECTANGLE'
  | 'CIRCLE'
  | 'CIRCLECD'
  | 'CIRCLE2P'
  | 'CIRCLE3P'
  | 'CIRCLETTR'
  | 'CIRCLETTT'
  | 'POLYGON'
  | 'PLINE'
  | 'TRAVERSE'
  | 'ARC_3PT'
  | 'ARC_SCE'
  | 'ARC_CSE'
  | 'ARC_SCA'
  | 'ARC_CSA'
  | 'ARC_SCL'
  | 'ARC_CSL'
  | 'ARC_SEA'
  | 'ARC_SED'
  | 'ARC_SER'
  | 'CONTINUE_CURVE'
  | 'TANGENT_CURVE'
  | 'INVERSE'
  | 'MULTI_INVERSE'
  | 'AREA'
  | 'BEARING_REPORT'
  | 'DISTANCE_REPORT'
  | 'TURNED_POINT'
  | 'DEFLECT_POINT'
  | 'POINT_ALONG_LINE'
  | 'EXTEND_LINE'
  | 'OFFSET_POINT'
  | 'ALIGNMENT_OFFSET_CREATE'
  | 'ALIGNMENT_STATION_EQUATION'
  | 'ALIGNMENT_OFFSET_POINT'
  | 'ALIGNMENT_INTERVAL_POINTS'
  | 'CURVE_SOLVER'
  | 'CURVE_BETWEEN_TWO_LINES'
  | 'CURVE_ON_TWO_LINES'
  | 'CURVE_THROUGH_POINT'
  | 'MULTIPLE_CURVES'
  | 'CURVE_FROM_END'
  | 'REVERSE_OR_COMPOUND'
  | 'RADIAL_BEARING'
  | 'POINT_ON_CURVE'
  | 'SUBDIVIDE_CURVE'
  | 'OFFSET_CURVE'
  | 'PI_CURVE'
  | 'CHORD_BEARING_CURVE'
  | 'REVERSE_CURVE'
  | 'COMPOUND_CURVE'
  | 'BEARING_BEARING_INTX'
  | 'BEARING_DISTANCE_INTX'
  | 'DISTANCE_DISTANCE_INTX'
  | 'LINE_CIRCLE_INTX'
  | 'PERP_INTX'
  | 'OFFSET_INTX'
  | 'SKEW_INTX'
  | 'BATCH_COGO'
  | 'MTEXT'
  | 'LEADER'
  | 'DIM'
  | 'DIMLINEAR'
  | 'DIMALIGNED'
  | 'DIMANGULAR'
  | 'DIMRADIUS'
  | 'DIMDIAMETER'
  | 'BDLABEL'
  | 'CURVELABEL'
  | 'LINETABLE'
  | 'CURVETABLE'
  | 'PARCELTABLE'
  | 'POINTTABLE'
  | 'PARCELREPORT'
  | 'PARCELDESC'
  | 'SURVEYTABLE'
  | 'PARCEL_SPLIT_BEARING'
  | 'PARCEL_SPLIT_AREA'
  | 'PARCELDESIGNATE'
  | 'PARCELNUMBER'
  | 'PARCELLINK'
  | 'PARCELUNLINK'
  | 'PARCELCHECK'
  | 'PARCELSCHEDULE'
  | 'PARCELSHAREDEDIT'
  | 'PLINEINSERTVERTEX'
  | 'PLINEDELETEVERTEX'
  | 'BESTFITLINE'
  | 'BESTFITARC'
  | 'BESTFITPARABOLA'
  | 'MOVE'
  | 'COPY'
  | 'ROTATE'
  | 'SCALE'
  | 'MIRROR'
  | 'ALIGN2D'
  | 'HELMERT2D'
  | 'GRIDGROUND'
  | 'PROJECTTRANSFORM'
  | 'EXTEND'
  | 'TRIM'
  | 'FILLET'
  | 'PASTE'
  | CadLineL1CommandKey;

/**
 * CAD Draw Phase L1 — shared session state for the 16 Line-creation modes.
 *
 * One shape covers every mode so the switch-based seams stay small: only the
 * fields a given mode uses are populated. `lineSegments` is the ordered draft
 * (the actual commit payload); `lineAnchor` is the live chain tip (or the
 * explicit start point) used to derive the next segment. Nothing here mutates
 * the drawing while drafting — Enter commits the whole draft as one batch.
 */
export interface CadLineL1SessionState {
  key: CadLineL1CommandKey;
  inputValue: string;
  /** Ordered draft segments; committed atomically via LINE_CREATE_BATCH. */
  lineSegments: CadLineSegmentInput[];
  /** Chain tip / explicit start / occupied point, depending on the mode. */
  lineAnchor: CommandPoint | null;
  /** Reference-course start (ANGLE/DEFLECTION). */
  lineReferenceStart: CommandPoint | null;
  /** Reference-course end (ANGLE/DEFLECTION). */
  lineReferenceEnd: CommandPoint | null;
  /** Picked source entity (EXTENSION/FROM_END/TANGENT/PERP). */
  lineSourceEntityId: string | null;
  /** Where the operator clicked the source (proximity/endpoint choice). */
  lineSourcePickPoint: CommandPoint | null;
  /**
   * Corrected TANGENT/PERP phase B: the exact point resolved ON the source
   * object (finite-segment / finite-sweep projection).
   */
  lineSourceOnPoint: CommandPoint | null;
  /**
   * Corrected TANGENT/PERP phase C: unit ray direction (source tangent for
   * TANGENT, source normal/outward radial for PERP). Positive signed distance
   * travels along it, negative travels its reverse.
   */
  lineSourceRayDirection: { x: number; y: number } | null;
  /** Resolved source endpoint for FROM_END (start | end). */
  lineSourceEndpoint: 'start' | 'end' | null;
  /** Explicit side intent (TANGENT). */
  lineSide: CadLineSide | null;
  /** Selected alignment entity id (STATION_OFFSET). */
  lineAlignmentId: string | null;
  resultText?: string;
}

export type CommandSession =
  | {
      key: 'POINT';
      inputValue: string;
      resultText?: string;
    }
  | {
      key: 'COGO_POINT' | 'LINE' | 'INVERSE' | 'MOVE' | 'COPY';
      inputValue: string;
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'ROTATE';
      inputValue: string;
      basePoint: CommandPoint | null;
      refPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'SCALE';
      inputValue: string;
      basePoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'MIRROR';
      inputValue: string;
      firstPoint: CommandPoint | null;
      secondPoint: CommandPoint | null;
      eraseSource: boolean | null;
      resultText?: string;
    }
  | {
      key: 'ALIGN2D';
      inputValue: string;
      source1: CommandPoint | null;
      source2: CommandPoint | null;
      target1: CommandPoint | null;
      target2: CommandPoint | null;
      scaleToFit: boolean | null;
      resultText?: string;
    }
  | {
      key: 'HELMERT2D';
      inputValue: string;
      mode: HelmertSessionMode;
      pairs: HelmertSessionPair[];
      pendingSource: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'GRIDGROUND';
      inputValue: string;
      origin: CommandPoint | null;
      combinedScaleFactor: number | null;
      direction: GridGroundSessionDirection;
      resultText?: string;
    }
  | {
      key: 'PROJECTTRANSFORM';
      inputValue: string;
      projectMode: 'HELMERT' | 'GRID_GROUND';
      helmertMode: HelmertSessionMode;
      pairs: HelmertSessionPair[];
      pendingSource: CommandPoint | null;
      origin: CommandPoint | null;
      combinedScaleFactor: number | null;
      direction: GridGroundSessionDirection;
      resultText?: string;
    }
  | {
      key: 'BEARING_REPORT' | 'DISTANCE_REPORT';
      inputValue: string;
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'MULTI_INVERSE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'AREA';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'PARCEL_SPLIT_BEARING';
      inputValue: string;
      parcel: CadParcelEntity;
      splitPoint: CommandPoint | null;
      resultText?: string;
    }
  // Phase 19D network sessions: parcels captured from the selection at
  // start; typed params (or empty Enter) commit through runCadCommand.
  | {
      key:
        | 'PARCELDESIGNATE'
        | 'PARCELNUMBER'
        | 'PARCELLINK'
        | 'PARCELUNLINK'
        | 'PARCELCHECK'
        | 'PARCELSCHEDULE';
      inputValue: string;
      parcelEntityIds: string[];
      resultText?: string;
    }
  | {
      key: 'PARCELSHAREDEDIT';
      inputValue: string;
      linkId: string | null;
      resultText?: string;
    }
  | {
      key: 'PARCEL_SPLIT_AREA';
      inputValue: string;
      parcel: CadParcelEntity;
      splitPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'TURNED_POINT';
      inputValue: string;
      occupyPoint: CommandPoint | null;
      backsightPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'DEFLECT_POINT' | 'POINT_ALONG_LINE' | 'EXTEND_LINE' | 'OFFSET_POINT';
      inputValue: string;
      lineStart: CommandPoint;
      lineEnd: CommandPoint;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_OFFSET_CREATE';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_STATION_EQUATION';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_OFFSET_POINT';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'ALIGNMENT_INTERVAL_POINTS';
      inputValue: string;
      alignment: CadAlignmentEntity;
      resultText?: string;
    }
  | {
      key: 'CURVE_SOLVER';
      inputValue: string;
      resultText?: string;
    }
  // CAD Curves F1 — two-line tangent sessions. Entity picks store the exact
  // clicked entity id + pick point (snapSourceEntityId law, no nearest-guess).
  // Escape cancels with zero mutation; nothing commits until the final typed
  // metric/entry input succeeds through one atomic *_CREATE transaction.
  | {
      key: 'CURVE_BETWEEN_TWO_LINES' | 'CURVE_ON_TWO_LINES';
      inputValue: string;
      firstEntityId: string | null;
      firstPickPoint: CommandPoint | null;
      secondEntityId: string | null;
      secondPickPoint: CommandPoint | null;
      metricMode: CadCurveMetricMode | null;
      metricValue: number | null;
      resultText?: string;
    }
  | {
      key: 'CURVE_THROUGH_POINT';
      inputValue: string;
      firstEntityId: string | null;
      firstPickPoint: CommandPoint | null;
      secondEntityId: string | null;
      secondPickPoint: CommandPoint | null;
      throughPoint: CommandPoint | null;
      candidateSide: 'left' | 'right' | null;
      resultText?: string;
    }
  | {
      key: 'MULTIPLE_CURVES';
      inputValue: string;
      firstEntityId: string | null;
      firstPickPoint: CommandPoint | null;
      secondEntityId: string | null;
      secondPickPoint: CommandPoint | null;
      count: number | null;
      floatingIndex: number | null;
      segments: Array<{ length: number; radius: number }>;
      resultText?: string;
    }
  | {
      key: 'CURVE_FROM_END';
      inputValue: string;
      sourceEntityId: string | null;
      pickPoint: CommandPoint | null;
      end: 'start' | 'end' | null;
      mode: 'point' | 'radius' | null;
      endPoint: CommandPoint | null;
      signedRadius: number | null;
      extentMode: CadCurveF1ExtentMode | null;
      extentValue: number | null;
      resultText?: string;
    }
  | {
      key: 'REVERSE_OR_COMPOUND';
      inputValue: string;
      sourceEntityId: string | null;
      end: 'start' | 'end' | null;
      rcMode: 'reverse' | 'compound' | null;
      radius: number | null;
      extentMode: CadCurveF1ExtentMode | null;
      extentValue: number | null;
      pointEnd: CommandPoint | null;
      resultText?: string;
    }
  | {
      key:
        | 'RADIAL_BEARING'
        | 'POINT_ON_CURVE'
        | 'SUBDIVIDE_CURVE'
        | 'OFFSET_CURVE'
        | 'REVERSE_CURVE'
        | 'COMPOUND_CURVE';
      inputValue: string;
      /** Null while the session prompts for an arc pick (dead-click fix). */
      arc: CadArcEntity | null;
      resultText?: string;
    }
  | {
      key: 'PI_CURVE';
      inputValue: string;
      piPoint: CommandPoint | null;
      backTangentPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'CHORD_BEARING_CURVE';
      inputValue: string;
      startPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'BEARING_BEARING_INTX' | 'BEARING_DISTANCE_INTX' | 'DISTANCE_DISTANCE_INTX';
      inputValue: string;
      firstPoint: CommandPoint | null;
      secondPoint: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'LINE_CIRCLE_INTX' | 'PERP_INTX' | 'SKEW_INTX';
      inputValue: string;
      /** Null while the session prompts for a line pick (pick flow). */
      lineStart: CommandPoint | null;
      lineEnd: CommandPoint | null;
      targetPoint: CommandPoint | null;
      /**
       * Preferred LINE_CIRCLE_INTX path: the exact picked native circle
       * entity id. When set, intersections use the actual circle geometry
       * (center + radius from the entity); `targetPoint` + typed radius stay
       * as the legacy center+radius fallback.
       */
      circleEntityId?: string | null;
      resultText?: string;
    }
  | {
      key: 'OFFSET_INTX';
      inputValue: string;
      firstLineStart: CommandPoint;
      firstLineEnd: CommandPoint;
      secondLineStart: CommandPoint;
      secondLineEnd: CommandPoint;
      resultText?: string;
    }
  | {
      key: 'BATCH_COGO';
      inputValue: string;
      draft: CadBatchCogoDraft;
      resultText?: string;
    }
  | {
      key: 'PASTE';
      inputValue: string;
      startPoint: CommandPoint;
      sourceEntityIds: string[];
      resultText?: string;
    }
  | {
      key: 'EXTEND';
      inputValue: string;
      firstTargetEntityId: string | null;
      firstTargetPickPoint: CommandPoint | null;
      firstTargetSegmentId?: string;
      resultText?: string;
    }
  | {
      key: 'TRIM';
      inputValue: string;
      firstEntityId: string | null;
      firstPickPoint: CommandPoint | null;
      firstSegmentId?: string;
      resultText?: string;
    }
  | {
      key: 'FILLET';
      inputValue: string;
      radius: number | null;
      firstEntityId: string | null;
      firstPickPoint: CommandPoint | null;
      firstSegmentId?: string;
      resultText?: string;
    }
  | {
      key: 'RECTANGLE';
      inputValue: string;
      firstCorner: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'CIRCLE';
      inputValue: string;
      center: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'CIRCLECD';
      inputValue: string;
      center: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'CIRCLE2P';
      inputValue: string;
      first: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'CIRCLE3P';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'CIRCLETTR';
      inputValue: string;
      first: CadTangentSource | null;
      second: CadTangentSource | null;
      /**
       * UI-only repick law: after an AMBIGUOUS/NO_SOLUTION radius submission the
       * next distinct tangent-object click replaces `second`. Never persisted.
       */
      awaitingSecondRepick?: boolean;
      resultText?: string;
    }
  | {
      key: 'CIRCLETTT';
      inputValue: string;
      picks: CadTangentSource[];
      resultText?: string;
    }
  | {
      key: 'POLYGON';
      inputValue: string;
      phase: PolygonSessionPhase;
      sides: number | null;
      mode: RegularPolygonMode | null;
      center: CommandPoint | null;
      resultText?: string;
    }
  | {
      key: 'PLINE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
      /**
       * Phase C2 draw mode. `'line'` completes one straight course per
       * point; `'arc'` consumes 3-point legs (stored START vertex, pending
       * THROUGH point, appended END vertex). Defaults to `'line'` when
       * absent (legacy C1 sessions stay line-mode).
       */
      plineDrawMode?: 'line' | 'arc';
      /**
       * Phase C2 completed per-course geometry. Entry [index] describes the
       * course starting at `points[index]`; length is `points.length - 1`
       * when non-empty. Absent/empty = all-line (legacy C1 shape).
       */
      plineSegmentGeometry?: CadPolylineSegmentGeometry[];
      /**
       * Phase C2 completed per-course full centred band widths (metres).
       * Entry [index] describes the course starting at `points[index]`.
       * Absent/empty = zero-width (legacy C1 shape).
       */
      plineSegmentWidths?: CadPolylineSegmentWidth[];
      /**
       * Phase C2 pending arc through-point (arc mode only). Never a
       * vertex: it is consumed together with the following END point into
       * one bulged course. Null when no through-point is pending.
       */
      plineArcThrough?: CommandPoint | null;
      /**
       * Phase C2 width-setting phase. While true the next bare numeric
       * input sets the default width pair instead of adding geometry.
       */
      plineWidthPhase?: boolean;
      /**
       * Phase C2 default full centred width pair (metres) applied to
       * future courses. Persists until changed; backstep never alters it.
       * Absent = zero-width (hairline) legacy default.
       */
      plineDefaultWidth?: CadPolylineSegmentWidth;
    }
  | {
      key: 'TRAVERSE';
      inputValue: string;
      points: CommandPoint[];
      inputPoints: CommandPoint[];
      legInputs: string[];
      mode: TraverseDraftMode;
      closePoint: CommandPoint | null;
      sideshots: TraverseSideshotDraft[];
      adjustment: TraverseAdjustmentDraft | null;
      resultText?: string;
    }
  | {
      key: 'ARC_3PT';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key:
        | 'ARC_SCE'
        | 'ARC_CSE'
        | 'ARC_SCA'
        | 'ARC_CSA'
        | 'ARC_SCL'
        | 'ARC_CSL'
        | 'ARC_SEA'
        | 'ARC_SED'
        | 'ARC_SER';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'CONTINUE_CURVE';
      inputValue: string;
      sourceArc: CadArcEntity;
      resultText?: string;
    }
  | {
      key: 'TANGENT_CURVE';
      inputValue: string;
      piPoint: CommandPoint | null;
      backTangentPoint: CommandPoint | null;
      aheadTangentPoint: CommandPoint | null;
      resultText?: string;
    }
  // Phase 18O annotation creation sessions (fixed anchors; see
  // useSurveyCadAnnotationSessions for the pick/commit flows).
  | {
      key: 'MTEXT';
      inputValue: string;
      point: CommandPoint | null;
      lines: string[];
      resultText?: string;
    }
  | {
      key: 'LEADER';
      inputValue: string;
      arrowPoint: CommandPoint | null;
      lines: string[];
      resultText?: string;
    }
  | {
      key: 'DIM' | 'DIMLINEAR' | 'DIMALIGNED' | 'DIMANGULAR' | 'DIMRADIUS' | 'DIMDIAMETER';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
    }
  | {
      key: 'BDLABEL' | 'CURVELABEL';
      inputValue: string;
      points: CommandPoint[];
      sourceEntityId: string | null;
      resultText?: string;
    }
  // Phase 19A survey table creation sessions (select sources → pick the
  // insertion point → one CREATE transaction).
  | {
      key: 'SURVEYTABLE';
      inputValue: string;
      /** Engine create command this session commits (table kind derives from it). */
      engineKey: 'LINETABLE' | 'CURVETABLE' | 'PARCELTABLE' | 'POINTTABLE' | 'PARCELREPORT' | 'PARCELDESC';
      tableKind: CadSurveyTableKind;
      sourceEntityIds: string[];
      insertion: CommandPoint | null;
      title?: string;
      resultText?: string;
    }
  // Phase C3 — count-changing polyline vertex topology. The first pick (or
  // the sole selected editable polyline at start) fixes `polylineId`; the
  // next pick fixes the exact vertex (delete) or on-course point (insert).
  | {
      key: 'PLINEINSERTVERTEX' | 'PLINEDELETEVERTEX';
      inputValue: string;
      polylineId: string | null;
      resultText?: string;
    }
  // CAD Best Fit E1 — ordered sample collector. Samples are snapshots:
  // clicks never create survey points and the commit re-solves from these.
  | {
      key: 'BESTFITLINE' | 'BESTFITARC' | 'BESTFITPARABOLA';
      inputValue: string;
      samples: CommandPoint[];
      resultText?: string;
    }
  | CadLineL1SessionState;
