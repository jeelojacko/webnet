import { useCallback, useMemo, useState } from 'react';

/** Paper view: screen px per paper mm + paper-mm pan offset. Wheel zoom
 *  changes ONLY this transform — viewport scaleDenominator is never
 *  touched by zoom (the status bar must never show paper zoom as scale). */
export interface PaperView { pxPerMm: number; panXmm: number; panYmm: number }

export const usePaperView = (sheetWidthMm: number, sheetHeightMm: number): {
  view: PaperView;
  zoomAt: (_paper: { x: number; y: number }, _factor: number) => void;
  panByPaper: (_dxMm: number, _dyMm: number) => void;
  reset: () => void;
} => {
  const initial = useMemo<PaperView>(() => {
    const fit = Math.min(900 / Math.max(1, sheetWidthMm), 600 / Math.max(1, sheetHeightMm));
    const pxPerMm = Math.min(3, Math.max(0.25, fit));
    return { pxPerMm, panXmm: 0, panYmm: 0 };
  }, [sheetWidthMm, sheetHeightMm]);
  const [view, setView] = useState<PaperView>(initial);
  const zoomAt = useCallback((paper: { x: number; y: number }, factor: number) => {
    setView((current) => {
      const pxPerMm = Math.min(20, Math.max(0.1, current.pxPerMm * factor));
      const applied = pxPerMm / current.pxPerMm;
      return {
        pxPerMm,
        panXmm: paper.x - (paper.x - current.panXmm) * applied,
        panYmm: paper.y - (paper.y - current.panYmm) * applied,
      };
    });
  }, []);
  const panByPaper = useCallback((dxMm: number, dyMm: number) => {
    setView((current) => ({ ...current, panXmm: current.panXmm + dxMm, panYmm: current.panYmm + dyMm }));
  }, []);
  const reset = useCallback(() => setView(initial), [initial]);
  return { view, zoomAt, panByPaper, reset };
};

export type MviewPhase =
  | { stage: 'idle' }
  | { stage: 'rect'; start: { x: number; y: number }; current: { x: number; y: number } }
  | {
    stage: 'place';
    rect: { x: number; y: number; w: number; h: number };
    centerX: string;
    centerY: string;
    scaleText: string;
    useStandard: boolean;
  };

/** MVIEW creation flow: drag paper rect → model center → scale → commit. */
export const useMviewCreation = (): {
  phase: MviewPhase;
  beginRect: (_point: { x: number; y: number }) => void;
  updateRect: (_point: { x: number; y: number }) => void;
  finishRect: () => void;
  patchPlace: (_patch: Partial<{ centerX: string; centerY: string; scaleText: string; useStandard: boolean }>) => void;
  cancel: () => void;
} => {
  const [phase, setPhase] = useState<MviewPhase>({ stage: 'idle' });
  const beginRect = useCallback((point: { x: number; y: number }) => {
    setPhase({ stage: 'rect', start: point, current: point });
  }, []);
  const updateRect = useCallback((point: { x: number; y: number }) => {
    setPhase((current) => (current.stage === 'rect' ? { ...current, current: point } : current));
  }, []);
  const finishRect = useCallback(() => {
    setPhase((current) => {
      if (current.stage !== 'rect') return current;
      const x = Math.min(current.start.x, current.current.x);
      const y = Math.min(current.start.y, current.current.y);
      const w = Math.abs(current.current.x - current.start.x);
      const h = Math.abs(current.current.y - current.start.y);
      if (w < 5 || h < 5) return { stage: 'idle' };
      return { stage: 'place', rect: { x, y, w, h }, centerX: '0', centerY: '0', scaleText: '500', useStandard: true };
    });
  }, []);
  const patchPlace = useCallback(
    (patch: Partial<{ centerX: string; centerY: string; scaleText: string; useStandard: boolean }>) => {
      setPhase((current) => (current.stage === 'place' ? { ...current, ...patch } : current));
    },
    [],
  );
  const cancel = useCallback(() => setPhase({ stage: 'idle' }), []);
  return { phase, beginRect, updateRect, finishRect, patchPlace, cancel };
};
