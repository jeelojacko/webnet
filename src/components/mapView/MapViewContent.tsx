import React from 'react';
import type { PlanningMapState } from '../../types';
import type { MapInteractionPhase, RenderSurfaceLayout } from './mapViewInteraction';
import MapViewContextMenu, { type MapToolPanel } from './MapViewContextMenu';
import MapViewScene3d from './MapViewScene3d';
import MapViewSvg2d from './MapViewSvg2d';
import MapViewToolOverlay from './MapViewToolOverlay';
import MapViewControls from './MapViewControls';
import { MAX_ELLIPSOID_SAMPLES, VIEW_H, VIEW_W } from './mapViewConstants';

type Svg2dProps = React.ComponentProps<typeof MapViewSvg2d>;
type Scene3dProps = React.ComponentProps<typeof MapViewScene3d>;
type ToolOverlayProps = React.ComponentProps<typeof MapViewToolOverlay>;
type ContextMenuProps = React.ComponentProps<typeof MapViewContextMenu>;

export interface MapViewContentProps {
  activeTool: MapToolPanel;
  basemapCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  canShowInputPointHint: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  contextMenuOpen: boolean;
  contextMenuRef: React.RefObject<HTMLDivElement | null>;
  contextMenuProps: ContextMenuProps;
  derivedView2d: { zoom: number; panX: number; panY: number };
  effectiveMode: '2d' | '3d';
  fallbackReason: string | null;
  geometryCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  handleMouseDown: React.MouseEventHandler<SVGSVGElement>;
  handleMouseUp: React.MouseEventHandler<SVGSVGElement>;
  handleSvgClick: React.MouseEventHandler<SVGSVGElement>;
  handleWheel: React.WheelEventHandler<SVGSVGElement>;
  inputPointsLoaded: boolean;
  interactionPhase: MapInteractionPhase;
  isDragging: boolean;
  isPreanalysis: boolean;
  mapDensitySummary: {
    dense: boolean;
    labelTotal: number;
    lineSuppressed: number;
  };
  filteredVisiblePointCount: number;
  mode: '2d' | '3d';
  onLoadInputPoints: (() => void) | null;
  onPlanningMapChange?: (_value: PlanningMapState) => void;
  openContextMenu: React.MouseEventHandler<SVGSVGElement>;
  planningCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  planningMap: PlanningMapState;
  renderSurfaceLayout: RenderSurfaceLayout;
  renderSurfaceRef: React.RefObject<HTMLDivElement | null>;
  renderer2d: 'canvas' | 'webgl';
  scene3dProps: Scene3dProps | null;
  selectedPlanningPolygonIds: string[];
  showLabels: boolean;
  setShowLabels: (_value: boolean) => void;
  hideMinorGeometry: boolean;
  setHideMinorGeometry: (_value: boolean) => void;
  focusSelection: boolean;
  setFocusSelection: (_value: boolean) => void;
  showTransformToggle: boolean;
  setShowTransformedCoordinates: (_value: boolean) => void;
  svg2dProps: Svg2dProps;
  svgRef: React.RefObject<SVGSVGElement | null>;
  toolOverlayProps: ToolOverlayProps | null;
  toolPickTarget: unknown;
  transformedOverlayActive: boolean;
  transformedOverlayConfig: {
    available: boolean;
    reason?: string;
    referenceStationId?: string | null;
    scope: 'all' | 'selected';
    scaleEnabled: boolean;
    scaleFactor: number;
    rotationEnabled: boolean;
    rotationAngleDeg: number;
    translationEnabled: boolean;
    translationMethod: string;
    translationAzimuthDeg: number;
    translationDistanceM: number;
  };
  unitScale: number;
  units: 'm' | 'ft';
  view2d: { zoom: number; panX: number; panY: number };
  webglCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  webglEligible: boolean;
  applyCubeView: (_preset: 'iso' | 'top' | 'front' | 'right') => void;
  clearDraftBlockedPolygon: () => void;
  commitDraftBlockedPolygon: () => void;
  draftBlockedPolygonLength: number;
  removePlanningPolygon: (_polygonId: string, _source: 'user' | 'osm') => void;
  removeSelectedPlanningPolygons: () => void;
}

