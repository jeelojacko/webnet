import React from 'react';
import type {
  CadSampleLineDisplayLayer,
  CadSectionViewDisplayLayer,
} from '../../engine/cad/cadSectionView';
import { toScreenD } from './SurveyCadPreviewSurface';
import type { ProjectPoint } from './SurveyCadPreview.types';

/**
 * Phase 18K — derived sample-line plan layers + section-view layers.
 * Aggregated paths per group/view (never CAD entities). Clicking a plan
 * line selects the SAMPLE LINE resource; clicking a view selects the VIEW
 * object (entity selection untouched). OFF/FROZEN layers are dropped before
 * this render. Cut/fill shading renders as translucent derived polygons.
 */
export const renderSampleLineLayers = ({
  layers,
  selectedLineId,
  project,
  pickActive,
  onSampleLineClick,
}: {
  layers: readonly CadSampleLineDisplayLayer[];
  selectedLineId: string | null;
  project: ProjectPoint;
  pickActive: boolean;
  onSampleLineClick: (_groupId: string, _lineId: string) => void;
}): React.ReactNode => (
  <>
    {layers.map((layer) => (
      <g key={`sample-group:${layer.groupId}`} data-sample-group-layer={layer.groupId}>
        {layer.lines.map((line) => {
          if (!line.d) return null;
          const selected = line.lineId === selectedLineId;
          const labelPoint = project(line.labelX, line.labelY);
          return (
            <g key={`sample-line:${line.lineId}`}>
              <path
                d={toScreenD(line.d, project)}
                fill="none"
                stroke={selected ? '#fbbf24' : '#22d3ee'}
                strokeWidth={selected ? 2.4 : 1.4}
                data-sample-line={line.lineId}
                className={pickActive ? 'cursor-crosshair' : 'cursor-pointer'}
                onClick={(event) => {
                  event.stopPropagation();
                  onSampleLineClick(layer.groupId, line.lineId);
                }}
                pointerEvents="stroke"
              />
              {line.tickD ? (
                <path
                  d={toScreenD(line.tickD, project)}
                  fill="none"
                  stroke={selected ? '#fbbf24' : '#22d3ee'}
                  strokeWidth={1}
                  pointerEvents="none"
                />
              ) : null}
              {line.labelShown ? (
                <text
                  x={labelPoint.x}
                  y={labelPoint.y}
                  fill="#a5f3fc"
                  fontSize={10}
                  textAnchor="middle"
                  pointerEvents="none"
                >
                  {line.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>
    ))}
  </>
);

export const renderSectionViewLayers = ({
  layers,
  selectedViewId,
  project,
  pickActive,
  onSectionViewClick,
}: {
  layers: readonly CadSectionViewDisplayLayer[];
  selectedViewId: string | null;
  project: ProjectPoint;
  pickActive: boolean;
  onSectionViewClick: (_viewId: string) => void;
}): React.ReactNode => (
  <>
    {layers.map((layer) => {
      const selected = layer.viewId === selectedViewId;
      const stroke = selected ? '#fbbf24' : '#a78bfa';
      return (
        <g
          key={`section-view:${layer.viewId}`}
          data-section-view-layer={layer.viewId}
          data-section-view-stale={layer.stale ? 'true' : undefined}
          className={pickActive ? 'cursor-crosshair' : 'cursor-pointer'}
          onClick={(event) => {
            event.stopPropagation();
            onSectionViewClick(layer.viewId);
          }}
        >
          {layer.gridD ? (
            <path
              d={toScreenD(layer.gridD, project)}
              fill="none"
              stroke={stroke}
              strokeWidth={0.6}
              opacity={0.35}
              pointerEvents="none"
            />
          ) : null}
          {layer.fillD ? (
            <path
              d={toScreenD(layer.fillD, project)}
              fill="#22c55e"
              opacity={0.25}
              stroke="none"
              pointerEvents="none"
            />
          ) : null}
          {layer.cutD ? (
            <path
              d={toScreenD(layer.cutD, project)}
              fill="#ef4444"
              opacity={0.25}
              stroke="none"
              pointerEvents="none"
            />
          ) : null}
          {layer.centerlineD ? (
            <path
              d={toScreenD(layer.centerlineD, project)}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1}
              strokeDasharray="6 3"
              pointerEvents="none"
            />
          ) : null}
          {layer.tracePaths.map((entry) => (
            <path
              key={`section-view:${layer.viewId}:${entry.surfaceId}`}
              d={toScreenD(entry.d, project)}
              fill="none"
              stroke={selected ? '#fbbf24' : entry.color}
              strokeWidth={selected ? 2.4 : 1.6}
              data-section-view-path={entry.surfaceId}
              pointerEvents="stroke"
            />
          ))}
          {layer.offsetTicks.map((tick, index) => {
            const point = project(tick.x, tick.y);
            return (
              <text
                key={`section-view:${layer.viewId}:ot:${index + 1}`}
                x={point.x}
                y={point.y}
                fill="#cbd5e1"
                fontSize={10}
                textAnchor="middle"
                pointerEvents="none"
              >
                {tick.text}
              </text>
            );
          })}
          {layer.elevationLabels.map((label, index) => {
            const point = project(label.x, label.y);
            return (
              <text
                key={`section-view:${layer.viewId}:el:${index + 1}`}
                x={point.x}
                y={point.y}
                fill="#cbd5e1"
                fontSize={10}
                textAnchor="middle"
                pointerEvents="none"
              >
                {label.text}
              </text>
            );
          })}
          {layer.legend.length > 0 && layer.bounds ? (
            <g pointerEvents="none">
              {layer.legend.map((entry, index) => {
                const point = project(layer.bounds!.minX, layer.bounds!.maxY - index * 14);
                return (
                  <text
                    key={`section-view:${layer.viewId}:legend:${index + 1}`}
                    x={point.x}
                    y={point.y}
                    fill={entry.color}
                    fontSize={10}
                    textAnchor="start"
                  >
                    {entry.surfaceName}
                  </text>
                );
              })}
            </g>
          ) : null}
        </g>
      );
    })}
  </>
);
