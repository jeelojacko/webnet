import React, { useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

import MapView from '../components/MapView';
import { DEFAULT_INPUT } from '../defaultInput';
import { LSAEngine } from '../engine/adjust';
import { DEFAULT_PLANNING_MAP_STATE } from '../engine/planningMapState';
import { INDUSTRY_PARITY_CASES } from '../industryParityCases';
import type { AdjustmentResult, PlanningMapState } from '../types';

const startup = INDUSTRY_PARITY_CASES.campDesignPreanalysis.startupDefaults;

const buildHarnessResult = (): AdjustmentResult =>
  new LSAEngine({
    input: DEFAULT_INPUT,
    maxIterations: startup?.settingsPatch.maxIterations ?? 10,
    convergenceThreshold: startup?.settingsPatch.convergenceLimit ?? 0.01,
    parseOptions: {
      ...(startup?.parseSettingsPatch ?? {}),
    },
  }).solve();

const buildHarnessPlanningMap = (result: AdjustmentResult): PlanningMapState => {
  const snapshots = result.parseState?.inputStationSnapshots ?? [];
  const xs = snapshots.map((snapshot) => snapshot.x);
  const ys = snapshots.map((snapshot) => snapshot.y);
  const minX = xs.length > 0 ? Math.min(...xs) : 0;
  const maxX = xs.length > 0 ? Math.max(...xs) : 100;
  const minY = ys.length > 0 ? Math.min(...ys) : 0;
  const maxY = ys.length > 0 ? Math.max(...ys) : 100;
  const width = Math.max(20, maxX - minX);
  const height = Math.max(20, maxY - minY);
  const centerX = (minX + maxX) * 0.5;
  const centerY = (minY + maxY) * 0.5;
  const makeRect = (
    id: string,
    source: 'user' | 'osm',
    kind: 'blocked-area' | 'building' | 'wooded',
    label: string,
    rectCenterX: number,
    rectCenterY: number,
    rectWidth: number,
    rectHeight: number,
  ) => ({
    id,
    source,
    kind,
    label,
    vertices: [
      { x: rectCenterX - rectWidth * 0.5, y: rectCenterY - rectHeight * 0.5 },
      { x: rectCenterX + rectWidth * 0.5, y: rectCenterY - rectHeight * 0.5 },
      { x: rectCenterX + rectWidth * 0.5, y: rectCenterY + rectHeight * 0.5 },
      { x: rectCenterX - rectWidth * 0.5, y: rectCenterY + rectHeight * 0.5 },
    ],
  });
  return {
    ...DEFAULT_PLANNING_MAP_STATE,
    basemapMode: 'none',
    showInputPoints: true,
    showObstacleLayer: true,
    showBlockedAreas: true,
    blockedPolygons: [
      makeRect(
        'harness-block-1',
        'user',
        'blocked-area',
        'Harness block 1',
        centerX - width * 0.18,
        centerY + height * 0.12,
        width * 0.12,
        height * 0.1,
      ),
      makeRect(
        'harness-block-2',
        'user',
        'blocked-area',
        'Harness block 2',
        centerX + width * 0.2,
        centerY - height * 0.16,
        width * 0.1,
        height * 0.08,
      ),
    ],
    obstaclePolygons: [
      makeRect(
        'harness-building-1',
        'osm',
        'building',
        'Harness building 1',
        centerX + width * 0.04,
        centerY + height * 0.04,
        width * 0.16,
        height * 0.14,
      ),
      makeRect(
        'harness-wooded-1',
        'osm',
        'wooded',
        'Harness wooded 1',
        centerX - width * 0.28,
        centerY - height * 0.18,
        width * 0.2,
        height * 0.18,
      ),
    ],
  };
};

export const HarnessApp: React.FC = () => {
  const result = useMemo(() => buildHarnessResult(), []);
  const [showLabels, setShowLabels] = useState(true);
  const [planningMap, setPlanningMap] = useState<PlanningMapState>(() => buildHarnessPlanningMap(result));

  if (!result.success) {
    return (
      <pre
        data-testid="map-pan-harness-error"
        style={{ color: '#fecaca', padding: 16, whiteSpace: 'pre-wrap' }}
      >
        {result.logs.join('\n')}
      </pre>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#020617',
        color: '#e2e8f0',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }}
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 12,
          alignItems: 'center',
          padding: '10px 12px',
          borderBottom: '1px solid rgba(148,163,184,0.22)',
          background: 'rgba(15,23,42,0.9)',
          fontSize: 12,
        }}
      >
        <strong data-testid="map-pan-harness-ready">ready</strong>
        <label>
          <input
            data-testid="toggle-labels"
            type="checkbox"
            checked={showLabels}
            onChange={(event) => setShowLabels(event.target.checked)}
          />{' '}
          labels
        </label>
        <label>
          <input
            data-testid="toggle-osm"
            type="checkbox"
            checked={planningMap.basemapMode === 'osm'}
            onChange={(event) =>
              setPlanningMap((current) => ({
                ...current,
                basemapMode: event.target.checked ? 'osm' : 'none',
              }))
            }
          />{' '}
          osm
        </label>
        <label>
          <input
            data-testid="toggle-input-points"
            type="checkbox"
            checked={planningMap.showInputPoints}
            onChange={(event) =>
              setPlanningMap((current) => ({
                ...current,
                showInputPoints: event.target.checked,
              }))
            }
          />{' '}
          input points
        </label>
        <label>
          <input
            data-testid="toggle-obstacles"
            type="checkbox"
            checked={planningMap.showObstacleLayer}
            onChange={(event) =>
              setPlanningMap((current) => ({
                ...current,
                showObstacleLayer: event.target.checked,
              }))
            }
          />{' '}
          obstacles
        </label>
        <label>
          <input
            data-testid="toggle-blocked"
            type="checkbox"
            checked={planningMap.showBlockedAreas}
            onChange={(event) =>
              setPlanningMap((current) => ({
                ...current,
                showBlockedAreas: event.target.checked,
              }))
            }
          />{' '}
          blocked areas
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0, padding: 8 }}>
        <MapView
          key={`labels:${showLabels}`}
          result={result}
          units="m"
          planningMap={planningMap}
          onPlanningMapChange={setPlanningMap}
          inputPointsLoaded={true}
          snapshot={{
            view2d: { zoom: 1, panX: 0, panY: 0 },
            camera3d: null,
            activeTool: 'none',
            inverseFromInput: '',
            inverseToInput: '',
            anglePivotInput: '',
            angleFromInput: '',
            angleToInput: '',
            showTransformedCoordinates: false,
            showLabels,
            hideMinorGeometry: false,
            focusSelection: false,
          }}
        />
      </div>
    </div>
  );
};

const rootNode = document.getElementById('root');
if (!rootNode) {
  throw new Error('map pan harness root not found');
}

createRoot(rootNode).render(
  <React.StrictMode>
    <HarnessApp />
  </React.StrictMode>,
);
