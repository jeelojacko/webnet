import type { CadBatchCogoDraft } from '../../engine/cad/cadBatchCogo';
import type {
  CadTraverseAdjustmentMethod,
  CadTraverseAdjustmentSummary,
} from '../../engine/cad/cadCogo';
import type { CadNamedPoint } from '../../engine/cad/cadGeometry';
import type {
  CadAlignmentEntity,
  CadArcEntity,
  CadParcelEntity,
  CadSnapKind,
} from '../../engine/cad/cadTypes';

export type CommandPoint = CadNamedPoint & {
  snapSourceSegmentId?: string;
  snapSourceEntityId?: string;
  snapKind?: CadSnapKind;
  extendMode?: boolean;
};

export type TraverseDraftMode = 'open' | 'closed' | 'point-to-point';

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
  | 'PARCEL_SPLIT_BEARING'
  | 'PARCEL_SPLIT_AREA'
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
  | 'PASTE';

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
  | {
      key:
        | 'RADIAL_BEARING'
        | 'POINT_ON_CURVE'
        | 'SUBDIVIDE_CURVE'
        | 'OFFSET_CURVE'
        | 'REVERSE_CURVE'
        | 'COMPOUND_CURVE';
      inputValue: string;
      arc: CadArcEntity;
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
      lineStart: CommandPoint;
      lineEnd: CommandPoint;
      targetPoint: CommandPoint | null;
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
      key: 'PLINE';
      inputValue: string;
      points: CommandPoint[];
      resultText?: string;
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
    };
