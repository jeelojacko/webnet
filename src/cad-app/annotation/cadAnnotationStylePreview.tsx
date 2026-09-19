// Phase 18O — monochrome SVG previews for annotation style managers.
//
// Previews are pure renderers: no drawing state, no measurement side effects.
// The dimension preview reuses the engine geometry resolver so what the
// operator sees matches what the viewport/export draw (single source of
// truth); text/leader/label previews are deliberately simple glyph mockups.

import React, { useMemo } from 'react';
import { deriveCadDimensionGeometry } from '../../engine/cad/annotation/cadDimensionGeometry';
import type { CadDimensionGeometryInput } from '../../engine/cad/annotation/cadDimensionGeometryTypes';
import type {
  CadBearingLabelStyle,
  CadCurveLabelStyle,
  CadDimensionStyle,
  CadLeaderStyle,
  CadTextStyle,
} from '../../engine/cad/cadTypes';

const viewBoxNumbers = (viewBox: string): number[] => viewBox.split(' ').map(Number);

const PreviewFrame: React.FC<{
  ariaLabel: string;
  testId: string;
  width?: number;
  height?: number;
  viewBox: string;
  children: React.ReactNode;
}> = ({ ariaLabel, testId, width = 96, height = 44, viewBox, children }) => (
  <svg
    width={width}
    height={height}
    viewBox={viewBox}
    role="img"
    aria-label={ariaLabel}
    data-cad-annotation-preview={testId}
    style={{ flexShrink: 0, color: 'currentColor' }}
  >
    {children}
  </svg>
);

const textHeightPx = (style: CadTextStyle): number => {
  if (style.heightMode === 'paper') return style.paperHeightMm ?? style.modelHeight ?? style.fontSize;
  if (style.heightMode === 'model') return style.modelHeight ?? style.fontSize;
  return style.fontSize;
};

/** Text style preview: sample glyphs + a proportional height bar. */
export const TextStylePreview: React.FC<{ style: CadTextStyle; testId?: string }> = ({ style, testId }) => {
  const height = textHeightPx(style);
  const label = `Text style ${style.name}`;
  return (
    <PreviewFrame ariaLabel={label} testId={testId ?? `text-${style.id}`} viewBox="0 0 96 44">
      <text
        x="4"
        y="22"
        fontSize="16"
        fontFamily={style.fontFamily}
        fontWeight={style.fontWeight === 'bold' ? 'bold' : 'normal'}
        fontStyle={style.fontStyle === 'italic' ? 'italic' : 'normal'}
        fill="currentColor"
      >
        Aa
      </text>
      <line x1="4" y1="40" x2={4 + Math.max(4, Math.min(88, height * 4))} y2="40" stroke="currentColor" strokeWidth="2" />
    </PreviewFrame>
  );
};

const dimensionKindForPreview = (): CadDimensionGeometryInput => ({
  kind: 'linear-horizontal',
  p1: { x: 0, y: 0 },
  p2: { x: 40, y: 0 },
  dimLinePoint: { x: 20, y: -12 },
  textGap: 1,
  arrowSize: 2.5,
  extensionOffset: 1,
  extensionOvershoot: 1,
  textHeight: 2.5,
  decimalPrecision: 3,
});

/** Dimension style preview: a real horizontal dimension through the resolver. */
export const DimensionStylePreview: React.FC<{ style: CadDimensionStyle; testId?: string }> = ({ style, testId }) => {
  const geometry = useMemo(
    () =>
      deriveCadDimensionGeometry({
        ...dimensionKindForPreview(),
        textGap: style.textGap,
        arrowSize: style.arrowSize,
        extensionOffset: style.extensionOffset,
        extensionOvershoot: style.extensionOvershoot,
        decimalPrecision: style.decimalPrecision,
        prefix: style.prefix,
        suffix: style.suffix,
      }),
    [style],
  );
  const { minX, minY, maxX, maxY } = geometry.bounds;
  const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
  const viewBox = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
  const scale = viewBoxNumbers(viewBox)[2]! / 96;
  return (
    <PreviewFrame ariaLabel={`Dimension style ${style.name}`} testId={testId ?? `dimension-${style.id}`} viewBox={viewBox}>
      <g stroke="currentColor" strokeWidth={scale} fill="none" strokeLinecap="round">
        {[...geometry.extensionSegments, ...geometry.dimensionSegments].map((segment, index) => (
          <line
            key={index}
            x1={segment.from.x}
            y1={segment.from.y}
            x2={segment.to.x}
            y2={segment.to.y}
          />
        ))}
      </g>
      {geometry.arrowTransforms.map((arrow, index) => (
        <polygon
          key={index}
          points={`${arrow.x},${arrow.y} ${arrow.x - arrow.size},${arrow.y - arrow.size * 0.35} ${arrow.x - arrow.size},${arrow.y + arrow.size * 0.35}`}
          transform={`rotate(${arrow.rotationDeg} ${arrow.x} ${arrow.y})`}
          fill="currentColor"
        />
      ))}
      <text
        x={geometry.textPosition.x}
        y={geometry.textPosition.y}
        fontSize={2.5}
        textAnchor="middle"
        fill="currentColor"
        transform={`rotate(${geometry.textRotationDeg} ${geometry.textPosition.x} ${geometry.textPosition.y})`}
      >
        {geometry.formattedText}
      </text>
    </PreviewFrame>
  );
};

