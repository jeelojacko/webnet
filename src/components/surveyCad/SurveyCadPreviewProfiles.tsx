import React from 'react';
import type { CadProfileViewDisplayLayer } from '../../engine/cad/cadProfileView';
import { toScreenD } from './SurveyCadPreviewSurface';
import type { ProjectPoint } from './SurveyCadPreview.types';

/**
 * Phase 18J — derived profile-view layers (one grid path + one aggregated
 * path per member profile + equation markers + bounded labels per view).
 * Never CAD entities; clicks select the VIEW object (entity selection is
 * untouched). OFF/FROZEN layers are dropped before this render.
 */
export const renderProfileViewLayers = ({
  layers,
  selectedViewId,
  project,
  pickActive,
  onProfileViewClick,
}: {
  layers: readonly CadProfileViewDisplayLayer[];
  selectedViewId: string | null;
  project: ProjectPoint;
  pickActive: boolean;
  onProfileViewClick: (_viewId: string) => void;
}): React.ReactNode => (
  <>
    {layers.map((layer) => {
      const selected = layer.viewId === selectedViewId;
      const stroke = selected ? '#fbbf24' : '#1f6feb';
      return (
        <g
          key={`profile-view:${layer.viewId}`}
          data-profile-view-layer={layer.viewId}
          data-profile-view-stale={layer.stale ? 'true' : undefined}
          className={pickActive ? 'cursor-crosshair' : 'cursor-pointer'}
          onClick={(event) => {
            event.stopPropagation();
            onProfileViewClick(layer.viewId);
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
          {layer.profilePaths.map((entry) => (
            <path
              key={`profile-view:${layer.viewId}:${entry.profileId}`}
              d={toScreenD(entry.d, project)}
              fill="none"
              stroke={stroke}
              strokeWidth={selected ? 2.4 : 1.6}
              data-profile-view-path={entry.profileId}
              pointerEvents="stroke"
            />
          ))}
          {layer.equationMarkers.map((marker, index) => {
            const top = project(marker.x, layer.bounds?.maxY ?? 0);
            const bottom = project(marker.x, layer.bounds?.minY ?? 0);
            return (
              <line
                key={`profile-view:${layer.viewId}:eq:${index + 1}`}
                x1={top.x}
                y1={top.y}
                x2={bottom.x}
                y2={bottom.y}
                stroke="#f59e0b"
                strokeWidth={1}
                strokeDasharray="4 3"
                pointerEvents="none"
              />
            );
          })}
          {layer.labels.map((label, index) => {
            const point = project(label.x, label.y);
            return (
              <text
                key={`profile-view:${layer.viewId}:l:${index + 1}`}
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
        </g>
      );
    })}
  </>
);
