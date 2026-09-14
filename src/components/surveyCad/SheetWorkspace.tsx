import React, { useMemo, useState } from 'react';
import { buildCadDisplayScene } from '../../engine/cad/cadRenderer';
import {
  asPlanViewport,
  expandSheetTokens,
  modelToPaperMm,
  northArrowAngleDeg,
  NORTH_REFERENCE,
  type TitleBlockInstance,
} from '../../engine/cad/cadSheets';
import type { DraftDocument } from '../../engine/cad/cadDraftTypes';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { CadDisplayPrimitive } from '../../engine/cad/cadDisplayTypes';

type WorkspaceView = 'MODEL' | 'SHEET';

// Display zoom: screen px per paper mm.
const PX_PER_MM = 2.5;

// Sheet view renders model content north-up to match SVG/PDF export: the
// viewport group mirrors model-y (scale(k,-k)) and text is counter-mirrored
// about its anchor so glyphs stay readable. MODEL view stays raw coordinates.
const primitiveToSvg = (primitive: CadDisplayPrimitive, key: string, mirrorText = false): React.ReactNode => {
  switch (primitive.kind) {
    case 'line':
      return (
        <polyline
          key={key}
          points={primitive.points.map((point) => `${point.x},${point.y}`).join(' ')}
          fill="none"
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
        />
      );
    case 'point':
      return <circle key={key} cx={primitive.point.x} cy={primitive.point.y} r={primitive.radius} fill={primitive.stroke} />;
    case 'text': {
      const mirror = mirrorText
        ? `translate(${primitive.point.x} ${primitive.point.y}) scale(1 -1) translate(${-primitive.point.x} ${-primitive.point.y})`
        : undefined;
      return (
        <text key={key} x={primitive.point.x} y={primitive.point.y} fontSize={primitive.fontSize} fill={primitive.stroke} transform={mirror}>
          {primitive.text}
        </text>
      );
    }
    case 'ellipse':
      // Negated angle: the sheet viewport group mirrors model-y, and
      // mirror·rotate(−θ) = rotate(+θ)·mirror, matching export orientation.
      return (
        <ellipse
          key={key}
          cx={primitive.center.x}
          cy={primitive.center.y}
          rx={primitive.semiMajor}
          ry={primitive.semiMinor}
          transform={`rotate(${-primitive.thetaDeg} ${primitive.center.x} ${primitive.center.y})`}
          fill="none"
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
        />
      );
    case 'arc': {
      const { center, radius, startAngleDeg, endAngleDeg } = primitive;
      const toRad = (deg: number): number => (deg * Math.PI) / 180;
      // Raw model coords; the sheet viewport group applies the north-up
      // mirror. (A baked y-flip here double-mirrored arcs vs lines.)
      const start = { x: center.x + radius * Math.cos(toRad(startAngleDeg)), y: center.y + radius * Math.sin(toRad(startAngleDeg)) };
      const end = { x: center.x + radius * Math.cos(toRad(endAngleDeg)), y: center.y + radius * Math.sin(toRad(endAngleDeg)) };
      const sweep = endAngleDeg - startAngleDeg > 180 ? 1 : 0;
      return (
        <path
          key={key}
          d={`M ${start.x} ${start.y} A ${radius} ${radius} 0 ${sweep} 0 ${end.x} ${end.y}`}
          fill="none"
          stroke={primitive.stroke}
          strokeWidth={primitive.strokeWidth}
        />
      );
    }
    default:
      return null;
  }
};

export interface SheetWorkspaceProps {
  project: CadProject;
  draft: DraftDocument;
  activeSheetId?: string;
  titleBlocks?: TitleBlockInstance[];
  projectName?: string;
  crsLabel?: string;
}

