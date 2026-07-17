import React from 'react';
import type { CadDisplayPrimitive } from '../../engine/cad/cadTypes';
import { arcPathFromPrimitive, textPrimitiveScreenBox } from './SurveyCadPreview.geometry';
import type { ProjectPoint } from './SurveyCadPreview.types';

type RenderPrimitiveOptions = {
  primitive: CadDisplayPrimitive;
  selectedEntityIds: readonly string[];
  entityOpacityOverrides: Readonly<Record<string, number>>;
  project: ProjectPoint;
  scale: number;
  onEntityClick: (
    _event: React.MouseEvent<SVGElement>,
    _entityId: string,
    _sourceSegmentId?: string,
    _appendToSelection?: boolean,
  ) => void;
  onEntityHover?: (
    _event: React.MouseEvent<SVGElement>,
    _primitive: CadDisplayPrimitive,
    _sourceSegmentId?: string,
  ) => void;
  onEntityLeave?: () => void;
  onPrimitiveClickIntercept?: (
    _entityId: string,
    _sourceSegmentId?: string,
  ) => boolean;
};

export const renderPrimitive = ({
  primitive,
  selectedEntityIds,
  entityOpacityOverrides,
  project,
  scale,
  onEntityClick,
  onEntityHover,
  onEntityLeave,
  onPrimitiveClickIntercept,
}: RenderPrimitiveOptions) => {
  const isSelected = selectedEntityIds.includes(primitive.sourceEntityId);
  const commonProps = {
    onClick: (event: React.MouseEvent<SVGElement>) => {
      if (onPrimitiveClickIntercept?.(primitive.sourceEntityId, primitive.sourceSegmentId)) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      onEntityClick(event, primitive.sourceEntityId, primitive.sourceSegmentId, event.shiftKey);
    },
    onMouseMove: (event: React.MouseEvent<SVGElement>) =>
      onEntityHover?.(event, primitive, primitive.sourceSegmentId),
    onMouseLeave: () => onEntityLeave?.(),
    className: 'cursor-pointer',
  };

  switch (primitive.kind) {
    case 'line': {
      const start = project(primitive.points[0].x, primitive.points[0].y);
      const end = project(primitive.points[1].x, primitive.points[1].y);
      return (
        <g key={primitive.id}>
          <line
            {...commonProps}
            data-survey-cad-hit-target="true"
            data-survey-cad-entity-id={primitive.sourceEntityId}
            data-survey-cad-segment-id={primitive.sourceSegmentId}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke="transparent"
            strokeWidth={Math.max(16, primitive.strokeWidth + 14)}
            strokeOpacity={0.001}
            pointerEvents="stroke"
          />
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            {...commonProps}
            data-survey-cad-render-entity-id={primitive.sourceEntityId}
            stroke={isSelected ? '#fbbf24' : primitive.stroke}
            strokeWidth={isSelected ? primitive.strokeWidth + 1.1 : primitive.strokeWidth}
            opacity={entityOpacityOverrides[primitive.sourceEntityId] ?? primitive.opacity ?? 0.92}
            strokeDasharray={primitive.strokeDasharray}
            pointerEvents="stroke"
          />
        </g>
      );
    }
    case 'arc': {
      const path = arcPathFromPrimitive(primitive, project, scale);
      return (
        <g key={primitive.id}>
          <path
            {...commonProps}
            data-survey-cad-hit-target="true"
            data-survey-cad-entity-id={primitive.sourceEntityId}
            data-survey-cad-segment-id={primitive.sourceSegmentId}
            d={path}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, primitive.strokeWidth + 14)}
            strokeOpacity={0.001}
            pointerEvents="stroke"
          />
          <path
            d={path}
            fill="none"
            {...commonProps}
            data-survey-cad-render-entity-id={primitive.sourceEntityId}
            stroke={isSelected ? '#fbbf24' : primitive.stroke}
            strokeWidth={isSelected ? primitive.strokeWidth + 1.1 : primitive.strokeWidth}
            opacity={entityOpacityOverrides[primitive.sourceEntityId] ?? primitive.opacity ?? 0.92}
            strokeDasharray={primitive.strokeDasharray}
            pointerEvents="stroke"
          />
        </g>
      );
    }
    case 'point': {
      const point = project(primitive.point.x, primitive.point.y);
      return (
        <g key={primitive.id}>
          <circle
            {...commonProps}
            data-survey-cad-hit-target="true"
            data-survey-cad-entity-id={primitive.sourceEntityId}
            cx={point.x}
            cy={point.y}
            r={Math.max(10, primitive.radius + 7)}
            fill="transparent"
            fillOpacity={0.001}
            pointerEvents="fill"
          />
          <circle
            cx={point.x}
            cy={point.y}
            r={isSelected ? primitive.radius + 1.8 : primitive.radius}
            {...commonProps}
            data-survey-cad-render-entity-id={primitive.sourceEntityId}
            fill={isSelected ? '#fbbf24' : primitive.fill ?? primitive.stroke}
            stroke={isSelected ? '#fef3c7' : '#0f172a'}
            strokeWidth={1.2}
            opacity={entityOpacityOverrides[primitive.sourceEntityId] ?? primitive.opacity ?? 1}
            pointerEvents="all"
          />
        </g>
      );
    }
    case 'text': {
      const textBox = textPrimitiveScreenBox(primitive, project);
      const displayX = textBox.displayX;
      const displayY = textBox.displayY;
      const textTransform =
        primitive.rotationDeg != null
          ? `rotate(${primitive.rotationDeg} ${displayX} ${displayY})`
          : undefined;
      return (
        <g key={primitive.id}>
          <rect
            {...commonProps}
            data-survey-cad-hit-target="true"
            data-survey-cad-entity-id={primitive.sourceEntityId}
            x={textBox.x - 4}
            y={textBox.y - 3}
            width={textBox.width + 8}
            height={textBox.height + 6}
            fill="transparent"
            fillOpacity={0.001}
            transform={textTransform}
            pointerEvents="fill"
          />
          <text
            {...commonProps}
            data-survey-cad-render-entity-id={primitive.sourceEntityId}
            x={displayX}
            y={displayY}
            fill={isSelected ? '#fbbf24' : primitive.stroke}
            fontSize={primitive.fontSize}
            opacity={entityOpacityOverrides[primitive.sourceEntityId] ?? primitive.opacity ?? 1}
            textAnchor={primitive.textAnchor ?? 'start'}
            transform={textTransform}
          >
            {primitive.text.split('\n').map((line, index) => (
              <tspan
                key={`${primitive.id}:${index + 1}`}
                x={displayX}
                dy={index === 0 ? 0 : primitive.fontSize * 1.15}
              >
                {line}
              </tspan>
            ))}
          </text>
        </g>
      );
    }
    case 'ellipse': {
      const center = project(primitive.center.x, primitive.center.y);
      return (
        <g key={primitive.id}>
          <ellipse
            {...commonProps}
            cx={center.x}
            cy={center.y}
            rx={Math.max(primitive.semiMajor * scale, 1.2)}
            ry={Math.max(primitive.semiMinor * scale, 0.9)}
            transform={`rotate(${-primitive.thetaDeg} ${center.x} ${center.y})`}
            fill="none"
            stroke="transparent"
            strokeWidth={Math.max(16, primitive.strokeWidth + 14)}
            opacity={0}
          />
          <ellipse
            cx={center.x}
            cy={center.y}
            rx={Math.max(primitive.semiMajor * scale, 1.2)}
            ry={Math.max(primitive.semiMinor * scale, 0.9)}
            transform={`rotate(${-primitive.thetaDeg} ${center.x} ${center.y})`}
            fill="none"
            {...commonProps}
            data-survey-cad-render-entity-id={primitive.sourceEntityId}
            stroke={isSelected ? '#fbbf24' : primitive.stroke}
            strokeWidth={isSelected ? primitive.strokeWidth + 0.8 : primitive.strokeWidth}
            opacity={entityOpacityOverrides[primitive.sourceEntityId] ?? primitive.opacity ?? 0.88}
            strokeDasharray={primitive.strokeDasharray}
            pointerEvents="stroke"
          />
        </g>
      );
    }
  }
};