/** Leader style preview: arrow, landing, gap, text stub. */
export const LeaderStylePreview: React.FC<{ style: CadLeaderStyle; testId?: string }> = ({ style, testId }) => {
  const landing = Math.max(2, Math.min(40, style.landingLength));
  const gap = Math.max(0, Math.min(10, style.textGap));
  const arrow = Math.max(1, Math.min(10, style.arrowSize));
  const tipX = 4;
  const tipY = 34;
  const elbowX = 34;
  const elbowY = 10;
  const landingX = elbowX + landing;
  return (
    <PreviewFrame ariaLabel={`Leader style ${style.name}`} testId={testId ?? `leader-${style.id}`} viewBox="0 0 96 44">
      <g stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round">
        <polyline points={`${tipX},${tipY} ${elbowX},${elbowY} ${landingX.toFixed(2)},${elbowY}`} />
      </g>
      <polygon
        points={`${tipX},${tipY} ${tipX + arrow},${tipY - arrow * 0.35} ${tipX + arrow},${tipY + arrow * 0.35}`}
        fill="currentColor"
        transform={`rotate(-40 ${tipX} ${tipY})`}
      />
      <text x={landingX + gap} y={elbowY + 3} fontSize="7" fill="currentColor">
        Note
      </text>
    </PreviewFrame>
  );
};

export const BearingLabelStylePreview: React.FC<{ style: CadBearingLabelStyle; testId?: string }> = ({ style, testId }) => {
  const rows = bearingPreviewRows(style);
  return (
    <PreviewFrame ariaLabel={`Bearing label style ${style.name}`} testId={testId ?? `bearing-${style.id}`} height={44} viewBox="0 0 96 44">
      {rows.map((row, index) => (
        <text key={index} x="4" y={16 + index * 12} fontSize="9" fill="currentColor">
          {row}
        </text>
      ))}
      <line x1="2" y1="40" x2="94" y2="40" stroke="currentColor" strokeWidth="0.5" strokeDasharray="3 2" />
    </PreviewFrame>
  );
};

export const CurveLabelStylePreview: React.FC<{ style: CadCurveLabelStyle; testId?: string }> = ({ style, testId }) => {
  const sample: Record<string, string> = {
    radius: `R ${(120).toFixed(style.decimalPrecision)}`,
    delta: `Δ ${(43).toFixed(Math.min(style.decimalPrecision, 4))}°`,
    length: `L ${(90).toFixed(style.decimalPrecision)}`,
    chord: `C ${(88).toFixed(style.decimalPrecision)}`,
  };
  const rows = style.fields.map((field) => sample[field] ?? field);
  return (
    <PreviewFrame ariaLabel={`Curve label style ${style.name}`} testId={testId ?? `curve-${style.id}`} height={44} viewBox="0 0 96 44">
      {rows.map((row, index) => (
        <text key={index} x="4" y={16 + index * 11} fontSize="9" fill="currentColor">
          {row}
        </text>
      ))}
      <path d="M2 40 A 20 20 0 0 1 42 40" fill="none" stroke="currentColor" strokeWidth="0.75" />
    </PreviewFrame>
  );
};

const bearingPreviewRows = (style: CadBearingLabelStyle): string[] => {
  const bearing = `N ${(45).toFixed(Math.min(style.decimalPrecision, 4))}° E`;
  const distance = `${(120.5).toFixed(style.decimalPrecision)} m`;
  const pair: Record<CadBearingLabelStyle['content'], string[]> = {
    bearing: [bearing],
    distance: [distance],
    'bearing-distance': [bearing, distance],
    'distance-bearing': [distance, bearing],
  };
  const items = pair[style.content] ?? [bearing];
  return style.separator === 'space' ? [items.join('  ')] : items;
};
