import type { PlanningMapState } from '../../types';

interface MapViewControlsProps {
  effectiveMode: '2d' | '3d';
  fallbackReason: string | null;
  filteredVisiblePointCount: number;
  focusSelection: boolean;
  hideMinorGeometry: boolean;
  inputPointsLoaded: boolean;
  isPreanalysis: boolean;
  mapDensitySummary: {
    dense: boolean;
    labelTotal: number;
    lineSuppressed: number;
  };
  mode: '2d' | '3d';
  onLoadInputPoints: (() => void) | null;
  onPlanningMapChange?: (_value: PlanningMapState) => void;
  planningMap: PlanningMapState;
  selectedPlanningPolygonIds: string[];
  setFocusSelection: (_value: boolean) => void;
  setHideMinorGeometry: (_value: boolean) => void;
  setShowLabels: (_value: boolean) => void;
  setShowTransformedCoordinates: (_value: boolean) => void;
  showLabels: boolean;
  showTransformToggle: boolean;
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
  clearDraftBlockedPolygon: () => void;
  commitDraftBlockedPolygon: () => void;
  draftBlockedPolygonLength: number;
  removePlanningPolygon: (_polygonId: string, _source: 'user' | 'osm') => void;
  removeSelectedPlanningPolygons: () => void;
}

