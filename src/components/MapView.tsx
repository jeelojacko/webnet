import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AdjustmentResult } from '../types';
import { buildMap3DScene, createDefaultMap3DCamera, type Map3DCamera, type Vec3 } from '../engine/map3d';
import { RAD_TO_DEG, radToDmsStr } from '../engine/angles';
import { computeInverse2D, computePivotAngles } from '../engine/mapTools';

const FT_PER_M = 3.280839895;
const VIEW_W = 1000;
const VIEW_H = 700;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 200;
const MIDDLE_DBLCLICK_MS = 320;
const DEG_TO_RAD = Math.PI / 180;
const MAX_ELLIPSOID_SAMPLES = 28;

type ToolPanel = 'none' | 'points' | 'inverse' | 'angles';

interface MapViewProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  showLostStations?: boolean;
  mode?: '2d' | '3d';
  viewportWidthOverride?: number;
}

type DragMode = 'none' | 'pan2d' | 'orbit3d' | 'pan3d';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const MapView: React.FC<MapViewProps> = ({
  result,
  units,
  showLostStations = true,
  mode = '2d',
  viewportWidthOverride,
}) => {
  const unitScale = units === 'ft' ? FT_PER_M : 1;
  const { stations, observations } = result;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);
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
  const [contextMenu, setContextMenu] = useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const [activeTool, setActiveTool] = useState<ToolPanel>('none');
  const [inverseFromInput, setInverseFromInput] = useState('');
  const [inverseToInput, setInverseToInput] = useState('');
  const [anglePivotInput, setAnglePivotInput] = useState('');
  const [angleFromInput, setAngleFromInput] = useState('');
  const [angleToInput, setAngleToInput] = useState('');
  const [viewportWidth, setViewportWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );

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

  const visibleStationIds = useMemo(
    () =>
      Object.entries(stations)
        .filter(([, station]) => showLostStations || !station.lost)
        .map(([stationId]) => stationId)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    [showLostStations, stations],
  );

  const stationIdLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    visibleStationIds.forEach((stationId) => {
      lookup.set(stationId.toUpperCase(), stationId);
    });
    return lookup;
  }, [visibleStationIds]);

  const resolveStationId = useCallback(
    (value: string): string | null => {
      const token = value.trim();
      if (!token) return null;
      return stationIdLookup.get(token.toUpperCase()) ?? null;
    },
    [stationIdLookup],
  );

  useEffect(() => {
    if (typeof window === 'undefined' || viewportWidthOverride != null) return;
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [viewportWidthOverride]);

  useEffect(() => {
    if (visibleStationIds.length === 0) {
      setInverseFromInput('');
      setInverseToInput('');
      setAnglePivotInput('');
      setAngleFromInput('');
      setAngleToInput('');
      return;
    }
    if (!resolveStationId(inverseFromInput)) setInverseFromInput(visibleStationIds[0]);
    if (!resolveStationId(inverseToInput))
      setInverseToInput(visibleStationIds[Math.min(1, visibleStationIds.length - 1)]);
    if (!resolveStationId(anglePivotInput)) setAnglePivotInput(visibleStationIds[0]);
    if (!resolveStationId(angleFromInput))
      setAngleFromInput(visibleStationIds[Math.min(1, visibleStationIds.length - 1)]);
    if (!resolveStationId(angleToInput))
      setAngleToInput(visibleStationIds[Math.min(2, visibleStationIds.length - 1)]);
  }, [
    angleFromInput,
    anglePivotInput,
    angleToInput,
    inverseFromInput,
    inverseToInput,
    resolveStationId,
    visibleStationIds,
  ]);

  useEffect(() => {
    if (!contextMenu.open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && contextMenuRef.current?.contains(target)) return;
      setContextMenu((prev) => ({ ...prev, open: false }));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setContextMenu((prev) => ({ ...prev, open: false }));
      }
    };
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu.open]);

  const effectiveViewportWidth = viewportWidthOverride ?? viewportWidth;

  const fallbackReason = useMemo(() => {
    if (mode !== '3d') return null;
    if (scene3d.stations.length > 500 || scene3d.edges.length > 1000) {
      return `network too large (${scene3d.stations.length} stations, ${scene3d.edges.length} edges)`;
    }
    if (effectiveViewportWidth < 768 && (scene3d.stations.length > 140 || scene3d.edges.length > 260)) {
      return `mobile viewport (${effectiveViewportWidth}px) with dense geometry`;
    }
    return null;
  }, [mode, scene3d.edges.length, scene3d.stations.length, effectiveViewportWidth]);
  const effectiveMode: '2d' | '3d' = mode === '3d' && !fallbackReason ? '3d' : '2d';

  const reset2dView = useCallback(() => {
    setView2d({ zoom: 1, panX: 0, panY: 0 });
  }, []);

  const reset3dView = useCallback(() => {
    setCamera3d(createDefaultMap3DCamera(scene3d));
  }, [scene3d]);

  useEffect(() => {
    if (effectiveMode === '3d') {
      reset3dView();
      return;
    }
    reset2dView();
  }, [effectiveMode, reset2dView, reset3dView, bbox.minX, bbox.minY, bbox.width, bbox.height]);

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
      if (effectiveMode !== '3d') return;
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
    [toSvgCoords, effectiveMode, camera3d?.distance],
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
    if (effectiveMode === '3d') {
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
    if (effectiveMode === '3d') {
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
    if (effectiveMode !== '3d' || !camera3d) return [];
    return scene3d.stations
      .map((node) => ({ node, p: project3d(node.position) }))
      .filter((row) => row.p.visible)
      .sort((a, b) => b.p.depth - a.p.depth);
  }, [camera3d, effectiveMode, project3d, scene3d]);

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

  const inverseFromId = resolveStationId(inverseFromInput);
  const inverseToId = resolveStationId(inverseToInput);
  const anglePivotId = resolveStationId(anglePivotInput);
  const angleFromId = resolveStationId(angleFromInput);
  const angleToId = resolveStationId(angleToInput);

  const inverse = useMemo(() => {
    if (!inverseFromId || !inverseToId) return null;
    const from = stations[inverseFromId];
    const to = stations[inverseToId];
    if (!from || !to) return null;
    return computeInverse2D({ x: from.x, y: from.y }, { x: to.x, y: to.y });
  }, [inverseFromId, inverseToId, stations]);

  const angleBetween = useMemo(() => {
    if (!anglePivotId || !angleFromId || !angleToId) return null;
    const pivot = stations[anglePivotId];
    const from = stations[angleFromId];
    const to = stations[angleToId];
    if (!pivot || !from || !to) return null;
    return computePivotAngles(
      { x: pivot.x, y: pivot.y },
      { x: from.x, y: from.y },
      { x: to.x, y: to.y },
    );
  }, [angleFromId, anglePivotId, angleToId, stations]);

  const openContextMenu = (event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const menuWidth = 210;
    const menuHeight = 126;
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const x = clamp(localX, 8, Math.max(8, rect.width - menuWidth - 8));
    const y = clamp(localY, 8, Math.max(8, rect.height - menuHeight - 8));
    setContextMenu({
      open: true,
      x,
      y,
    });
  };

  const openTool = (tool: ToolPanel) => {
    setActiveTool(tool);
    setContextMenu((prev) => ({ ...prev, open: false }));
  };

  const closeTool = () => setActiveTool('none');

  return (
    <div className="h-full p-4 flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-3 text-xs text-slate-400 shrink-0">
        <span>
          Map view ({effectiveMode.toUpperCase()} scaled) — coords & ellipses in {units} ({unitScale.toFixed(4)} factor)
        </span>
        <span className="text-slate-500">
          {effectiveMode === '3d'
            ? 'Left-drag=orbit, middle-drag=pan, wheel=zoom, middle-double-click=reset'
            : 'Wheel=zoom, middle-drag=pan, middle-double-click=reset extents'}
          {'; right-click=tools'}
        </span>
      </div>
      {mode === '3d' && fallbackReason && (
        <div className="mb-2 rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
          3D rendering fallback: {fallbackReason}. Showing 2D map for stable performance.
        </div>
      )}
      <div
        ref={containerRef}
        className="bg-slate-900 border border-slate-800 rounded overflow-hidden flex-1 min-h-0 relative"
      >
        {effectiveMode === '3d' && (
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
        {contextMenu.open && (
          <div
            ref={contextMenuRef}
            className="absolute z-20 min-w-[210px] rounded border border-slate-700 bg-slate-900/95 p-1 text-xs shadow-lg shadow-black/50"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <button
              type="button"
              onClick={() => openTool('points')}
              className="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800"
            >
              Points
            </button>
            <button
              type="button"
              onClick={() => openTool('inverse')}
              className="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800"
            >
              Inverse
            </button>
            <button
              type="button"
              onClick={() => openTool('angles')}
              className="block w-full rounded px-2 py-1.5 text-left text-slate-200 hover:bg-slate-800"
            >
              Angles Between
            </button>
          </div>
        )}
        {activeTool !== 'none' && (
          <div className="absolute left-2 top-2 z-20 w-[min(560px,calc(100%-16px))] rounded border border-slate-700 bg-slate-900/95 p-3 text-xs shadow-lg shadow-black/45">
            <div className="mb-2 flex items-center justify-between border-b border-slate-700 pb-2">
              <div className="uppercase tracking-wider text-slate-300">
                {activeTool === 'points'
                  ? 'Points'
                  : activeTool === 'inverse'
                    ? 'Inverse'
                    : 'Angles Between'}
              </div>
              <button
                type="button"
                onClick={closeTool}
                className="rounded border border-slate-600 px-2 py-0.5 text-slate-300 hover:bg-slate-800"
              >
                Close
              </button>
            </div>

            {activeTool === 'points' && (
              <div className="max-h-[300px] overflow-auto">
                <table className="w-full border-collapse text-left">
                  <thead>
                    <tr className="border-b border-slate-700 text-slate-400">
                      <th className="px-2 py-1">Point</th>
                      <th className="px-2 py-1 text-right">Northing ({units})</th>
                      <th className="px-2 py-1 text-right">Easting ({units})</th>
                      <th className="px-2 py-1 text-right">Height ({units})</th>
                      <th className="px-2 py-1 text-right">σN ({units})</th>
                      <th className="px-2 py-1 text-right">σE ({units})</th>
                      <th className="px-2 py-1 text-right">σH ({units})</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-200">
                    {visibleStationIds.map((stationId) => {
                      const station = stations[stationId];
                      if (!station) return null;
                      const formatStd = (value?: number) =>
                        value != null && Number.isFinite(value)
                          ? (value * unitScale).toFixed(4)
                          : '-';
                      return (
                        <tr key={`point-tool-${stationId}`} className="border-b border-slate-800/60">
                          <td className="px-2 py-1">{stationId}</td>
                          <td className="px-2 py-1 text-right">{(station.y * unitScale).toFixed(4)}</td>
                          <td className="px-2 py-1 text-right">{(station.x * unitScale).toFixed(4)}</td>
                          <td className="px-2 py-1 text-right">{(station.h * unitScale).toFixed(4)}</td>
                          <td className="px-2 py-1 text-right">{formatStd(station.sN)}</td>
                          <td className="px-2 py-1 text-right">{formatStd(station.sE)}</td>
                          <td className="px-2 py-1 text-right">{formatStd(station.sH)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {activeTool === 'inverse' && (
              <div className="space-y-2">
                <datalist id="map-point-id-list">
                  {visibleStationIds.map((stationId) => (
                    <option key={`inv-id-${stationId}`} value={stationId} />
                  ))}
                </datalist>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <label className="space-y-1 text-slate-300">
                    From Point
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inverseFromInput}
                        onChange={(event) => setInverseFromInput(event.target.value)}
                        list="map-point-id-list"
                        className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      />
                      <select
                        value={inverseFromId ?? ''}
                        onChange={(event) => setInverseFromInput(event.target.value)}
                        className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      >
                        <option value="">Select</option>
                        {visibleStationIds.map((stationId) => (
                          <option key={`inv-from-${stationId}`} value={stationId}>
                            {stationId}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <label className="space-y-1 text-slate-300">
                    To Point
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={inverseToInput}
                        onChange={(event) => setInverseToInput(event.target.value)}
                        list="map-point-id-list"
                        className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      />
                      <select
                        value={inverseToId ?? ''}
                        onChange={(event) => setInverseToInput(event.target.value)}
                        className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      >
                        <option value="">Select</option>
                        {visibleStationIds.map((stationId) => (
                          <option key={`inv-to-${stationId}`} value={stationId}>
                            {stationId}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>
                <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200">
                  {!inverseFromId || !inverseToId ? (
                    <div>Enter or select both point IDs.</div>
                  ) : inverseFromId === inverseToId ? (
                    <div>From and To points must be different.</div>
                  ) : !inverse ? (
                    <div>Inverse unavailable for the selected points.</div>
                  ) : (
                    <div className="space-y-1">
                      <div>
                        Az {inverseFromId} → {inverseToId}:{' '}
                        <span className="font-mono">{radToDmsStr(inverse.azimuthFromToRad)}</span>{' '}
                        ({(inverse.azimuthFromToRad * RAD_TO_DEG).toFixed(6)} deg)
                      </div>
                      <div>
                        Az {inverseToId} → {inverseFromId}:{' '}
                        <span className="font-mono">{radToDmsStr(inverse.azimuthToFromRad)}</span>{' '}
                        ({(inverse.azimuthToFromRad * RAD_TO_DEG).toFixed(6)} deg)
                      </div>
                      <div>
                        Horizontal distance:{' '}
                        <span className="font-mono">
                          {(inverse.distance2d * unitScale).toFixed(4)} {units}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTool === 'angles' && (
              <div className="space-y-2">
                <datalist id="map-angle-point-id-list">
                  {visibleStationIds.map((stationId) => (
                    <option key={`ang-id-${stationId}`} value={stationId} />
                  ))}
                </datalist>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <label className="space-y-1 text-slate-300">
                    Pivot
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={anglePivotInput}
                        onChange={(event) => setAnglePivotInput(event.target.value)}
                        list="map-angle-point-id-list"
                        className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      />
                      <select
                        value={anglePivotId ?? ''}
                        onChange={(event) => setAnglePivotInput(event.target.value)}
                        className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      >
                        <option value="">Select</option>
                        {visibleStationIds.map((stationId) => (
                          <option key={`ang-piv-${stationId}`} value={stationId}>
                            {stationId}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <label className="space-y-1 text-slate-300">
                    Leg A
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={angleFromInput}
                        onChange={(event) => setAngleFromInput(event.target.value)}
                        list="map-angle-point-id-list"
                        className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      />
                      <select
                        value={angleFromId ?? ''}
                        onChange={(event) => setAngleFromInput(event.target.value)}
                        className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      >
                        <option value="">Select</option>
                        {visibleStationIds.map((stationId) => (
                          <option key={`ang-from-${stationId}`} value={stationId}>
                            {stationId}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                  <label className="space-y-1 text-slate-300">
                    Leg B
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={angleToInput}
                        onChange={(event) => setAngleToInput(event.target.value)}
                        list="map-angle-point-id-list"
                        className="w-full rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      />
                      <select
                        value={angleToId ?? ''}
                        onChange={(event) => setAngleToInput(event.target.value)}
                        className="rounded border border-slate-600 bg-slate-950 px-2 py-1 text-slate-100"
                      >
                        <option value="">Select</option>
                        {visibleStationIds.map((stationId) => (
                          <option key={`ang-to-${stationId}`} value={stationId}>
                            {stationId}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>
                <div className="rounded border border-slate-700 bg-slate-950 px-3 py-2 text-slate-200">
                  {!anglePivotId || !angleFromId || !angleToId ? (
                    <div>Enter or select all three point IDs.</div>
                  ) : anglePivotId === angleFromId ||
                    anglePivotId === angleToId ||
                    angleFromId === angleToId ? (
                    <div>Pivot, Leg A, and Leg B must be three different points.</div>
                  ) : !angleBetween ? (
                    <div>Angle unavailable for the selected points.</div>
                  ) : (
                    <div className="space-y-1">
                      <div>
                        Inside angle at {anglePivotId}:{' '}
                        <span className="font-mono">{radToDmsStr(angleBetween.insideAngleRad)}</span>{' '}
                        ({(angleBetween.insideAngleRad * RAD_TO_DEG).toFixed(6)} deg)
                      </div>
                      <div>
                        Outside angle at {anglePivotId}:{' '}
                        <span className="font-mono">{radToDmsStr(angleBetween.outsideAngleRad)}</span>{' '}
                        ({(angleBetween.outsideAngleRad * RAD_TO_DEG).toFixed(6)} deg)
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className={`w-full h-full select-none ${isDragging ? 'cursor-grabbing' : effectiveMode === '3d' ? 'cursor-grab' : 'cursor-default'}`}
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onMouseLeave={stopDrag}
          onContextMenu={openContextMenu}
        >
          {effectiveMode === '2d' && (
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

          {effectiveMode === '3d' && camera3d && (
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
