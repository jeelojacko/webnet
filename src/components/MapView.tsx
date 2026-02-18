import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdjustmentResult } from '../types';

const FT_PER_M = 3.280839895;
const VIEW_W = 1000;
const VIEW_H = 700;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 200;
const MIDDLE_DBLCLICK_MS = 320;

interface MapViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const MapView: React.FC<MapViewProps> = ({ result, units }) => {
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const { stations, observations } = result;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const panRef = useRef({ active: false, lastX: 0, lastY: 0 });
  const middleClickRef = useRef(0);
  const [view, setView] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [isPanning, setIsPanning] = useState(false);

  const { points, bbox } = useMemo(() => {
    const entries = Object.entries(stations);
    if (entries.length === 0) {
      return {
        points: [],
        bbox: { minX: 0, minY: 0, width: 1, height: 1 },
      };
    }
    const xs = entries.map(([, s]) => s.x);
    const ys = entries.map(([, s]) => s.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const pts = entries.map(([id, s]) => ({
      id,
      x: s.x,
      y: s.y,
      h: s.h,
      fixed: s.fixed,
      ellipse: s.errorEllipse,
    }));
    return { points: pts, bbox: { minX: minX - pad, minY: minY - pad, width, height } };
  }, [stations]);

  const resetView = useCallback(() => {
    setView({ zoom: 1, panX: 0, panY: 0 });
  }, []);

  useEffect(() => {
    resetView();
  }, [resetView, bbox.minX, bbox.minY, bbox.width, bbox.height]);

  const project = useCallback(
    (x: number, y: number) => {
      const px = ((x - bbox.minX) / bbox.width) * VIEW_W;
      const py = VIEW_H - ((y - bbox.minY) / bbox.height) * VIEW_H;
      return { x: px, y: py };
    },
    [bbox],
  );

  const toSvgCoords = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = ((clientX - rect.left) / rect.width) * VIEW_W;
    const y = ((clientY - rect.top) / rect.height) * VIEW_H;
    return { x, y };
  }, []);

  const stopPan = useCallback(() => {
    if (!panRef.current.active) return;
    panRef.current.active = false;
    setIsPanning(false);
  }, []);

  const handlePanMoveClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!panRef.current.active) return;
      const next = toSvgCoords(clientX, clientY);
      if (!next) return;
      const dx = next.x - panRef.current.lastX;
      const dy = next.y - panRef.current.lastY;
      panRef.current.lastX = next.x;
      panRef.current.lastY = next.y;
      setView((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
    },
    [toSvgCoords],
  );

  useEffect(() => {
    if (!isPanning) return;
    const onMouseMove = (event: MouseEvent) => {
      handlePanMoveClient(event.clientX, event.clientY);
    };
    const onMouseUp = (event: MouseEvent) => {
      if (event.button === 1 || panRef.current.active) {
        stopPan();
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handlePanMoveClient, isPanning, stopPan]);

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const anchor = toSvgCoords(event.clientX, event.clientY);
    if (!anchor) return;
    setView((prev) => {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextZoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === prev.zoom) return prev;
      const ratio = nextZoom / prev.zoom;
      const panX = anchor.x - (anchor.x - prev.panX) * ratio;
      const panY = anchor.y - (anchor.y - prev.panY) * ratio;
      return { zoom: nextZoom, panX, panY };
    });
  };

  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button !== 1) return;
    event.preventDefault();
    const now = performance.now();
    const sinceLastMiddle = now - middleClickRef.current;
    middleClickRef.current = now;
    if (sinceLastMiddle > 0 && sinceLastMiddle <= MIDDLE_DBLCLICK_MS) {
      stopPan();
      resetView();
      return;
    }
    const start = toSvgCoords(event.clientX, event.clientY);
    if (!start) return;
    panRef.current = { active: true, lastX: start.x, lastY: start.y };
    setIsPanning(true);
  };

  const handleMouseUp = (event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button === 1) stopPan();
  };

  const displayScale = Math.sqrt(view.zoom);
  const pointRadiusPx = clamp(7 / displayScale, 1.6, 7);
  const lineWidthPx = clamp(1.2 / displayScale, 0.35, 1.2);
  const ellipseStrokePx = clamp(1 / displayScale, 0.35, 1);
  const labelFontPx = clamp(12 + Math.max(0, Math.log2(view.zoom)) * 3, 12, 26);
  const labelStrokePx = clamp(labelFontPx * 0.12, 1.2, 2.8);
  const labelOffsetPx = clamp(labelFontPx * 0.85, 9, 22);
  const markerSizePx = clamp(6 / displayScale, 2.5, 6);
  const invZoom = 1 / view.zoom;
  const pointRadius = pointRadiusPx * invZoom;
  const lineWidth = lineWidthPx * invZoom;
  const ellipseStrokeWidth = ellipseStrokePx * invZoom;
  const labelFontSize = labelFontPx * invZoom;
  const labelStrokeWidth = labelStrokePx * invZoom;
  const labelOffset = labelOffsetPx * invZoom;
  const markerSize = markerSizePx * invZoom;
  const ellScale = units === 'ft' ? 0.0328084 : 1;

  return (
    <div className="h-full p-4 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400 shrink-0">
        <span>
          Map view (scaled) — coords & ellipses in {units} ({unitScale.toFixed(4)} factor)
        </span>
        <span className="text-slate-500">
          Wheel=zoom, middle-drag=pan, middle-double-click=reset extents
        </span>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded overflow-hidden flex-1 min-h-0">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={`w-full h-full select-none ${isPanning ? 'cursor-grabbing' : 'cursor-default'}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={stopPan}
        >
          <defs>
            <marker
              id="arrow"
              markerWidth={markerSize}
              markerHeight={markerSize}
              refX={markerSize * 0.5}
              refY={markerSize * 0.5}
              orient="auto"
              markerUnits="userSpaceOnUse"
            >
              <path
                d={`M0,0 L0,${markerSize} L${markerSize},${markerSize * 0.5} z`}
                fill="#64748b"
              />
            </marker>
          </defs>

          <g transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}>
            {observations.map((obs, idx) => {
              if (obs.type !== 'dist' && obs.type !== 'gps') return null;
              const from = stations[obs.from];
              const to = stations[obs.to];
              if (!from || !to) return null;
              const p1 = project(from.x, from.y);
              const p2 = project(to.x, to.y);
              return (
                <line
                  key={`obs-${idx}`}
                  x1={p1.x}
                  y1={p1.y}
                  x2={p2.x}
                  y2={p2.y}
                  stroke="#475569"
                  strokeWidth={lineWidth}
                  markerEnd="url(#arrow)"
                  opacity={0.6}
                />
              );
            })}

            {points.map((p) => {
              const proj = project(p.x, p.y);
              const ellipse = p.ellipse;
              return (
                <g key={p.id}>
                  {ellipse && (
                    <ellipse
                      cx={proj.x}
                      cy={proj.y}
                      rx={(ellipse.semiMajor * 100 * ellScale * VIEW_W) / bbox.width}
                      ry={(ellipse.semiMinor * 100 * ellScale * VIEW_H) / bbox.height}
                      transform={`rotate(${ellipse.theta}, ${proj.x}, ${proj.y})`}
                      fill="none"
                      stroke="#38bdf8"
                      strokeWidth={ellipseStrokeWidth}
                      opacity={0.6}
                    />
                  )}
                  <circle
                    cx={proj.x}
                    cy={proj.y}
                    r={pointRadius}
                    fill={p.fixed ? '#22c55e' : '#fbbf24'}
                  />
                  <text
                    x={proj.x + labelOffset}
                    y={proj.y - labelOffset}
                    fontSize={labelFontSize}
                    fill="#e2e8f0"
                    stroke="#020617"
                    strokeWidth={labelStrokeWidth}
                    paintOrder="stroke"
                  >
                    {p.id}
                  </text>
                </g>
              );
            })}
          </g>

          {points.length === 0 && (
            <text x={VIEW_W / 2} y={VIEW_H / 2} textAnchor="middle" fill="#94a3b8" fontSize={18}>
              No stations to display
            </text>
          )}
        </svg>
      </div>
    </div>
  );
};

export default MapView;
