import React from 'react';
import type { CadSurfaceDisplayLayer } from '../../engine/cad/cadDisplayTypes';
import type { CadVolumeDisplayLayer } from '../../engine/cad/cadVolumeView';
import type {
  CadAnalysisDisplayLayer,
  AnalysisLegendGeometry,
} from '../../engine/cad/cadAnalysisDisplayView';
import type { ProjectPoint } from './SurveyCadPreview.types';

interface RenderSurfaceLayersOptions {
  layers: readonly CadSurfaceDisplayLayer[];
  selectedSurfaceId: string | null;
  project: ProjectPoint;
  scale: number;
  pickActive: boolean;
  onSurfaceClick: (_surfaceId: string) => void;
}

export const toScreenD = (
  d: string,
  project: ProjectPoint,
): string => {
  // Path data is `Mx yLx y...` in drawing units; project each coordinate.
  // Built with a single regex pass so large TINs stay one SVG node.
  return d.replace(/([ML])(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_match, cmd, xs, ys) => {
    const point = project(Number(xs), Number(ys));
    return `${cmd}${point.x} ${point.y}`;
  });
};

/**
 * Phase 18F — derived TIN layers. At most three SVG nodes per surface
 * (triangles path / boundary path / vertex group); triangle entities are
 * never created. Clicks map back to the surface object (never triangle
 * entities); CadEntity selection is untouched.
 */
