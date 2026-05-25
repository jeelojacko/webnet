import React, { useMemo } from 'react';
import type { CadBounds, CadDisplayPrimitive, CadDisplayScene } from '../../engine/cad/cadTypes';

interface SurveyCadPreviewProps {
  scene: CadDisplayScene;
  selectedEntityId: string | null;
  onSelectEntity: (_entityId: string) => void;
}

const WIDTH = 900;
const HEIGHT = 520;
const PADDING = 36;

const normalizeBounds = (bounds: CadBounds | null): CadBounds => {
  if (!bounds) {
    return { minX: -10, minY: -10, maxX: 10, maxY: 10 };
  }
  const width = Math.max(bounds.maxX - bounds.minX, 1);
  const height = Math.max(bounds.maxY - bounds.minY, 1);
  return {
    minX: bounds.minX - width * 0.08,
    minY: bounds.minY - height * 0.08,
    maxX: bounds.maxX + width * 0.08,
    maxY: bounds.maxY + height * 0.08,
  };
};

const useProjector = (bounds: CadBounds | null) =>
  useMemo(() => {
    const normalized = normalizeBounds(bounds);
    const width = normalized.maxX - normalized.minX;
    const height = normalized.maxY - normalized.minY;
    const scale = Math.min((WIDTH - PADDING * 2) / width, (HEIGHT - PADDING * 2) / height);
    return {
      scale,
      project: (x: number, y: number) => ({
        x: PADDING + (x - normalized.minX) * scale,
        y: HEIGHT - PADDING - (y - normalized.minY) * scale,
      }),
    };
  }, [bounds]);

const renderPrimitive = (
  primitive: CadDisplayPrimitive,
  selectedEntityId: string | null,
  project: (_x: number, _y: number) => { x: number; y: number },
  scale: number,
  onSelectEntity: (_entityId: string) => void,
) => {
  const isSelected = primitive.sourceEntityId === selectedEntityId;
  const commonProps = {
    onClick: () => onSelectEntity(primitive.sourceEntityId),
    className: 'cursor-pointer',
  };

  switch (primitive.kind) {
    case 'line': {
      const start = project(primitive.points[0].x, primitive.points[0].y);
      const end = project(primitive.points[1].x, primitive.points[1].y);
      return (
        <line
          key={primitive.id}
          {...commonProps}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={isSelected ? '#fbbf24' : primitive.stroke}
          strokeWidth={isSelected ? primitive.strokeWidth + 1.1 : primitive.strokeWidth}
          opacity={0.92}
        />
      );
    }
    case 'point': {
      const point = project(primitive.point.x, primitive.point.y);
      return (
        <circle
          key={primitive.id}
          {...commonProps}
          cx={point.x}
          cy={point.y}
          r={isSelected ? primitive.radius + 1.8 : primitive.radius}
          fill={isSelected ? '#fbbf24' : primitive.fill ?? primitive.stroke}
          stroke={isSelected ? '#fef3c7' : '#0f172a'}
          strokeWidth={1.2}
        />
      );
    }
    case 'text': {
      const point = project(primitive.point.x, primitive.point.y);
      return (
        <text
          key={primitive.id}
          {...commonProps}
          x={point.x + 6}
          y={point.y - 6}
          fill={isSelected ? '#fbbf24' : primitive.stroke}
          fontSize={primitive.fontSize}
        >
          {primitive.text}
        </text>
      );
    }
    case 'ellipse': {
      const center = project(primitive.center.x, primitive.center.y);
      return (
        <ellipse
          key={primitive.id}
          {...commonProps}
          cx={center.x}
          cy={center.y}
          rx={Math.max(primitive.semiMajor * scale, 1.2)}
          ry={Math.max(primitive.semiMinor * scale, 0.9)}
          transform={`rotate(${-primitive.thetaDeg} ${center.x} ${center.y})`}
          fill="none"
          stroke={isSelected ? '#fbbf24' : primitive.stroke}
          strokeWidth={isSelected ? primitive.strokeWidth + 0.8 : primitive.strokeWidth}
          opacity={0.88}
        />
      );
    }
  }
};

const SurveyCadPreview: React.FC<SurveyCadPreviewProps> = ({
  scene,
  selectedEntityId,
  onSelectEntity,
}) => {
  const { project, scale } = useProjector(scene.bounds);

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-full w-full rounded-lg border border-slate-800 bg-slate-950"
      data-survey-cad-preview
    >
      <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="#020617" />
      <g>
        {scene.primitives.map((primitive) =>
          renderPrimitive(primitive, selectedEntityId, project, scale, onSelectEntity),
        )}
      </g>
    </svg>
  );
};

export default SurveyCadPreview;