const MapViewControls = ({
  effectiveMode,
  fallbackReason,
  filteredVisiblePointCount,
  focusSelection,
  hideMinorGeometry,
  inputPointsLoaded,
  isPreanalysis,
  mapDensitySummary,
  mode,
  onLoadInputPoints,
  onPlanningMapChange,
  planningMap,
  selectedPlanningPolygonIds,
  setFocusSelection,
  setHideMinorGeometry,
  setShowLabels,
  setShowTransformedCoordinates,
  showLabels,
  showTransformToggle,
  transformedOverlayActive,
  transformedOverlayConfig,
  unitScale,
  units,
  clearDraftBlockedPolygon,
  commitDraftBlockedPolygon,
  draftBlockedPolygonLength,
  removePlanningPolygon,
  removeSelectedPlanningPolygons,
}: MapViewControlsProps) => (
  <>
    <div className="flex items-center justify-between mb-3 text-xs text-slate-400 shrink-0">
      <span>
        Map view ({effectiveMode === '2d' ? '2D true-scale' : '3D scaled'}) - coords & ellipses in{' '}
        {units} ({unitScale.toFixed(4)} factor)
      </span>
      <div className="flex items-center gap-3">
        {effectiveMode === '2d' && mapDensitySummary.dense && (
          <span className="text-[11px] text-slate-500">
            Dense view: labels {mapDensitySummary.labelTotal}/{filteredVisiblePointCount}
            {mapDensitySummary.lineSuppressed > 0
              ? `, clipped links ${mapDensitySummary.lineSuppressed}`
              : ''}
          </span>
        )}
        <span className="text-slate-500">
          {effectiveMode === '3d'
            ? 'Left-drag=orbit, middle-drag=pan, wheel=zoom, middle-double-click=reset'
            : 'Wheel=zoom, middle-drag=pan, middle-double-click=reset extents'}
          {'; right-click=tools'}
        </span>
      </div>
    </div>
    {effectiveMode === '2d' && (
      <div className="mb-2 flex flex-wrap items-center gap-3 rounded border border-slate-700/80 bg-slate-900/75 px-3 py-2 text-[11px] text-slate-200">
        <MapToggle checked={showLabels} onChange={setShowLabels} label="Show labels" />
        <MapToggle
          checked={hideMinorGeometry}
          onChange={setHideMinorGeometry}
          label="Hide minor geometry"
        />
        <MapToggle checked={focusSelection} onChange={setFocusSelection} label="Focus selection" />
        <div className="ml-2 h-4 w-px bg-slate-700" />
        <MapToggle
          checked={planningMap.basemapMode === 'osm'}
          onChange={(checked) =>
            onPlanningMapChange?.({ ...planningMap, basemapMode: checked ? 'osm' : 'none' })
          }
          label="OSM basemap"
          accent="pink"
        />
        {onLoadInputPoints && (
          <button
            type="button"
            onClick={onLoadInputPoints}
            className="rounded border border-slate-600 px-2 py-1 uppercase tracking-wide text-slate-100 hover:border-pink-300"
          >
            {inputPointsLoaded ? 'Reload points' : 'Load points'}
          </button>
        )}
        <MapToggle
          checked={planningMap.showInputPoints}
          onChange={(checked) => onPlanningMapChange?.({ ...planningMap, showInputPoints: checked })}
          label="Input points"
          accent="pink"
        />
        <MapToggle
          checked={planningMap.showObstacleLayer}
          onChange={(checked) =>
            onPlanningMapChange?.({ ...planningMap, showObstacleLayer: checked })
          }
          label="Obstacles"
          accent="pink"
        />
        <MapToggle
          checked={planningMap.showBlockedAreas}
          onChange={(checked) =>
            onPlanningMapChange?.({ ...planningMap, showBlockedAreas: checked })
          }
          label="Blocked areas"
          accent="pink"
        />
        <button
          type="button"
          onClick={() =>
            onPlanningMapChange?.({ ...planningMap, blockEditMode: !planningMap.blockEditMode })
          }
          className={`rounded border px-2 py-1 uppercase tracking-wide ${
            planningMap.blockEditMode
              ? 'border-pink-300 text-pink-100 bg-pink-950/30'
              : 'border-slate-600 text-slate-200'
          }`}
        >
          {planningMap.blockEditMode ? 'Stop draw' : 'Draw block'}
        </button>
        {draftBlockedPolygonLength > 0 && (
          <>
            <button
              type="button"
              onClick={commitDraftBlockedPolygon}
              disabled={draftBlockedPolygonLength < 3}
              className="rounded border border-pink-400 px-2 py-1 uppercase tracking-wide text-pink-100 disabled:border-slate-700 disabled:text-slate-500"
            >
              Finish block
            </button>
            <button
              type="button"
              onClick={clearDraftBlockedPolygon}
              className="rounded border border-slate-600 px-2 py-1 uppercase tracking-wide"
            >
              Cancel draft
            </button>
          </>
        )}
        {planningMap.blockedPolygons.length > 0 && (
          <button
            type="button"
            onClick={() => onPlanningMapChange?.({ ...planningMap, blockedPolygons: [] })}
            className="rounded border border-slate-600 px-2 py-1 uppercase tracking-wide"
          >
            Clear blocks
          </button>
        )}
      </div>
    )}
    {effectiveMode === '2d' && planningMap.blockedPolygons.length > 0 && (
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-slate-800/70 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-300">
        <span className="uppercase tracking-wide text-slate-500">Blocked polygons</span>
        {selectedPlanningPolygonIds.length > 1 && (
          <button
            type="button"
            onClick={removeSelectedPlanningPolygons}
            className="rounded border border-pink-400 px-2 py-1 text-pink-100 hover:bg-pink-950/30"
          >
            Delete {selectedPlanningPolygonIds.length} selected
          </button>
        )}
        {planningMap.blockedPolygons.map((polygon) => (
          <button
            key={polygon.id}
            type="button"
            onClick={() => removePlanningPolygon(polygon.id, 'user')}
            className="rounded border border-slate-700 px-2 py-1 text-slate-200 hover:bg-slate-800"
          >
            Delete {polygon.label || polygon.id}
          </button>
        ))}
      </div>
    )}
    {showTransformToggle && (
      <div className="mb-2 flex flex-wrap items-center gap-3 rounded border border-slate-700/80 bg-slate-900/75 px-3 py-2 text-[11px] text-slate-200">
        <MapToggle
          checked={transformedOverlayActive}
          onChange={setShowTransformedCoordinates}
          label="Show transformed coordinates"
          disabled={!transformedOverlayConfig.available || effectiveMode !== '2d'}
        />
        <span className="text-slate-400">
          Ref {transformedOverlayConfig.referenceStationId || '-'}; scope{' '}
          {transformedOverlayConfig.scope === 'all' ? 'all points' : 'selected + reference'}; order
          scale-&gt;rotate-&gt;translate
          {transformedOverlayConfig.scaleEnabled &&
            `; k=${transformedOverlayConfig.scaleFactor.toFixed(6)}`}
          {transformedOverlayConfig.rotationEnabled &&
            `; rot=${transformedOverlayConfig.rotationAngleDeg.toFixed(6)}deg`}
          {transformedOverlayConfig.translationEnabled &&
            `; tr=${transformedOverlayConfig.translationMethod}, az=${transformedOverlayConfig.translationAzimuthDeg.toFixed(6)}deg, d=${(transformedOverlayConfig.translationDistanceM * unitScale).toFixed(4)} ${units}`}
        </span>
        {!transformedOverlayConfig.available && transformedOverlayConfig.reason && (
          <span className="text-amber-300">{transformedOverlayConfig.reason}</span>
        )}
        {effectiveMode !== '2d' && transformedOverlayConfig.available && (
          <span className="text-slate-400">2D map mode required for transformed overlay.</span>
        )}
      </div>
    )}
    {mode === '3d' && fallbackReason && (
      <div className="mb-2 rounded border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-[11px] text-amber-200">
        3D rendering fallback: {fallbackReason}. Showing 2D map for stable performance.
      </div>
    )}
    {isPreanalysis && (
      <div className="mb-2 rounded border border-cyan-900/60 bg-cyan-950/20 px-3 py-2 text-[11px] text-cyan-100">
        Preanalysis map: predicted ellipses use sigma0^2 = 1.0. Weak-geometry cues are highlighted
        in amber/red on non-fixed stations.
      </div>
    )}
  </>
);

interface MapToggleProps {
  checked: boolean;
  disabled?: boolean;
  label: string;
  accent?: 'cyan' | 'pink';
  onChange: (_checked: boolean) => void;
}

const MapToggle = ({
  checked,
  disabled = false,
  label,
  accent = 'cyan',
  onChange,
}: MapToggleProps) => (
  <label className="inline-flex items-center gap-2">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className={`h-3.5 w-3.5 rounded border-slate-500 bg-slate-950 ${
        accent === 'pink' ? 'text-pink-300 focus:ring-pink-400' : 'text-cyan-400 focus:ring-cyan-500'
      }`}
    />
    <span className="uppercase tracking-wide">{label}</span>
  </label>
);

export default MapViewControls;
