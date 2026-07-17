import React from 'react';
import type {
  CadDisplayPrimitive,
  CadGripHandle,
  CadSnapCandidate,
} from '../../engine/cad/cadTypes';
import { arcPathFromPrimitive } from './SurveyCadPreview.geometry';
import type { ProjectPoint, ScreenBox } from './SurveyCadPreview.types';

type PreviewAccent = { stroke: string; fill: string; text: string } | null;

export const TransientPreviewLayer: React.FC<{
  primitives: readonly CadDisplayPrimitive[];
  project: ProjectPoint;
  scale: number;
}> = ({ primitives, project, scale }) =>
  primitives.length > 0 ? (
    <g data-survey-cad-command-preview>
      {primitives.map((primitive) =>
        primitive.kind === 'line' ? (
          <line
            key={primitive.id}
            data-survey-cad-command-preview-line
            x1={project(primitive.points[0].x, primitive.points[0].y).x}
            y1={project(primitive.points[0].x, primitive.points[0].y).y}
            x2={project(primitive.points[1].x, primitive.points[1].y).x}
            y2={project(primitive.points[1].x, primitive.points[1].y).y}
            stroke={primitive.stroke}
            strokeWidth={primitive.strokeWidth}
            opacity={primitive.opacity ?? 0.85}
            strokeDasharray={primitive.strokeDasharray ?? '8 6'}
            pointerEvents="none"
          />
        ) : primitive.kind === 'point' ? (
          <circle
            key={primitive.id}
            data-survey-cad-command-preview-point
            cx={project(primitive.point.x, primitive.point.y).x}
            cy={project(primitive.point.x, primitive.point.y).y}
            r={primitive.radius}
            fill={primitive.fill ?? primitive.stroke}
            opacity={primitive.opacity ?? 0.85}
            pointerEvents="none"
          />
        ) : primitive.kind === 'text' ? (
          <text
            key={primitive.id}
            x={project(primitive.point.x, primitive.point.y).x + 6}
            y={project(primitive.point.x, primitive.point.y).y - 6}
            fill={primitive.stroke}
            fontSize={primitive.fontSize}
            opacity={primitive.opacity ?? 0.85}
            pointerEvents="none"
          >
            {primitive.text}
          </text>
        ) : primitive.kind === 'arc' ? (
          <path
            key={primitive.id}
            data-survey-cad-command-preview-arc
            d={arcPathFromPrimitive(primitive, project, scale)}
            fill="none"
            stroke={primitive.stroke}
            strokeWidth={primitive.strokeWidth}
            opacity={primitive.opacity ?? 0.85}
            strokeDasharray={primitive.strokeDasharray ?? '8 6'}
            pointerEvents="none"
          />
        ) : (
          <ellipse
            key={primitive.id}
            cx={project(primitive.center.x, primitive.center.y).x}
            cy={project(primitive.center.x, primitive.center.y).y}
            rx={Math.max(primitive.semiMajor * scale, 1.2)}
            ry={Math.max(primitive.semiMinor * scale, 0.9)}
            transform={`rotate(${-primitive.thetaDeg} ${project(primitive.center.x, primitive.center.y).x} ${project(primitive.center.x, primitive.center.y).y})`}
            fill="none"
            stroke={primitive.stroke}
            strokeWidth={primitive.strokeWidth}
            opacity={primitive.opacity ?? 0.85}
            strokeDasharray={primitive.strokeDasharray ?? '8 6'}
            pointerEvents="none"
          />
        ),
      )}
    </g>
  ) : null;

