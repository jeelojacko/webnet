import type { ProfileSampleEventKind } from '../profiles/profileExtraction';
import type { ProfileExtractionMesh } from '../profiles/profileExtraction';

export type { ProfileExtractionMesh };

/** Fail-closed section error codes (never clamped, never guessed). */
export type SectionErrorCode =
  | 'OUT_OF_RANGE'
  | 'INVALID_SKEW'
  | 'INVALID_WIDTH'
  | 'INVALID_DIRECTION'
  | 'EMPTY_ALIGNMENT'
  | 'DEGENERATE_GEOMETRY';

export interface SectionSample {
  /** Canonical offset: negative = RIGHT, positive = LEFT of increasing chainage. */
  offset: number;
  x: number;
  y: number;
  elevation: number;
  surfaceTriangleIndex?: number;
  eventKind?: ProfileSampleEventKind;
}

export interface SectionSegment {
  /** Samples in ascending-offset pin order. */
  samples: SectionSample[];
}

export interface SectionResult {
  lineId?: string;
  /** RAW station is the persisted identity (display station is labels-only). */
  rawStation: number;
  center: { x: number; y: number };
  direction: { x: number; y: number };
  leftWidth: number;
  rightWidth: number;
  /** Ordered ascending by offset; voids/boundaries split segments (never bridged). */
  segments: SectionSegment[];
  minElevation: number | null;
  maxElevation: number | null;
  coveredWidth: number;
  gapWidth: number;
  diagnostics: string[];
}

export interface CutFillResult {
  /** Non-negative. Comparison above base. */
  fill: number;
  /** Non-negative. Comparison below base. */
  cut: number;
  /** fill - cut, in drawing units squared. */
  net: number;
  /** Offset width where both traces have coverage. */
  overlapWidth: number;
}