export const SheetWorkspace = ({
  project,
  draft,
  activeSheetId,
  titleBlocks = [],
  projectName = 'Survey Plan',
  crsLabel = '',
}: SheetWorkspaceProps): React.JSX.Element => {
  const [view, setView] = useState<WorkspaceView>('MODEL');
  const [sheetId, setSheetId] = useState<string | undefined>(activeSheetId ?? draft.sheets[0]?.id);
  const scene = useMemo(() => buildCadDisplayScene(project), [project]);
  const sheet = draft.sheets.find((entry) => entry.id === sheetId) ?? draft.sheets[0];

  const titlePreview = useMemo(() => {
    if (!sheet) return null;
    const instance = titleBlocks.find((entry) => entry.sheetId === sheet.id);
    const template = Object.entries(instance?.values ?? {})
      .map(([field, value]) => `${field}: ${value}`)
      .join('  |  ');
    const sheetIndex = draft.sheets.findIndex((entry) => entry.id === sheet.id);
    const { text, unknownTokens } = expandSheetTokens(template, {
      PROJECT_NAME: projectName,
      SHEET_NAME: sheet.name,
      SHEET_NUMBER: `${sheetIndex + 1}`,
      SCALE: sheet.viewports.map((viewport) => `1:${viewport.scaleDenominator}`).join(', '),
      CRS: crsLabel,
      DATE: new Date().toISOString().slice(0, 10),
    });
    return { text, unknownTokens };
  }, [sheet, titleBlocks, draft.sheets, projectName, crsLabel]);

  if (view === 'MODEL' || !sheet) {
    return (
      <section aria-label="Draft workspace">
        <div role="tablist" aria-label="Workspace view">
          <button type="button" role="tab" aria-selected={view === 'MODEL'} onClick={() => setView('MODEL')}>Model</button>
          <button type="button" role="tab" aria-selected={view === 'SHEET'} onClick={() => setView('SHEET')} disabled={draft.sheets.length === 0}>
            Sheet
          </button>
        </div>
        <svg role="img" aria-label="Model space preview" width={640} height={420}>
          {scene.primitives.map((primitive, index) => primitiveToSvg(primitive, `${primitive.id}-${index}`))}
        </svg>
      </section>
    );
  }

  const pageWidthPx = sheet.widthMm * PX_PER_MM;
  const pageHeightPx = sheet.heightMm * PX_PER_MM;
  const sheetIndex = draft.sheets.findIndex((entry) => entry.id === sheet.id);

  return (
    <section aria-label="Draft workspace">
      <div role="tablist" aria-label="Workspace view">
        <button type="button" role="tab" aria-selected={false} onClick={() => setView('MODEL')}>Model</button>
        <button type="button" role="tab" aria-selected onClick={() => setView('SHEET')}>Sheet</button>
        <label>
          Sheet
          <select aria-label="Active sheet" value={sheet.id} onChange={(event) => setSheetId(event.target.value)}>
            {draft.sheets.map((entry, index) => (
              <option key={entry.id} value={entry.id}>{`${index + 1}: ${entry.name}`}</option>
            ))}
          </select>
        </label>
      </div>
      <svg role="img" aria-label={`Sheet ${sheetIndex + 1}: ${sheet.name}`} width={pageWidthPx} height={pageHeightPx} viewBox={`0 0 ${sheet.widthMm} ${sheet.heightMm}`}>
        <rect x={0} y={0} width={sheet.widthMm} height={sheet.heightMm} fill="#ffffff" stroke="#111111" />
        <rect
          x={sheet.margins.leftMm}
          y={sheet.margins.topMm}
          width={sheet.widthMm - sheet.margins.leftMm - sheet.margins.rightMm}
          height={sheet.heightMm - sheet.margins.topMm - sheet.margins.bottomMm}
          fill="none"
          stroke="#888888"
          strokeDasharray="2 1"
        />
        {sheet.viewports.map((raw) => {
          const viewport = asPlanViewport(raw);
          const clipId = `clip-${viewport.id}`;
          const k = 1000 / viewport.scaleDenominator;
          const paperCx = viewport.paperXmm + viewport.paperWidthMm / 2;
          const paperCy = viewport.paperYmm + viewport.paperHeightMm / 2;
          const clip = viewport.clipWidthMm && viewport.clipHeightMm
            ? { x: viewport.clipXmm ?? viewport.paperXmm, y: viewport.clipYmm ?? viewport.paperYmm, w: viewport.clipWidthMm, h: viewport.clipHeightMm }
            : { x: viewport.paperXmm, y: viewport.paperYmm, w: viewport.paperWidthMm, h: viewport.paperHeightMm };
          const northAngle = northArrowAngleDeg(viewport.rotationDeg);
          const barLen = modelToPaperMm(10, viewport.scaleDenominator);
          return (
            <g key={viewport.id}>
              <clipPath id={clipId}>
                <rect x={clip.x} y={clip.y} width={clip.w} height={clip.h} />
              </clipPath>
              <rect x={viewport.paperXmm} y={viewport.paperYmm} width={viewport.paperWidthMm} height={viewport.paperHeightMm} fill="none" stroke="#111111" />
              <g clipPath={`url(#${clipId})`}>
                <g transform={`translate(${paperCx} ${paperCy}) rotate(${viewport.rotationDeg}) scale(${k} ${-k}) translate(${-viewport.modelCenterX} ${-viewport.modelCenterY})`}>
                  {scene.primitives.map((primitive, index) => primitiveToSvg(primitive, `${viewport.id}-${primitive.id}-${index}`, true))}
                </g>
              </g>
              <g transform={`translate(${viewport.paperXmm + 8} ${viewport.paperYmm + 12}) rotate(${northAngle} 0 6)`} aria-label={`Grid north arrow (${NORTH_REFERENCE} north, ${northAngle.toFixed(1)} degrees)`}>
                <polygon points="0,0 3,12 -3,12" fill="#111111" />
                <text y={18} fontSize={4} textAnchor="middle">N</text>
              </g>
              <g transform={`translate(${viewport.paperXmm} ${viewport.paperYmm + viewport.paperHeightMm - 6})`} aria-label={`Scale bar 1:${viewport.scaleDenominator}`}>
                <rect x={0} y={0} width={barLen} height={1.5} fill="#111111" />
                <text x={barLen + 2} y={1.5} fontSize={3}>10 m @ 1:{viewport.scaleDenominator}</text>
              </g>
            </g>
          );
        })}
        {sheet.sheetObjects
          .filter((object) => object.kind === 'plan-note')
          .map((object) => (
            <text key={object.id} x={object.paperXmm} y={object.paperYmm} fontSize={3.5}>
              {object.text}
            </text>
          ))}
        {titlePreview && titlePreview.text && (
          <g aria-label="Title block preview">
            <text x={sheet.margins.leftMm} y={sheet.heightMm - sheet.margins.bottomMm + 4} fontSize={3.5}>
              {titlePreview.text}
            </text>
            {titlePreview.unknownTokens.length > 0 && (
              <text x={sheet.margins.leftMm} y={sheet.heightMm - sheet.margins.bottomMm + 8} fontSize={2.5} fill="#aa0000">
                {`Unknown tokens kept literal: ${titlePreview.unknownTokens.join(', ')}`}
              </text>
            )}
          </g>
        )}
      </svg>
      <p>Draft plan — not a legal or certified survey document.</p>
    </section>
  );
};
