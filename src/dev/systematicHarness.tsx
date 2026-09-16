/* eslint-disable react-refresh/only-export-components -- dev-only browser harness, no fast refresh */
import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { LSAEngine } from '../engine/adjust';
import { buildSystematicDiagnostics } from '../engine/systematicPatternDiagnostics';
import type { AdjustmentResult, Observation } from '../types';
import ObservationTableSection from '../components/report/ObservationTableSection';
import SystematicPatternSection from '../components/report/SystematicPatternSection';

/** Combined terrestrial job: distances + face-paired direction sets, no leveling. */
const TERRESTRIAL_INPUT = [
  '.2D',
  'C O 0 0 0 !',
  'C BS 0 100 0 !',
  'C P 100 0 0',
  'C Q 120 40 0',
  'D O-P 100.000 0.003',
  'D O-Q 126.491 0.003',
  'D BS-P 141.421 0.003',
  'D BS-Q 134.164 0.003',
  'DB O BS',
  'DM P 090-00-00.0 100.000 090-00-00.0 1.0 0.003',
  'DM P 090-00-08.0 100.000 090-00-00.0 1.0 0.003',
  'DM P 270-00-03.0 100.000 270-00-00.0 1.0 0.003',
  'DM P 270-00-14.0 100.000 270-00-00.0 1.0 0.003',
  'DM Q 108-26-06.0 126.491 090-00-00.0 1.0 0.003',
  'DM Q 288-26-09.0 126.491 270-00-00.0 1.0 0.003',
  'DE',
].join('\n');

const solveTerrestrial = (): AdjustmentResult =>
  new LSAEngine({
    input: TERRESTRIAL_INPUT,
    maxIterations: 12,
    parseOptions: { parseCompatibilityMode: 'strict', faceNormalizationMode: 'on' },
  }).solve() as unknown as AdjustmentResult;

let nextId = 5000;
const distObs = (lenM: number, residual: number): Observation =>
  ({
    id: nextId++,
    type: 'dist',
    subtype: 'ts',
    instCode: 'T1',
    from: 'A',
    to: 'P',
    obs: lenM,
    stdDev: 0.005,
    residual,
    stdRes: residual / 0.005,
  }) as unknown as Observation;

const levObs = (residual: number, line: number): Observation =>
  ({
    id: nextId++,
    type: 'lev',
    instCode: 'L1',
    from: 'A',
    to: 'B',
    obs: 1.0,
    lenKm: 0.02,
    stdDev: 0.002,
    residual,
    stdRes: residual / 0.002,
    sourceLine: line,
  }) as unknown as Observation;

const CaseBlock: React.FC<{ testId: string; title: string; result: AdjustmentResult }> = ({
  testId,
  title,
  result,
}) => (
  <div data-testid={testId} className="mb-8">
    <h2 className="text-sm font-bold text-slate-100 mb-2">{title}</h2>
    <SystematicPatternSection
      isDataCheck={false}
      isPreanalysis={false}
      renderSourceLineLink={(line) => (
        <a href={`#line-${line ?? 'na'}`} data-testid={`srcline-${line ?? 'na'}`}>
          {line ?? '-'}
        </a>
      )}
      result={result}
    />
    <ObservationTableSection
      obsList={result.observations}
      title="Observations"
      unitScale={1}
      excludedIds={new Set<number>()}
      autoSideshotObsIds={new Set<number>()}
      selectedObservationId={null}
      onToggleExclude={() => {}}
      rowSelectionClass={() => ''}
      visibleRowsFor={((_key: string, rows: unknown[]) => rows) as <T>(
        _key: string,
        _rows: T[],
        _defaultSize?: number,
      ) => T[]}
      showMoreRows={() => {}}
      showAllRows={() => {}}
      renderSourceLineLink={(line) => String(line ?? '-')}
      isSectionCollapsed={() => false}
      isDetailSectionPinned={() => false}
      toggleDetailSection={() => {}}
      togglePinnedDetailSection={() => {}}
      formatMdb={(value) => (Number.isFinite(value) ? value.toFixed(3) : '-')}
      prismAnnotation={() => ''}
      localTestSummary={result.localTestSummary}
      reliabilitySummary={result.reliabilitySummary}
    />
  </div>
);

const Harness: React.FC = () => {
  const terrestrial = useMemo(() => solveTerrestrial(), []);
  const trend = useMemo(() => {
    const obs: Observation[] = [
      distObs(50, 0.001),
      distObs(120, 0.002),
      distObs(200, 0.002),
      distObs(310, 0.004),
      distObs(420, 0.005),
      distObs(530, 0.006),
      levObs(0.001, 1),
      levObs(-0.002, 2),
      levObs(0.0015, 3),
      levObs(-0.001, 4),
      levObs(0.002, 5),
      levObs(-0.0015, 6),
    ];
    return {
      ...terrestrial,
      systematicDiagnostics: buildSystematicDiagnostics(obs, {}),
    } as AdjustmentResult;
  }, [terrestrial]);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4">
      {/* Mimic the report/map split pane: report column at ~60% width. */}
      <div data-testid="split-pane" style={{ width: '60%' }}>
        <CaseBlock testId="case-terrestrial" title="Terrestrial job" result={terrestrial} />
        <CaseBlock testId="case-trend" title="Trend fixture" result={trend} />
      </div>
      <div data-testid="systematic-harness-ready">ready</div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Harness />);
