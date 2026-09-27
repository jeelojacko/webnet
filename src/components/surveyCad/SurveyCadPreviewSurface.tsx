import React from 'react';
import type { CadSurfaceDisplayLayer } from '../../engine/cad/cadDisplayTypes';
import type { CadGradingDisplayLayer } from '../../engine/cad/cadGradingView';
import type { CadGradingGroupDisplayLayer } from '../../engine/cad/cadGradingGroupView';
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

/**
 * Phase 20B — derived grading fills + daylight ties. One aggregated fill
 * path + one tie polyline per CURRENT grading (never CAD entities);
 * curve-approximated results carry an explicit text badge (never
 * color-only). Stale/failed rows produce no layer upstream. OFF/FROZEN
 * layers are dropped by the viewport filter before this render.
 */
/**
 * Phase 20C Wave-4A — derived grading-group fills + daylight + seam +
 * ghosts. Result layers mirror the single-grading render; the seam is a
 * dashed screen-only diagnostic (never plotted); ghost layers render side
 * arrows for the selected uncalculated group; failed layers render
 * offending corner/course markers with a text badge (never color-only).
 */
export const renderGroupGradingLayers = ({
  layers,
  project,
}: {
  layers: readonly CadGradingGroupDisplayLayer[];
  project: ProjectPoint;
}): React.ReactNode => (
  <>
    {layers.map((layer) => (
      <g
        key={`grading-group:${layer.groupId}`}
        data-grading-group-layer={layer.groupId}
        data-grading-group-kind={layer.kind}
        data-grading-group-approximated={layer.curveApproximated ? 'true' : undefined}
        pointerEvents="none"
      >
        {layer.trianglesD ? (
          <path
            d={toScreenD(layer.trianglesD, project)}
            fill={layer.fillStroke}
            fillOpacity={layer.opacity}
            stroke={layer.fillStroke}
            strokeWidth={1}
            data-grading-group-kind="fill"
          />
        ) : null}
        {layer.daylightD ? (
          <path
            d={toScreenD(layer.daylightD, project)}
            fill="none"
            stroke={layer.daylightStroke}
            strokeWidth={1.6}
            data-grading-group-kind="daylight"
          />
        ) : null}
        {layer.seamD ? (
          <path
            d={toScreenD(layer.seamD, project)}
            fill="none"
            stroke="#38bdf8"
            strokeWidth={1}
            strokeDasharray="4 2"
            data-grading-group-kind="seam"
          />
        ) : null}
        {layer.ghostArrows.map((arrow, index) => {
          const from = project(arrow.from.x, arrow.from.y);
          const to = project(arrow.to.x, arrow.to.y);
          return (
            <line
              key={index}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke="#4ade80"
              strokeWidth={1.2}
              strokeDasharray="3 2"
              data-grading-group-kind="ghost"
            />
          );
        })}
        {layer.failedMarkers.map((marker, index) => {
          const point = project(marker.x, marker.y);
          return (
            <text
              key={index}
              x={point.x}
              y={point.y - 6}
              fill="#f87171"
              fontSize={11}
              textAnchor="start"
              pointerEvents="none"
              data-grading-group-kind="failed"
            >
              {marker.label}
            </text>
          );
        })}
        {layer.badgeText && layer.badgeAnchor ? (() => {
          const point = project(layer.badgeAnchor.x, layer.badgeAnchor.y);
          return (
            <text
              x={point.x}
              y={point.y - 6}
              fill={layer.kind === 'failed' ? '#f87171' : '#fbbf24'}
              fontSize={11}
              textAnchor="start"
              pointerEvents="none"
            >
              {layer.badgeText}
            </text>
          );
        })() : null}
      </g>
    ))}
  </>
);

export const renderGradingLayers = ({
  layers,
  project,
}: {
  layers: readonly CadGradingDisplayLayer[];
  project: ProjectPoint;
}): React.ReactNode => (
  <>
    {layers.map((layer) => (
      <g
        key={`grading:${layer.gradingId}`}
        data-grading-layer={layer.gradingId}
        data-grading-approximated={layer.curveApproximated ? 'true' : undefined}
        pointerEvents="none"
      >
        {layer.trianglesD ? (
          <path
            d={toScreenD(layer.trianglesD, project)}
            fill={layer.fillStroke}
            fillOpacity={layer.opacity}
            stroke={layer.fillStroke}
            strokeWidth={1}
            data-grading-kind="fill"
          />
        ) : null}
        {layer.daylightD ? (
          <path
            d={toScreenD(layer.daylightD, project)}
            fill="none"
            stroke={layer.daylightStroke}
            strokeWidth={1.6}
            data-grading-kind="daylight"
          />
        ) : null}
        {layer.curveApproximated && layer.badgeAnchor ? (() => {
          const point = project(layer.badgeAnchor.x, layer.badgeAnchor.y);
          return (
            <text
              x={point.x}
              y={point.y - 6}
              fill="#fbbf24"
              fontSize={11}
              textAnchor="start"
              pointerEvents="none"
            >
              CURVE APPROXIMATED
            </text>
          );
        })() : null}
      </g>
    ))}
  </>
);
