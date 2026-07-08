import type { CadWorldPoint } from './cadGeometry';
import type { CadParcelLayoutSettings } from './cadTypes';
import type { CadParcelSplitDraft } from './cadCogoParcelSplit';
import type { CadParcelLayoutFrontageReference } from './cadCogoParcelFrontage';

export type CadParcelLayoutSplitAlternative = 'start' | 'end';

export interface CadParcelLayoutSplitDraft {
  split: CadParcelSplitDraft;
  alternative: CadParcelLayoutSplitAlternative;
  frontageLengthMeters: number;
  childAreaSquareMeters: number;
  childVertices: CadWorldPoint[];
  childVertexLabels: string[];
  remainderVertices: CadWorldPoint[];
  remainderVertexLabels: string[];
}

export interface CadParcelLayoutConstraintEvaluation {
  frontageLengthMeters: number;
  frontageAtOffsetWidthMeters: number | null;
  minimumSampledWidthMeters: number | null;
  depthMeters: number | null;
  score: number;
  failedRuleCodes: Array<
    | 'min_area'
    | 'min_frontage'
    | 'frontage_at_offset'
    | 'min_width'
    | 'min_depth'
    | 'max_depth'
  >;
  messages: string[];
}

export interface CadParcelLayoutPreviewCandidate {
  tool: 'slide' | 'swing';
  alternative: CadParcelLayoutSplitAlternative;
  draft: CadParcelLayoutSplitDraft | null;
  evaluation: CadParcelLayoutConstraintEvaluation | null;
  isValid: boolean;
  statusMessage: string;
}

export interface CadParcelLayoutGeneratedParcelDraft {
  vertices: CadWorldPoint[];
  vertexLabels: string[];
  role: 'lot' | 'remainder';
  sourceKind?: 'segment' | 'corner_prepass' | 'corner_remainder';
  sourceSegmentIndex?: number;
}

export interface CadParcelAutoLayoutDraft {
  tool: 'slide' | 'swing';
  generatedParcels: CadParcelLayoutGeneratedParcelDraft[];
  acceptedCandidates: CadParcelLayoutPreviewCandidate[];
  isValid: boolean;
  statusMessage: string;
}

export type { CadParcelLayoutSettings, CadParcelLayoutFrontageReference };