const MapViewContent = ({
  activeTool,
  basemapCanvasRef,
  canShowInputPointHint,
  containerRef,
  contextMenuOpen,
  contextMenuRef,
  contextMenuProps,
  derivedView2d,
  effectiveMode,
  fallbackReason,
  filteredVisiblePointCount,
  focusSelection,
  geometryCanvasRef,
  handleMouseDown,
  handleMouseUp,
  handleSvgClick,
  handleWheel,
  hideMinorGeometry,
  inputPointsLoaded,
  interactionPhase,
  isDragging,
  isPreanalysis,
  mapDensitySummary,
  mode,
  onLoadInputPoints,
  onPlanningMapChange,
  openContextMenu,
  planningCanvasRef,
  planningMap,
  renderSurfaceLayout,
  renderSurfaceRef,
  renderer2d,
  scene3dProps,
  selectedPlanningPolygonIds,
  setFocusSelection,
  setHideMinorGeometry,
  setShowLabels,
  setShowTransformedCoordinates,
  showLabels,
  showTransformToggle,
  svg2dProps,
  svgRef,
  toolOverlayProps,
  toolPickTarget,
  transformedOverlayActive,
  transformedOverlayConfig,
  unitScale,
  units,
  view2d,
  webglCanvasRef,
  webglEligible,
  applyCubeView,
  clearDraftBlockedPolygon,
  commitDraftBlockedPolygon,
  draftBlockedPolygonLength,
  removePlanningPolygon,
  removeSelectedPlanningPolygons,
}: MapViewContentProps) => (
  <div className="h-full p-4 flex flex-col min-h-0">
    <MapViewControls
      effectiveMode={effectiveMode}
      fallbackReason={fallbackReason}
      filteredVisiblePointCount={filteredVisiblePointCount}
      focusSelection={focusSelection}
      hideMinorGeometry={hideMinorGeometry}
      inputPointsLoaded={inputPointsLoaded}
      isPreanalysis={isPreanalysis}
      mapDensitySummary={mapDensitySummary}
      mode={mode}
      onLoadInputPoints={onLoadInputPoints}
      onPlanningMapChange={onPlanningMapChange}
      planningMap={planningMap}
      selectedPlanningPolygonIds={selectedPlanningPolygonIds}
      setFocusSelection={setFocusSelection}
      setHideMinorGeometry={setHideMinorGeometry}
      setShowLabels={setShowLabels}
      setShowTransformedCoordinates={setShowTransformedCoordinates}
      showLabels={showLabels}
      showTransformToggle={showTransformToggle}
      transformedOverlayActive={transformedOverlayActive}
      transformedOverlayConfig={transformedOverlayConfig}
      unitScale={unitScale}
      units={units}
      clearDraftBlockedPolygon={clearDraftBlockedPolygon}
      commitDraftBlockedPolygon={commitDraftBlockedPolygon}
      draftBlockedPolygonLength={draftBlockedPolygonLength}
      removePlanningPolygon={removePlanningPolygon}
      removeSelectedPlanningPolygons={removeSelectedPlanningPolygons}
    />    <div
      ref={containerRef}
      data-map-interaction-phase={interactionPhase}
      data-map-renderer={effectiveMode === '2d' ? renderer2d : 'svg-3d'}
      data-map-view-zoom={view2d.zoom.toFixed(6)}
      data-map-view-pan-x={view2d.panX.toFixed(6)}
      data-map-view-pan-y={view2d.panY.toFixed(6)}
      data-map-derived-view-zoom={derivedView2d.zoom.toFixed(6)}
      data-map-derived-view-pan-x={derivedView2d.panX.toFixed(6)}
      data-map-derived-view-pan-y={derivedView2d.panY.toFixed(6)}
      className="bg-slate-900 border-y border-slate-800 rounded overflow-hidden flex-1 min-h-0 relative"
    >
      <div
        ref={renderSurfaceRef}
        className="absolute"
        style={{
          width: `${renderSurfaceLayout.width}px`,
          height: `${renderSurfaceLayout.height}px`,
          left: `${renderSurfaceLayout.left}px`,
          top: `${renderSurfaceLayout.top}px`,
        }}
      >
        {effectiveMode === '2d' && (
          <>
            {renderer2d === 'canvas' && (
              <canvas
                ref={basemapCanvasRef}
                data-testid="map-base-canvas"
                className="absolute inset-0 z-0 h-full w-full pointer-events-none"
              />
            )}
            <canvas
              ref={planningCanvasRef}
              data-testid="map-planning-canvas"
              className="absolute inset-0 z-10 h-full w-full pointer-events-none"
            />
            {webglEligible && (
              <canvas
                ref={webglCanvasRef}
                data-testid="map-webgl-canvas"
                className={`absolute inset-0 z-20 h-full w-full pointer-events-none ${
                  renderer2d === 'webgl' ? '' : 'hidden'
                }`}
              />
            )}
            {renderer2d === 'canvas' && (
              <canvas
                ref={geometryCanvasRef}
                data-testid="map-geometry-canvas"
                className="absolute inset-0 z-20 h-full w-full pointer-events-none"
              />
            )}
          </>
        )}
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid slice"
          shapeRendering={interactionPhase === 'interacting' ? 'optimizeSpeed' : 'geometricPrecision'}
          className={`absolute inset-0 z-30 h-full w-full select-none ${
            toolPickTarget != null
              ? 'cursor-crosshair'
              : isDragging
                ? 'cursor-grabbing'
                : effectiveMode === '3d'
                  ? 'cursor-grab'
                  : 'cursor-default'
          }`}
          onWheel={handleWheel}
          onClick={handleSvgClick}
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onContextMenu={openContextMenu}
        >
          {effectiveMode === '2d' && <MapViewSvg2d {...svg2dProps} />}
          {effectiveMode === '3d' && scene3dProps && (
            <MapViewScene3d {...scene3dProps} maxEllipsoidSamples={MAX_ELLIPSOID_SAMPLES} />
          )}
          {canShowInputPointHint && (
            <>
              <text x={VIEW_W / 2} y={VIEW_H / 2 - 18} textAnchor="middle" fill="#94a3b8" fontSize={18}>
                No stations to display
              </text>
              {onLoadInputPoints && (
                <text x={VIEW_W / 2} y={VIEW_H / 2 + 12} textAnchor="middle" fill="#f9a8d4" fontSize={13}>
                  Use "Load points" to populate the planning map before the first run.
                </text>
              )}
            </>
          )}
        </svg>
      </div>
      {effectiveMode === '3d' && <MapViewCubeControls onApplyCubeView={applyCubeView} />}
      {contextMenuOpen && (
        <div ref={contextMenuRef} className="pointer-events-none absolute inset-0 z-[70]">
          <MapViewContextMenu {...contextMenuProps} />
        </div>
      )}
      {activeTool !== 'none' && toolOverlayProps && <MapViewToolOverlay {...toolOverlayProps} />}
      {effectiveMode === '2d' && planningMap.basemapMode === 'osm' && (
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="pointer-events-auto absolute bottom-2 right-2 rounded bg-slate-950/75 px-2 py-1 text-[10px] text-slate-300 hover:text-white"
        >
          Basemap © OpenStreetMap contributors
        </a>
      )}
      {effectiveMode === '2d' && (
        <div
          data-testid="map-renderer-badge"
          className="pointer-events-none absolute bottom-2 left-2 rounded bg-slate-950/75 px-2 py-1 text-[10px] text-slate-300"
        >
          {renderer2d === 'webgl' ? 'Renderer: WebGL2' : 'Renderer: Canvas fallback'}
          {mapDensitySummary.dense ? ' | Dense overlay' : ' | Normal overlay'}
        </div>
      )}
    </div>
  </div>
);

const MapViewCubeControls = ({
  onApplyCubeView,
}: {
  onApplyCubeView: (_preset: 'iso' | 'top' | 'front' | 'right') => void;
}) => (
  <div className="absolute right-2 top-2 z-10 rounded border border-slate-700/80 bg-slate-900/85 p-1">
    <div className="grid grid-cols-2 gap-1 text-[10px]">
      {(['iso', 'top', 'front', 'right'] as const).map((preset) => (
        <button
          key={preset}
          type="button"
          onClick={() => onApplyCubeView(preset)}
          className="rounded bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
        >
          {preset.toUpperCase()}
        </button>
      ))}
    </div>
  </div>
);

export default MapViewContent;