export const renderSurfaceLayers = ({
  layers,
  selectedSurfaceId,
  project,
  scale,
  pickActive,
  onSurfaceClick,
}: RenderSurfaceLayersOptions): React.ReactNode => (
  <>
    {layers.map((layer) => {
      const selected = layer.surfaceId === selectedSurfaceId;
      const stroke = selected ? '#fbbf24' : layer.stroke;
      const trianglesD = layer.showTriangles ? toScreenD(layer.trianglesD, project) : '';
      const boundaryD = layer.showBoundary ? toScreenD(layer.boundaryD, project) : '';
      const badgeAnchor =
        layer.bounds != null ? project(layer.bounds.minX, layer.bounds.maxY) : null;
      return (
        <g
          key={`surface:${layer.surfaceId}`}
          data-surface-layer={layer.surfaceId}
          data-surface-stale={layer.stale ? 'true' : undefined}
          data-surface-contours={layer.showContours ? 'true' : undefined}
          className={pickActive ? 'cursor-crosshair' : 'cursor-pointer'}
          onClick={(event) => {
            event.stopPropagation();
            onSurfaceClick(layer.surfaceId);
          }}
        >
          {trianglesD ? (
            <path
              d={trianglesD}
              fill="none"
              stroke={stroke}
              strokeWidth={selected ? 2 : 1}
              opacity={layer.opacity}
              strokeDasharray={layer.stale ? '6 4' : undefined}
              pointerEvents="stroke"
            />
          ) : null}
          {boundaryD ? (
            <path
              d={boundaryD}
              fill="none"
              stroke={stroke}
              strokeWidth={selected ? 2.6 : 1.6}
              opacity={Math.min(1, layer.opacity + 0.1)}
              pointerEvents="stroke"
            />
          ) : null}
          {layer.showContours ? (
            <g pointerEvents="none">
              {layer.minorContoursD ? (
                <path
                  d={toScreenD(layer.minorContoursD, project)}
                  fill="none"
                  stroke={layer.minorContourStroke ?? stroke}
                  strokeWidth={1}
                  opacity={layer.opacity}
                />
              ) : null}
              {layer.majorContoursD ? (
                <path
                  d={toScreenD(layer.majorContoursD, project)}
                  fill="none"
                  stroke={layer.majorContourStroke ?? stroke}
                  strokeWidth={2}
                  opacity={Math.min(1, layer.opacity + 0.1)}
                />
              ) : null}
              {(layer.contourLabels ?? []).map((label, index) => {
                const point = project(label.x, label.y);
                return (
                  <text
                    key={`surface:${layer.surfaceId}:cl:${index + 1}`}
                    x={point.x}
                    y={point.y}
                    fill={label.kind === 'major' ? (layer.majorContourStroke ?? stroke) : (layer.minorContourStroke ?? stroke)}
                    fontSize={10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    transform={`rotate(${label.rotationDeg} ${point.x} ${point.y})`}
                    pointerEvents="none"
                  >
                    {label.text}
                  </text>
                );
              })}
            </g>
          ) : null}
          {layer.showVertices && layer.vertices.length > 0 ? (
            <g fill={stroke} opacity={layer.opacity} pointerEvents="none">
              {layer.vertices.map((vertex, index) => {
                const point = project(vertex.x, vertex.y);
                return (
                  <circle
                    key={`surface:${layer.surfaceId}:v:${index + 1}`}
                    cx={point.x}
                    cy={point.y}
                    r={Math.max(1.6, 2.2 * Math.min(1, scale))}
                  />
                );
              })}
            </g>
          ) : null}
          {layer.stale && badgeAnchor ? (
            <text
              x={badgeAnchor.x}
              y={badgeAnchor.y - 6}
              fill="#fbbf24"
              fontSize={11}
              textAnchor="start"
              pointerEvents="none"
            >
              {`STALE — ${layer.statusText}`}
            </text>
          ) : null}
        </g>
      );
    })}
  </>
);

/**
 * Phase 18U — derived analysis band fills + legends. Analysis fills render
 * UNDER the surface/contour passes (rendered before them), one aggregated
 * path per band (never per triangle); `showBoundaries` adds outlines;
 * legends draw their frame/title/swatch rows from the CURRENT cached result.
 */
export const renderAnalysisLayers = ({
  layers,
  legendLayers,
  project,
}: {
  layers: readonly CadAnalysisDisplayLayer[];
  legendLayers: readonly AnalysisLegendGeometry[];
  project: ProjectPoint;
}): React.ReactNode => (
  <>
    {layers.map((layer) => (
      <g key={`analysis:${layer.analysisId}`} data-analysis-layer={layer.analysisId} pointerEvents="none">
        {layer.bands.map((band) =>
          band.d === '' ? null : (
            <path
              key={band.bandId}
              d={toScreenD(band.d, project)}
              fill={band.color}
              fillOpacity={layer.opacity}
              stroke="none"
              data-analysis-band={band.bandId}
              data-analysis-regions={band.regionCount}
            />
          ),
        )}
        {layer.boundariesD !== '' ? (
          <path
            d={toScreenD(layer.boundariesD, project)}
            fill="none"
            stroke="#111827"
            strokeWidth={0.6}
            data-analysis-boundaries={layer.analysisId}
          />
        ) : null}
      </g>
    ))}
    {legendLayers.map((legend) => {
      const title = project(legend.frame.x, legend.frame.y + legend.titleHeight * 1.2);
      return (
        <g
          key={`analysis-legend:${legend.legendId}`}
          data-analysis-legend-layer={legend.legendId}
          data-analysis-legend-ranges-only={legend.rangesOnly ? 'true' : undefined}
          pointerEvents="none"
        >
          <text x={title.x} y={title.y} fill="#e2e8f0" fontSize={11} data-analysis-legend-title={legend.legendId}>
            {legend.title}
          </text>
          {legend.rows.map((row, index) => {
            const rowPoint = project(row.x, row.y + legend.titleHeight * 0.8);
            return (
              <React.Fragment key={`${legend.legendId}:${row.bandId}:${index}`}>
                <rect
                  x={rowPoint.x}
                  y={rowPoint.y - legend.rowHeight * 0.7}
                  width={legend.swatchWidth}
                  height={legend.rowHeight * 0.7}
                  fill={row.color}
                />
                <text x={rowPoint.x + legend.swatchWidth + 3} y={rowPoint.y} fill="#cbd5e1" fontSize={10}>
                  {[row.rangeText, row.quantityText].filter((part) => part !== '').join(' · ')}
                </text>
              </React.Fragment>
            );
          })}
        </g>
      );
    })}
  </>
);

/**
 * Phase 18I — derived volume CUT/FILL regions. One aggregated path per
 * kind (never CAD entities, never per-polygon nodes); No-Display styles
 * produce no layer at all (quantity-only). OFF/FROZEN layers are dropped
 * by the viewport filter before this render.
 */
export const renderVolumeLayers = ({
  layers,
  project,
}: {
  layers: readonly CadVolumeDisplayLayer[];
  project: ProjectPoint;
}): React.ReactNode => (
  <>
    {layers.map((layer) => (
      <g
        key={`volume:${layer.volumeId}`}
        data-volume-layer={layer.volumeId}
        pointerEvents="none"
      >
        {layer.showCut && layer.cutD ? (
          <path
            d={toScreenD(layer.cutD, project)}
            fill={layer.cutStroke}
            fillOpacity={layer.opacity}
            stroke={layer.cutStroke}
            strokeWidth={1}
            data-volume-kind="cut"
          />
        ) : null}
        {layer.showFill && layer.fillD ? (
          <path
            d={toScreenD(layer.fillD, project)}
            fill={layer.fillStroke}
            fillOpacity={layer.opacity}
            stroke={layer.fillStroke}
            strokeWidth={1}
            data-volume-kind="fill"
          />
        ) : null}
      </g>
    ))}
  </>
);
