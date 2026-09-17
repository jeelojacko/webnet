import React from 'react';
import { describePointSymbolShape } from '../../engine/cad/cadPointSymbolShape';
import type { CadPointLabelStyle, CadPointSymbolShape } from '../../engine/cad/cadTypes';
import { previewLabelText } from './surveyManagerShared';

/**
 * Phase 18D survey-manager shared components (components only, for
 * react-refresh; constants/helpers live in surveyManagerShared.ts).
 */

export const ManagerShell: React.FC<{
  label: string;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}> = ({ label, title, onClose, children }) => (
  <section
    aria-label={label}
    className="absolute right-3 top-16 z-40 max-h-[80%] w-[480px] overflow-auto rounded border border-slate-600 bg-slate-900 p-3 text-slate-100"
  >
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[12px] font-semibold">{title}</h2>
      <button
        type="button"
        className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
        onClick={onClose}
      >
        Close
      </button>
    </div>
    {children}
  </section>
);

export const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="grid gap-0.5 text-[11px] text-slate-300">
    <span className="text-slate-400">{label}</span>
    {children}
  </label>
);

/** SVG marker preview reusing the shared symbol geometry (screen + export agree). */
export const PointMarkerPreview: React.FC<{
  shape: CadPointSymbolShape | undefined;
  radius: number;
  scale?: number;
  rotationDeg?: number;
  displayMarker: boolean;
}> = ({ shape, radius, scale = 1, rotationDeg = 0, displayMarker }) => {
  if (!displayMarker) return <span className="text-[11px] text-slate-500">No Display</span>;
  const r = (Number.isFinite(radius) && radius > 0 ? radius : 8) * (scale > 0 ? scale : 1);
  // Preview normalizes to a fixed box; geometry (not size) is what must agree.
  const norm = 10 / r;
  const geometry = describePointSymbolShape(shape, 10);
  const rotate = `rotate(${Number.isFinite(rotationDeg) ? rotationDeg : 0})`;
  return (
    <svg width="36" height="36" viewBox="-14 -14 28 28" aria-hidden="true" data-marker-preview>
      <g transform={rotate} stroke="currentColor" strokeWidth={1.5 / norm} fill="none">
        {geometry.kind === 'circle' ? <circle cx={0} cy={0} r={10} /> : null}
        {geometry.kind === 'dot' ? <circle cx={0} cy={0} r={5} fill="currentColor" /> : null}
        {geometry.kind === 'polygon' ? (
          <polygon points={geometry.points.map((point) => `${point.x},${point.y}`).join(' ')} />
        ) : null}
        {geometry.kind === 'segments'
          ? geometry.segments.map((segment, index) => (
            <line
              key={index}
              x1={segment[0].x}
              y1={segment[0].y}
              x2={segment[1].x}
              y2={segment[1].y}
            />
          ))
          : null}
      </g>
    </svg>
  );
};

export const LabelStylePreview: React.FC<{ style: CadPointLabelStyle }> = ({ style }) => {
  if (!style.visible) return <span className="text-[11px] text-slate-500">No Label</span>;
  return (
    <span className="text-[11px] text-slate-100" data-label-preview>
      {previewLabelText(style) || '(empty)'}
    </span>
  );
};