export const GripHandleLayer: React.FC<{
  gripHandles: readonly CadGripHandle[];
  activeGripHandleId: string | null;
  project: ProjectPoint;
  onStartGrip: (_event: React.MouseEvent<SVGCircleElement>, _handle: CadGripHandle) => void;
}> = ({ gripHandles, activeGripHandleId, project, onStartGrip }) =>
  gripHandles.length > 0 ? (
    <g data-survey-cad-grip-handles>
      {gripHandles.map((handle) => {
        const point = project(handle.x, handle.y);
        const isActive = activeGripHandleId === handle.id;
        return (
          <circle
            key={handle.id}
            data-survey-cad-grip-handle={handle.kind}
            data-survey-cad-grip-handle-id={handle.id}
            data-survey-cad-grip-entity-id={handle.entityId}
            cx={point.x}
            cy={point.y}
            r={isActive ? 7.2 : 5.8}
            fill={isActive ? '#22d3ee' : '#f8fafc'}
            stroke={isActive ? '#67e8f9' : '#0f172a'}
            strokeWidth={1.4}
            className="cursor-move"
            onMouseDown={(event) => onStartGrip(event, handle)}
          />
        );
      })}
    </g>
  ) : null;

export const SnapGuideLayer: React.FC<{
  activeSnap: CadSnapCandidate | null;
  activeSnapAccent: PreviewAccent;
  project: ProjectPoint;
}> = ({ activeSnap, activeSnapAccent, project }) => (
  <>
    {activeSnap?.guideSegments?.length ? (
      <g data-survey-cad-snap-guides>
        {activeSnap.guideSegments.map((segment, index) => (
          <line
            key={`${activeSnap.id}:guide:${index + 1}`}
            data-survey-cad-snap-guide
            x1={project(segment[0].x, segment[0].y).x}
            y1={project(segment[0].x, segment[0].y).y}
            x2={project(segment[1].x, segment[1].y).x}
            y2={project(segment[1].x, segment[1].y).y}
            stroke={activeSnapAccent?.stroke ?? '#fbbf24'}
            strokeWidth={1.2}
            opacity={0.8}
            strokeDasharray="7 5"
            pointerEvents="none"
          />
        ))}
      </g>
    ) : null}
    {activeSnap ? (
      <g data-survey-cad-snap-glyph pointerEvents="none">
        <circle
          cx={project(activeSnap.x, activeSnap.y).x}
          cy={project(activeSnap.x, activeSnap.y).y}
          r={6}
          fill="none"
          stroke={activeSnapAccent?.stroke ?? '#fbbf24'}
          strokeWidth={1.2}
        />
        <line
          x1={project(activeSnap.x, activeSnap.y).x - 8}
          y1={project(activeSnap.x, activeSnap.y).y}
          x2={project(activeSnap.x, activeSnap.y).x + 8}
          y2={project(activeSnap.x, activeSnap.y).y}
          stroke={activeSnapAccent?.text ?? '#fef3c7'}
          strokeWidth={1}
        />
        <line
          x1={project(activeSnap.x, activeSnap.y).x}
          y1={project(activeSnap.x, activeSnap.y).y - 8}
          x2={project(activeSnap.x, activeSnap.y).x}
          y2={project(activeSnap.x, activeSnap.y).y + 8}
          stroke={activeSnapAccent?.text ?? '#fef3c7'}
          strokeWidth={1}
        />
      </g>
    ) : null}
  </>
);

export const SelectionBoxLayer: React.FC<{ selectionBox: ScreenBox | null }> = ({ selectionBox }) =>
  selectionBox ? (
    <rect
      data-survey-cad-selection-box
      x={Math.min(selectionBox.anchorX, selectionBox.currentX)}
      y={Math.min(selectionBox.anchorY, selectionBox.currentY)}
      width={Math.abs(selectionBox.currentX - selectionBox.anchorX)}
      height={Math.abs(selectionBox.currentY - selectionBox.anchorY)}
      fill={selectionBox.currentX >= selectionBox.anchorX ? 'rgba(34,197,94,0.12)' : 'rgba(251,191,36,0.12)'}
      stroke={selectionBox.currentX >= selectionBox.anchorX ? '#22c55e' : '#fbbf24'}
      strokeDasharray="6 4"
      strokeWidth={1.2}
    />
  ) : null;
