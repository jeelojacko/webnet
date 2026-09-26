import React from 'react';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';

/** Screen-only viewport frame guide + selection grips (never exported). */
export const ViewportGuide = (args: {
  viewportId: string;
  paperXmm: number;
  paperYmm: number;
  paperWidthMm: number;
  paperHeightMm: number;
  plotFrame: boolean;
  locked: boolean;
  selected: boolean;
  gripSizeMm: number;
}): React.JSX.Element => (
  <g aria-label={`Viewport frame ${args.viewportId}${args.locked ? ' (locked)' : ''}`}>
    {!args.plotFrame && (
      <rect x={args.paperXmm} y={args.paperYmm} width={args.paperWidthMm} height={args.paperHeightMm} fill="none" stroke="#999999" strokeDasharray="3 2" strokeWidth={0.4} />
    )}
    {args.selected && (
      <>
        <rect x={args.paperXmm} y={args.paperYmm} width={args.paperWidthMm} height={args.paperHeightMm} fill="none" stroke="#0066cc" strokeWidth={0.6} />
        {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => {
          const cx = corner.includes('e') ? args.paperXmm + args.paperWidthMm : args.paperXmm;
          const cy = corner.includes('s') ? args.paperYmm + args.paperHeightMm : args.paperYmm;
          const s = args.gripSizeMm;
          return <rect key={corner} x={cx - s / 2} y={cy - s / 2} width={s} height={s} fill={args.locked ? '#999999' : '#0066cc'} />;
        })}
        {args.locked && (
          <text x={args.paperXmm + 2} y={args.paperYmm + 5} fontSize={3.5} fill="#666666">Locked</text>
        )}
      </>
    )}
  </g>
);

/** Insertion grip for the selected north-arrow / scale-bar / plan-note. */
export const ObjectGrip = (args: { sheetId: string; draft: DraftDocument; objectId: string; gripSizeMm: number }): React.JSX.Element | null => {
  const sheet = args.draft.sheets.find((entry) => entry.id === args.sheetId);
  const object = sheet?.sheetObjects.find((entry) => entry.id === args.objectId);
  if (!object) return null;
  const s = args.gripSizeMm;
  return (
    <g aria-label={`Selected paper object ${object.id}`}>
      <rect x={object.paperXmm - s / 2} y={object.paperYmm - s / 2} width={s} height={s} fill="none" stroke="#0066cc" strokeWidth={0.6} transform={`rotate(45 ${object.paperXmm} ${object.paperYmm})`} />
    </g>
  );
};

export const MviewRectDraft = (args: { phase: { start: { x: number; y: number }; current: { x: number; y: number } } }): React.JSX.Element => {
  const x = Math.min(args.phase.start.x, args.phase.current.x);
  const y = Math.min(args.phase.start.y, args.phase.current.y);
  return <rect x={x} y={y} width={Math.abs(args.phase.current.x - args.phase.start.x)} height={Math.abs(args.phase.current.y - args.phase.start.y)} fill="none" stroke="#0066cc" strokeDasharray="4 2" strokeWidth={0.6} />;
};

/** Millimetre grid (display only). */
export const PaperGrid = (args: { widthMm: number; heightMm: number }): React.JSX.Element => {
  const vertical: number[] = [];
  for (let x = 10; x < args.widthMm; x += 10) vertical.push(x);
  const horizontal: number[] = [];
  for (let y = 10; y < args.heightMm; y += 10) horizontal.push(y);
  return (
    <g aria-label="Millimetre grid" stroke="#dddddd" strokeWidth={0.2}>
      {vertical.map((x) => (
        <line key={`v${x}`} x1={x} y1={0} x2={x} y2={args.heightMm} />
      ))}
      {horizontal.map((y) => (
        <line key={`h${y}`} x1={0} y1={y} x2={args.widthMm} y2={y} />
      ))}
    </g>
  );
};
