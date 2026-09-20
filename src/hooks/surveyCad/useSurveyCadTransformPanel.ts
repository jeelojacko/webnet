// Phase 18Q HELMERT2D / GRIDGROUND compact panel state (pure derivation).
//
// The panel reads the LIVE command session (viewport picks AND typed values
// feed the same session) and renders a small table + fit summary; it never
// touches authoritative geometry. Preview is the existing
// `transform-selection` ghost with the solved transform; Apply commits ONE
// undo entry through the registered command path (which re-solves
// identically). Residuals are labeled residual-only: RMS here is a fit
// residual, never accuracy or stddev. Equal weights, no outlier removal:
// every explicit pair counts fully.

import { gridGroundTransform, solveHelmert2D } from '../../engine/cad/cadHelmert2D';
import type {
  CommandSession,
  GridGroundSessionDirection,
  HelmertSessionMode,
} from './useSurveyCadCommandTypes';

export interface HelmertPanelRow {
  index: number;
  sourceE: number;
  sourceN: number;
  targetE: number;
  targetN: number;
  dE: number;
  dN: number;
  residual: number;
}

export interface HelmertPanelFit {
  rotationDeg: number;
  scale: number;
  scalePpm: number;
  translationE: number;
  translationN: number;
  rmsResidual: number;
  maxResidual: number;
}

export interface HelmertPanelState {
  mode: HelmertSessionMode;
  pairCount: number;
  pendingSource: { x: number; y: number; label: string } | null;
  rows: HelmertPanelRow[];
  fit: HelmertPanelFit | null;
  failReason: string | null;
  canApply: boolean;
  resultText?: string;
}

export interface GridGroundPanelState {
  origin: { x: number; y: number; label: string } | null;
  combinedScaleFactor: number | null;
  direction: GridGroundSessionDirection;
  effectiveFactor: number | null;
  formula: string | null;
  failReason: string | null;
  canApply: boolean;
  resultText?: string;
}

export const buildHelmertPanelState = (session: CommandSession | null): HelmertPanelState | null => {
  if (!session || session.key !== 'HELMERT2D') return null;
  if (session.pairs.length < 2) {
    return {
      mode: session.mode,
      pairCount: session.pairs.length,
      pendingSource: session.pendingSource,
      rows: session.pairs.map((pair, index) => ({
        index: index + 1,
        sourceE: pair.source.x,
        sourceN: pair.source.y,
        targetE: pair.target.x,
        targetN: pair.target.y,
        dE: Number.NaN,
        dN: Number.NaN,
        residual: Number.NaN,
      })),
      fit: null,
      failReason: null,
      canApply: false,
      resultText: session.resultText,
    };
  }
  const solved = solveHelmert2D(
    session.pairs.map((pair) => ({
      sourceE: pair.source.x,
      sourceN: pair.source.y,
      targetE: pair.target.x,
      targetN: pair.target.y,
    })),
    session.mode,
  );
  if (!solved.ok) {
    return {
      mode: session.mode,
      pairCount: session.pairs.length,
      pendingSource: session.pendingSource,
      rows: session.pairs.map((pair, index) => ({
        index: index + 1,
        sourceE: pair.source.x,
        sourceN: pair.source.y,
        targetE: pair.target.x,
        targetN: pair.target.y,
        dE: Number.NaN,
        dN: Number.NaN,
        residual: Number.NaN,
      })),
      fit: null,
      failReason: solved.reason,
      canApply: false,
      resultText: session.resultText,
    };
  }
  return {
    mode: session.mode,
    pairCount: session.pairs.length,
    pendingSource: session.pendingSource,
    rows: session.pairs.map((pair, index) => {
      const residual = solved.residuals[index]!;
      return {
        index: index + 1,
        sourceE: pair.source.x,
        sourceN: pair.source.y,
        targetE: pair.target.x,
        targetN: pair.target.y,
        dE: residual.dE,
        dN: residual.dN,
        residual: residual.r,
      };
    }),
    fit: {
      rotationDeg: solved.rotationDeg,
      scale: solved.scale,
      scalePpm: solved.scalePpm,
      translationE: solved.translationE,
      translationN: solved.translationN,
      rmsResidual: solved.rmsResidual,
      maxResidual: solved.maxResidual,
    },
    failReason: null,
    canApply: true,
    resultText: session.resultText,
  };
};

export const buildGridGroundPanelState = (
  session: CommandSession | null,
): GridGroundPanelState | null => {
  if (!session || session.key !== 'GRIDGROUND') return null;
  if (session.origin == null || session.combinedScaleFactor == null) {
    return {
      origin: session.origin,
      combinedScaleFactor: session.combinedScaleFactor,
      direction: session.direction,
      effectiveFactor: null,
      formula: null,
      failReason: null,
      canApply: false,
      resultText: session.resultText,
    };
  }
  const derived = gridGroundTransform(
    session.origin.x,
    session.origin.y,
    session.combinedScaleFactor,
    session.direction,
  );
  if (!derived.ok) {
    return {
      origin: session.origin,
      combinedScaleFactor: session.combinedScaleFactor,
      direction: session.direction,
      effectiveFactor: null,
      formula: null,
      failReason: derived.reason,
      canApply: false,
      resultText: session.resultText,
    };
  }
  return {
    origin: session.origin,
    combinedScaleFactor: session.combinedScaleFactor,
    direction: session.direction,
    effectiveFactor: derived.effectiveFactor,
    formula: derived.formula,
    failReason: null,
    canApply: true,
    resultText: session.resultText,
  };
};
