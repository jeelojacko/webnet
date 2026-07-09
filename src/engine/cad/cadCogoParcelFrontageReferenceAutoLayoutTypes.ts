import type {
  CadParcelAutoLayoutDraft,
  CadParcelLayoutGeneratedParcelDraft,
} from './cadCogoParcelLayoutTypes';

export interface CadCornerInfillDraft {
  draft: CadParcelAutoLayoutDraft;
  remainderDraft: CadParcelLayoutGeneratedParcelDraft | null;
  firstSegmentTrimMeters: number;
  secondSegmentTrimMeters: number;
}
