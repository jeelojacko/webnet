/* eslint-disable react-refresh/only-export-components -- dev-only browser harness, no fast refresh */
import React, { useMemo } from 'react';
import { createRoot } from 'react-dom/client';

import { solveEngine } from '../engine/solveEngine';
import {
  buildSuspectImpactRows,
  collectSuspectImpactCandidates,
} from '../engine/suspectImpactShared';
import type { AdjustmentResult } from '../types';
import ObservationTableSection from '../components/report/ObservationTableSection';
import { ReportSuspectImpactSection } from '../components/report/ReportSuspectImpactSection';

/** Realistic terrestrial job with a redundant outlier distance (suspect). */
const OUTLIER_INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.033 0.01',
  'D B-P 64.031 0.01',
  'D A-P 64.029 0.01',
  'D B-P 64.033 0.01',
  'A P-A-B 102-40-02 1.0',
  'D A-P 64.631 0.01',
].join('\n');

const tableProps = {
  unitScale: 1,
  units: 'm' as const,
  excludedIds: new Set<number>(),
  autoSideshotObsIds: new Set<number>(),
  onToggleExclude: () => {},
  rowSelectionClass: (selected: boolean) => (selected ? 'bg-blue-900/40' : ''),
  visibleRowsFor: ((_key: string, rows: unknown[]) => rows) as <T>(
    _key: string,
    _rows: T[],
    _defaultSize?: number,
  ) => T[],
  showMoreRows: () => {},
  showAllRows: () => {},
  renderSourceLineLink: (line: number | null | undefined) => String(line ?? '-'),
  isSectionCollapsed: () => false,
  isDetailSectionPinned: () => false,
  toggleDetailSection: () => {},
  togglePinnedDetailSection: () => {},
  formatMdb: (value: number) => (Number.isFinite(value) ? value.toFixed(3) : '-'),
  prismAnnotation: () => '',
};

const stripDatum = (base: AdjustmentResult): AdjustmentResult => ({
  ...base,
  controlConstraints: { count: 0, x: 0, y: 0, h: 0 },
  stations: Object.fromEntries(
    Object.entries(base.stations).map(([id, station]) => [
      id,
      { ...station, fixed: false, fixedX: false, fixedY: false, fixedH: false },
    ]),
  ),
});

const CaseBlock: React.FC<{
  testId: string;
  title: string;
  input: string;
  freeNetwork?: boolean;
}> = ({ testId, title, input, freeNetwork = false }) => {
  const { result, rows } = useMemo(() => {
    const solved = solveEngine({ input, maxIterations: 8 }) as unknown as AdjustmentResult;
    const candidates = collectSuspectImpactCandidates(solved);
    // Free-network terrestrial jobs do not converge on their own; reuse the
    // converging alternates against a datum-stripped base so the genuine
    // free-network-unavailable branch renders with real statistics.
    const base = freeNetwork ? stripDatum(solved) : solved;
    const looRows =
      candidates.length === 0
        ? []
        : buildSuspectImpactRows({
            base,
            candidates,
            baseExclusions: new Set<number>(),
            analysisMode: 'auto',
            robustReSolve: false,
            solveAlt: (exclusions) =>
              solveEngine({ input, maxIterations: 8, excludeIds: exclusions }),
          });
    return { result: solved, rows: looRows };
  }, [input, freeNetwork]);
  const selectedId = rows.length > 0 ? rows[0].obsId : null;
  return (
    <div data-testid={testId} className="mb-8">
      <h2 className="text-sm font-bold text-slate-100 mb-2">{title}</h2>
      <ObservationTableSection
        {...tableProps}
        obsList={result.observations}
        title="Observations"
        selectedObservationId={selectedId}
        onSelectObservation={() => {}}
        localTestSummary={result.localTestSummary}
        reliabilitySummary={result.reliabilitySummary}
        suspectImpactRows={rows}
      />
      <ReportSuspectImpactSection
        excludedIds={new Set<number>()}
        isDetailSectionPinned={() => false}
        isPreanalysis={false}
        isSectionCollapsed={() => false}
        isSpecialRunMode={false}
        onApplyImpactExclude={() => {}}
        onHeaderRef={() => {}}
        renderSourceLineLink={(line) => String(line ?? '-')}
        suspectImpactActionableCount={rows.filter((r) => r.status === 'ok').length}
        suspectImpactDiagnostics={rows}
        suspectImpactExcludedCount={0}
        suspectImpactWorstBaseStdRes={rows.reduce(
          (max, r) => Math.max(max, Math.abs(r.baseStdRes ?? 0)),
          0,
        )}
        toggleDetailSection={() => {}}
        togglePinnedDetailSection={() => {}}
        unitScale={1}
        units="m"
      />
    </div>
  );
};

const Harness: React.FC = () => (
  <div className="min-h-screen bg-slate-950 text-slate-100 p-4">
    <div data-testid="split-pane" style={{ width: '60%' }}>
      <CaseBlock testId="case-outlier" title="Terrestrial job with suspect" input={OUTLIER_INPUT} />
      <CaseBlock
        testId="case-free-network"
        title="Free-network datum (datum stripped, statistics kept)"
        input={OUTLIER_INPUT}
        freeNetwork
      />
    </div>
    <div data-testid="loo-harness-ready">ready</div>
  </div>
);

createRoot(document.getElementById('root')!).render(<Harness />);
