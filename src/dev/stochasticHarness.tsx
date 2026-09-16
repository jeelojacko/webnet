/* eslint-disable react-refresh/only-export-components -- dev-only browser harness, no fast refresh */
import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { solveEngine } from '../engine/solveEngine';
import { DEFAULT_INPUT } from '../defaultInput';
import type { AdjustmentResult } from '../types';
import ObservationTableSection from '../components/report/ObservationTableSection';
import { StochasticDiagnosticsSection } from '../components/report/ReportRunSummarySections';

/** Failed-chi-square synthetic: redundant outlier distance inflates vTPv. */
const FAILED_CHI_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

const solve = (input: string): AdjustmentResult =>
  solveEngine({
    input,
    maxIterations: 8,
    parseOptions: { coordMode: '2D', units: 'm' },
  }) as unknown as AdjustmentResult;

const CaseBlock: React.FC<{ testId: string; title: string; result: AdjustmentResult }> = ({
  testId,
  title,
  result,
}) => (
  <div data-testid={testId} className="mb-8">
    <h2 className="text-sm font-bold text-slate-100 mb-2">{title}</h2>
    <StochasticDiagnosticsSection
      isDataCheck={false}
      isPreanalysis={false}
      isSpecialRunMode={false}
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
  const terrestrial = useMemo(() => solve(DEFAULT_INPUT), []);
  const failedChi = useMemo(() => solve(FAILED_CHI_INPUT), []);
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4">
      {/* Mimic the report/map split pane: report column at ~60% width. */}
      <div data-testid="split-pane" style={{ width: '60%' }}>
        <CaseBlock testId="case-terrestrial" title="Terrestrial job" result={terrestrial} />
        <CaseBlock testId="case-failed-chi" title="Failed chi-square synthetic" result={failedChi} />
      </div>
      <div data-testid="stochastic-harness-ready">ready</div>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Harness />);
