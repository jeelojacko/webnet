import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdjustmentResult } from '../types';
import { buildMap3DScene, createDefaultMap3DCamera, type Map3DCamera, type Vec3 } from '../engine/map3d';

const FT_PER_M = 3.280839895;
const VIEW_W = 1000;
const VIEW_H = 700;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 200;
const MIDDLE_DBLCLICK_MS = 320;
const DEG_TO_RAD = Math.PI / 180;
const MAX_ELLIPSOID_SAMPLES = 28;

interface MapViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  showLostStations?: boolean;
  mode?: '2d' | '3d';
}

type DragMode = 'none' | 'pan2d' | 'orbit3d' | 'pan3d';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const MapView: React.FC<MapViewProps> = ({ result, units, showLostStations = true, mode = '2d' }) => {
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const { stations, observations } = result;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef<{ active: boolean; mode: DragMode; lastX: number; lastY: number }>({
    active: false,
    mode: 'none',
    lastX: 0,
    lastY: 0,
  });
  const middleClickRef = useRef(0);
  const [view2d, setView2d] = useState({ zoom: 1, panX: 0, panY: 0 });
  const [camera3d, setCamera3d] = useState<Map3DCamera | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const scene3d = useMemo(() => buildMap3DScene(result, showLostStations), [result, showLostStations]);

  const { points, bbox } = useMemo(() => {
    if (scene3d.stations.length === 0) {
      return {
        points: [],
        bbox: { minX: 0, minY: 0, width: 1, height: 1 },
      };
    }
    const xs = scene3d.stations.map((s) => s.position.x);
    const ys = scene3d.stations.map((s) => s.position.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const pad = Math.max((maxX - minX) * 0.1, (maxY - minY) * 0.1, 1);
    const width = maxX - minX + pad * 2;
    const height = maxY - minY + pad * 2;
    const pts = scene3d.stations.map((s) => ({
      id: s.id,
      x: s.position.x,
      y: s.position.y,
      h: s.position.z,
      fixed: s.fixed,
      ellipsoid: s.ellipsoid,
    }));
    return { points: pts, bbox: { minX: minX - pad, minY: minY - pad, width, height } };
  }, [scene3d]);

  const reset2dView = useCallback(() => {
    setView2d({ zoom: 1, panX: 0, panY: 0 });
  }, []);

  const reset3dView = useCallback(() => {
    setCamera3d(createDefaultMap3DCamera(scene3d));
  }, [scene3d]);

  useEffect(() => {
    if (mode === '3d') {
      reset3dView();
      return;
    }
    reset2dView();
  }, [mode, reset2dView, reset3dView, bbox.minX, bbox.minY, bbox.width, bbox.height]);

  const project2d = useCallback(
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

  const stopDrag = useCallback(() => {
    if (!dragRef.current.active) return;
    dragRef.current.active = false;
    dragRef.current.mode = 'none';
    setIsDragging(false);
  }, []);

  const handleDragMoveClient = useCallback(
    (clientX: number, clientY: number) => {
      if (!dragRef.current.active) return;
      const next = toSvgCoords(clientX, clientY);
      if (!next) return;
      const dx = next.x - dragRef.current.lastX;
      const dy = next.y - dragRef.current.lastY;
      dragRef.current.lastX = next.x;
      dragRef.current.lastY = next.y;
      if (dragRef.current.mode === 'pan2d') {
        setView2d((prev) => ({ ...prev, panX: prev.panX + dx, panY: prev.panY + dy }));
        return;
      }
      if (mode !== '3d') return;
      if (dragRef.current.mode === 'orbit3d') {
        setCamera3d((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            yawDeg: prev.yawDeg + dx * 0.22,
            pitchDeg: clamp(prev.pitchDeg - dy * 0.22, -89, 89),
          };
        });
        return;
      }
      if (dragRef.current.mode === 'pan3d') {
        const panScale = Math.max(0.2, (camera3d?.distance ?? 10) * 0.0025);
        setCamera3d((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            panX: prev.panX - dx * panScale,
            panY: prev.panY + dy * panScale,
          };
        });
      }
    },
    [toSvgCoords, mode, camera3d?.distance],
  );

  useEffect(() => {
    if (!isDragging) return;
    const onMouseMove = (event: MouseEvent) => {
      handleDragMoveClient(event.clientX, event.clientY);
    };
    const onMouseUp = () => {
      stopDrag();
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [handleDragMoveClient, isDragging, stopDrag]);

  const handleWheel = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    if (mode === '3d') {
      setCamera3d((prev) => {
        if (!prev) return prev;
        const factor = Math.exp(event.deltaY * 0.0015);
        return {
          ...prev,
          distance: clamp(prev.distance * factor, 0.6, Math.max(50000, scene3d.extents.radius * 80)),
        };
      });
      return;
    }
    const anchor = toSvgCoords(event.clientX, event.clientY);
    if (!anchor) return;
    setView2d((prev) => {
      const factor = Math.exp(-event.deltaY * 0.0015);
      const nextZoom = clamp(prev.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (nextZoom === prev.zoom) return prev;
      const ratio = nextZoom / prev.zoom;
      const panX = anchor.x - (anchor.x - prev.panX) * ratio;
      const panY = anchor.y - (anchor.y - prev.panY) * ratio;
      return { zoom: nextZoom, panX, panY };
    });
  };

  const beginDrag = (modeName: DragMode, clientX: number, clientY: number) => {
    const start = toSvgCoords(clientX, clientY);
    if (!start) return;
    dragRef.current = { active: true, mode: modeName, lastX: start.x, lastY: start.y };
    setIsDragging(true);
  };

  const handleMouseDown = (event: React.MouseEvent<SVGSVGElement>) => {
    if (mode === '3d') {
      if (event.button === 0) {
        event.preventDefault();
        beginDrag('orbit3d', event.clientX, event.clientY);
        return;
      }
      if (event.button === 1) {
        event.preventDefault();
        const now = performance.now();
        const sinceLastMiddle = now - middleClickRef.current;
        middleClickRef.current = now;
        if (sinceLastMiddle > 0 && sinceLastMiddle <= MIDDLE_DBLCLICK_MS) {
          stopDrag();
          reset3dView();
          return;
        }
        beginDrag('pan3d', event.clientX, event.clientY);
      }
      return;
    }
    if (event.button !== 1) return;
    event.preventDefault();
    const now = performance.now();
    const sinceLastMiddle = now - middleClickRef.current;
    middleClickRef.current = now;
    if (sinceLastMiddle > 0 && sinceLastMiddle <= MIDDLE_DBLCLICK_MS) {
      stopDrag();
      reset2dView();
      return;
    }
    beginDrag('pan2d', event.clientX, event.clientY);
  };

  const handleMouseUp = (event: React.MouseEvent<SVGSVGElement>) => {
    if (event.button === 0 || event.button === 1) stopDrag();
  };

  const labelScale2d = Math.sqrt(view2d.zoom);
  const pointRadius2dPx = clamp(7 / labelScale2d, 1.6, 7);
  const lineWidth2dPx = clamp(1.2 / labelScale2d, 0.35, 1.2);
  const ellipseStroke2dPx = clamp(1 / labelScale2d, 0.35, 1);
  const labelFont2dPx = clamp(12 + Math.max(0, Math.log2(view2d.zoom)) * 3, 12, 26);
  const labelStroke2dPx = clamp(labelFont2dPx * 0.12, 1.2, 2.8);
  const labelOffset2dPx = clamp(labelFont2dPx * 0.85, 9, 22);
  const marker2dPx = clamp(6 / labelScale2d, 2.5, 6);
  const invZoom2d = 1 / view2d.zoom;
  const pointRadius2d = pointRadius2dPx * invZoom2d;
  const lineWidth2d = lineWidth2dPx * invZoom2d;
  const ellipseStroke2d = ellipseStroke2dPx * invZoom2d;
  const labelFont2d = labelFont2dPx * invZoom2d;
  const labelStroke2d = labelStroke2dPx * invZoom2d;
  const labelOffset2d = labelOffset2dPx * invZoom2d;
  const marker2d = marker2dPx * invZoom2d;

  const project3d = useCallback(
    (point: Vec3) => {
      if (!camera3d) return { x: VIEW_W / 2, y: VIEW_H / 2, depth: 1, visible: false };
      const target = {
        x: camera3d.target.x + camera3d.panX,
        y: camera3d.target.y + camera3d.panY,
        z: camera3d.target.z,
      };
      const relX = point.x - target.x;
      const relY = point.y - target.y;
      const relZ = point.z - target.z;
      const yaw = camera3d.yawDeg * DEG_TO_RAD;
      const pitch = camera3d.pitchDeg * DEG_TO_RAD;
      const cosYaw = Math.cos(yaw);
      const sinYaw = Math.sin(yaw);
      const cosPitch = Math.cos(pitch);
      const sinPitch = Math.sin(pitch);
      const xYaw = relX * cosYaw - relY * sinYaw;
      const yYaw = relX * sinYaw + relY * cosYaw;
      const yPitch = yYaw * cosPitch - relZ * sinPitch;
      const zPitch = yYaw * sinPitch + relZ * cosPitch;
      const depth = camera3d.distance - yPitch;
      const safeDepth = Math.max(0.2, depth);
      const focal = 420 * camera3d.zoom;
      const perspective = focal / safeDepth;
      const x = VIEW_W / 2 + xYaw * perspective;
      const y = VIEW_H / 2 - zPitch * perspective;
      return { x, y, depth: safeDepth, visible: depth > 0 };
    },
    [camera3d],
  );

  const projected3d = useMemo(() => {
    if (mode !== '3d' || !camera3d) return [];
    return scene3d.stations
      .map((node) => ({ node, p: project3d(node.position) }))
      .filter((row) => row.p.visible)
      .sort((a, b) => b.p.depth - a.p.depth);
  }, [camera3d, mode, project3d, scene3d]);

  const projected3dById = useMemo(() => {
    const map = new Map<string, { x: number; y: number; depth: number }>();
    projected3d.forEach((row) => map.set(row.node.id, row.p));
    return map;
  }, [projected3d]);

  const buildEllipsoidRings = useCallback(
    (center: Vec3, ellipsoid: { semiMajor: number; semiMinor: number; semiVertical: number; thetaDeg: number }) => {
      const theta = ellipsoid.thetaDeg * DEG_TO_RAD;
      const cosT = Math.cos(theta);
      const sinT = Math.sin(theta);
      const exaggeration = Math.max(1, scene3d.extents.radius * 0.01);
      const a = Math.max(0, ellipsoid.semiMajor * exaggeration * 80);
      const b = Math.max(0, ellipsoid.semiMinor * exaggeration * 80);
      const c = Math.max(0, ellipsoid.semiVertical * exaggeration * 80);
      if (a <= 0 && b <= 0 && c <= 0) return [];

      const samples = MAX_ELLIPSOID_SAMPLES;
      const ring = (builder: (_t: number) => Vec3): string => {
        const coords: string[] = [];
        for (let i = 0; i <= samples; i += 1) {
          const t = (i / samples) * Math.PI * 2;
          const world = builder(t);
          const p = project3d(world);
          if (!p.visible) continue;
          coords.push(`${p.x.toFixed(2)},${p.y.toFixed(2)}`);
        }
        return coords.join(' ');
      };

      const xy = ring((t) => {
        const lx = a * Math.cos(t);
        const ly = b * Math.sin(t);
        return {
          x: center.x + lx * cosT - ly * sinT,
          y: center.y + lx * sinT + ly * cosT,
          z: center.z,
        };
      });
      const xz = ring((t) => ({
        x: center.x + a * Math.cos(t) * cosT,
        y: center.y + a * Math.cos(t) * sinT,
        z: center.z + c * Math.sin(t),
      }));
      const yz = ring((t) => ({
        x: center.x - b * Math.cos(t) * sinT,
        y: center.y + b * Math.cos(t) * cosT,
        z: center.z + c * Math.sin(t),
      }));
      return [xy, xz, yz].filter((poly) => poly.length > 0);
    },
    [project3d, scene3d.extents.radius],
  );

  const applyCubeView = (preset: 'iso' | 'top' | 'front' | 'right') => {
    setCamera3d((prev) => {
      if (!prev) return prev;
      if (preset === 'top') return { ...prev, yawDeg: 0, pitchDeg: 89 };
      if (preset === 'front') return { ...prev, yawDeg: 0, pitchDeg: 0 };
      if (preset === 'right') return { ...prev, yawDeg: 90, pitchDeg: 0 };
      return { ...prev, yawDeg: -35, pitchDeg: 25 };
    });
  };

  return (
    <div className="h-full p-4 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400 shrink-0">
        <span>
          Map view ({mode.toUpperCase()} scaled) — coords & ellipses in {units} ({unitScale.toFixed(4)} factor)
        </span>
        <span className="text-slate-500">
          {mode === '3d'
            ? 'Left-drag=orbit, middle-drag=pan, wheel=zoom, middle-double-click=reset'
            : 'Wheel=zoom, middle-drag=pan, middle-double-click=reset extents'}
        </span>
      </div>
      <div className="bg-slate-900 border border-slate-800 rounded overflow-hidden flex-1 min-h-0 relative">
        {mode === '3d' && (
          <div className="absolute right-2 top-2 z-10 rounded border border-slate-700/80 bg-slate-900/85 p-1">
            <div className="grid grid-cols-2 gap-1 text-[10px]">
              <button
                type="button"
                onClick={() => applyCubeView('iso')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                ISO
              </button>
              <button
                type="button"
                onClick={() => applyCubeView('top')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                TOP
              </button>
              <button
                type="button"
                onClick={() => applyCubeView('front')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                FRONT
              </button>
              <button
                type="button"
                onClick={() => applyCubeView('right')}
                className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                RIGHT
              </button>
            </div>
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={`w-full h-full select-none ${isDragging ? 'cursor-grabbing' : mode === '3d' ? 'cursor-grab' : 'cursor-default'}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={stopDrag}
        >
          {mode === '2d' && (
            <>
              <defs>
                <marker
                  id="arrow"
                  markerWidth={marker2d}
                  markerHeight={marker2d}
                  refX={marker2d * 0.5}
                  refY={marker2d * 0.5}
                  orient="auto"
                  markerUnits="userSpaceOnUse"
                >
                  <path d={`M0,0 L0,${marker2d} L${marker2d},${marker2d * 0.5} z`} fill="#64748b" />
                </marker>
              </defs>

              <g transform={`translate(${view2d.panX} ${view2d.panY}) scale(${view2d.zoom})`}>
                {observations.map((obs, idx) => {
                  if (obs.type !== 'dist' && obs.type !== 'gps') return null;
                  const from = stations[obs.from];
                  const to = stations[obs.to];
                  if (!from || !to) return null;
                  if (!showLostStations && (from.lost || to.lost)) return null;
                  const p1 = project2d(from.x, from.y);
                  const p2 = project2d(to.x, to.y);
                  return (
                    <line
                      key={`obs-${idx}`}
                      x1={p1.x}
                      y1={p1.y}
                      x2={p2.x}
                      y2={p2.y}
                      stroke="#475569"
                      strokeWidth={lineWidth2d}
                      markerEnd="url(#arrow)"
                      opacity={0.6}
                    />
                  );
                })}

                {points.map((p) => {
                  const proj = project2d(p.x, p.y);
                  const ellipsoid = p.ellipsoid;
                  const ellScale = units === 'ft' ? 0.0328084 : 1;
                  return (
                    <g key={p.id}>
                      {ellipsoid && (
                        <ellipse
                          cx={proj.x}
                          cy={proj.y}
                          rx={(ellipsoid.semiMajor * 100 * ellScale * VIEW_W) / bbox.width}
                          ry={(ellipsoid.semiMinor * 100 * ellScale * VIEW_H) / bbox.height}
                          transform={`rotate(${ellipsoid.thetaDeg}, ${proj.x}, ${proj.y})`}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth={ellipseStroke2d}
                          opacity={0.6}
                        />
                      )}
                      <circle cx={proj.x} cy={proj.y} r={pointRadius2d} fill={p.fixed ? '#22c55e' : '#fbbf24'} />
                      <text
                        x={proj.x + labelOffset2d}
                        y={proj.y - labelOffset2d}
                        fontSize={labelFont2d}
                        fill="#e2e8f0"
                        stroke="#020617"
                        strokeWidth={labelStroke2d}
                        paintOrder="stroke"
                      >
                        {p.id}
                      </text>
                    </g>
                  );
                })}
              </g>
            </>
          )}

          {mode === '3d' && camera3d && (
            <>
              <rect x={0} y={0} width={VIEW_W} height={VIEW_H} fill="#020617" />
              {scene3d.edges.map((edge, idx) => {
                const a = projected3dById.get(edge.from);
                const b = projected3dById.get(edge.to);
                if (!a || !b) return null;
                return (
                  <line
                    key={`edge3d-${idx}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#334155"
                    strokeWidth={1}
                    opacity={0.65}
                  />
                );
              })}
              {projected3d.map(({ node, p }) => {
                const pointRadius = clamp(7 - Math.log10(Math.max(1, p.depth)), 2.2, 7);
                const labelSize = clamp(10 - Math.log10(Math.max(1, p.depth)) * 0.8, 8, 12);
                const labelOffset = clamp(8 - Math.log10(Math.max(1, p.depth)), 5, 10);
                const rings = node.ellipsoid
                  ? buildEllipsoidRings(node.position, node.ellipsoid)
                  : [];
                return (
                  <g key={node.id}>
                    {rings.map((poly, polyIdx) => (
                      <polyline
                        key={`${node.id}-ell-${polyIdx}`}
                        points={poly}
                        fill="none"
                        stroke="#38bdf8"
                        strokeWidth={0.9}
                        opacity={0.45}
                      />
                    ))}
                    <circle cx={p.x} cy={p.y} r={pointRadius} fill={node.fixed ? '#22c55e' : '#fbbf24'} />
                    <text
                      x={p.x + labelOffset}
                      y={p.y - labelOffset}
                      fontSize={labelSize}
                      fill="#e2e8f0"
                      stroke="#020617"
                      strokeWidth={1.2}
                      paintOrder="stroke"
                    >
                      {node.id}
                    </text>
                  </g>
                );
              })}
            </>
          )}

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
