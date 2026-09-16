import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { solveEngine } from '../src/engine/solveEngine';
import { appendLeaveOneOutInfluenceSection } from '../src/engine/runResultsTextLeaveOneOut';
import type { AdjustmentResult } from '../src/types';
import type { SuspectImpactRow } from '../src/typesAdjustmentResult';
import ObservationTableSection from '../src/components/report/ObservationTableSection';
import { ReportSuspectImpactSection } from '../src/components/report/ReportSuspectImpactSection';

const INPUT = [
  '.2D',
  'C A 0 0 0 ! !',
  'C B 100 0 0 ! !',
  'C P 50 40 0',
  'D A-P 64.031 0.01',
  'D B-P 64.031 0.01',
  'A P-A-B 102-40-00.0 1.0',
  'D A-P 64.071 0.01',
].join('\n');

const okRow: SuspectImpactRow = {
  obsId: 7,
  type: 'dist',
  stations: 'A-P',
  sourceLine: 8,
  baseStdRes: 2.44,
  baseLocalFail: true,
  baseSeuw: 1.5234,
  altSeuw: 1.0102,
  deltaSeuw: -0.5132,
  baseMaxStdRes: 2.44,
  altMaxStdRes: 1.1,
  deltaMaxStdRes: -1.34,
  baseChiPass: false,
  altChiPass: true,
  baseChi: { T: 12.345, dof: 4, p: 0.0153, pass: false },
  altChi: { T: 3.21, dof: 3, p: 0.3602, pass: true },
  chiDelta: 'improved',
  baseLocalFails: 1,
  altLocalFails: 0,
  baseDof: 4,
  altDof: 3,
  baseObsCount: 4,
  altObsCount: 3,
  mostAffectedStation: { id: 'P', dE: 0.004, dN: -0.002, dH: 0, horiz: 0.004472, vert: 0, mag3d: 0.004472 },
  topAffectedStations: [
    { id: 'P', dE: 0.004, dN: -0.002, dH: 0, horiz: 0.004472, vert: 0, mag3d: 0.004472 },
  ],
  maxCoordShift: 0.004472,
  shiftStatus: 'available',
  status: 'ok',
  failureReason: 'none',
  analysisMode: 'auto',
  robustReSolve: false,
};

const freeNetworkRow: SuspectImpactRow = {
  ...okRow,
  obsId: 4,
  shiftStatus: 'free-network-unavailable',
  mostAffectedStation: null,
  topAffectedStations: [],
  maxCoordShift: undefined,
};

const failedRow: SuspectImpactRow = {
  ...okRow,
  obsId: 5,
  status: 'failed',
  failureReason: 'singular',
  altSeuw: undefined,
  altChi: undefined,
  mostAffectedStation: null,
  topAffectedStations: [],
  maxCoordShift: undefined,
};

const robustRow: SuspectImpactRow = { ...okRow, obsId: 6, robustReSolve: true };

const sectionProps = {
  excludedIds: new Set<number>(),
  isDetailSectionPinned: () => false,
  isPreanalysis: false,
  isSectionCollapsed: () => false,
  isSpecialRunMode: false,
  onApplyImpactExclude: () => {},
  onHeaderRef: () => {},
  renderSourceLineLink: (line: number | null | undefined) => String(line ?? '-'),
  suspectImpactActionableCount: 1,
  suspectImpactExcludedCount: 0,
  suspectImpactWorstBaseStdRes: 2.44,
  toggleDetailSection: () => {},
  togglePinnedDetailSection: () => {},
  unitScale: 1,
  units: 'm' as const,
};

const tableProps = {
  title: 'Distances (TS)',
  unitScale: 1,
  units: 'm' as const,
  excludedIds: new Set<number>(),
  autoSideshotObsIds: new Set<number>(),
  onToggleExclude: () => {},
  rowSelectionClass: () => '',
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

describe('leave-one-out report section', () => {
  it('uses the new header and drops the Score column', () => {
    const html = renderToStaticMarkup(
      <ReportSuspectImpactSection {...sectionProps} suspectImpactDiagnostics={[okRow]} />,
    );
    expect(html).toContain('LEAVE-ONE-OUT INFLUENCE');
    expect(html).toContain('What-if exclusion analysis');
    expect(html).not.toContain('Suspect Impact Analysis');
    expect(html).not.toContain('Score');
    expect(html).toContain('Without Obs');
    expect(html).toContain('Coord Shift');
    expect(html).toContain('4.47 mm @ P');
  });

  it('renders free-network shifts as unavailable with reason, never mm', () => {
    const html = renderToStaticMarkup(
      <ReportSuspectImpactSection {...sectionProps} suspectImpactDiagnostics={[freeNetworkRow]} />,
    );
    expect(html).toContain('unavailable (free-network datum)');
    expect(html).not.toContain('mm @');
  });

  it('renders failed rows with the failure reason and no mm', () => {
    const html = renderToStaticMarkup(
      <ReportSuspectImpactSection {...sectionProps} suspectImpactDiagnostics={[failedRow]} />,
    );
    expect(html).toContain('FAILED (re-solve singular)');
    expect(html).not.toContain('@');
  });

  it('labels robust re-solves in the subtitle', () => {
    const html = renderToStaticMarkup(
      <ReportSuspectImpactSection {...sectionProps} suspectImpactDiagnostics={[robustRow]} />,
    );
    expect(html).toContain('Robust re-solve comparison');
  });

  it('carries absolute values in the Without-Obs tooltip', () => {
    const html = renderToStaticMarkup(
      <ReportSuspectImpactSection {...sectionProps} suspectImpactDiagnostics={[okRow]} />,
    );
    expect(html).toContain('SEUW base=1.5234 alt=1.0102');
    expect(html).toContain('T=12.345 DOF=4 p=0.0153');
  });

  it('keeps the explicit Exclude + Re-run action with confirm guard wiring', () => {
    const html = renderToStaticMarkup(
      <ReportSuspectImpactSection {...sectionProps} suspectImpactDiagnostics={[okRow]} />,
    );
    expect(html).toContain('Exclude + Re-run');
    expect(html).not.toContain('Analyze exclusion');
    expect(html).not.toContain('Remove observation');
  });
});

describe('selected-observation leave-one-out detail', () => {
  it('shows BASE / WITHOUT / COORDINATE CHANGE for the selected observation only', () => {
    const result = solveEngine({ input: INPUT, maxIterations: 8 });
    const target = result.observations.find((o) => o.id === 7) ?? result.observations[0];
    const row: SuspectImpactRow = { ...okRow, obsId: target.id };
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={result.observations}
        selectedObservationId={target.id}
        onSelectObservation={() => {}}
        suspectImpactRows={[row]}
      />,
    );
    expect(html).toContain('Leave-one-out:');
    expect(html).toContain('Without observation');
    expect(html).toContain('Coordinate change');
    expect(html).toContain('SEUW 1.5234-&gt;1.0102');
    expect(html).toContain('P:');
  });

  it('renders nothing extra when the selected observation has no LOO row', () => {
    const result = solveEngine({ input: INPUT, maxIterations: 8 });
    const target = result.observations[0];
    const html = renderToStaticMarkup(
      <ObservationTableSection
        {...tableProps}
        obsList={result.observations}
        selectedObservationId={target.id}
        onSelectObservation={() => {}}
        suspectImpactRows={[]}
      />,
    );
    expect(html).not.toContain('Leave-one-out:');
  });
});

describe('leave-one-out text export', () => {
  it('uses the new header, per-candidate detail, and no Score', () => {
    const lines: string[] = [];
    appendLeaveOneOutInfluenceSection({
      lines,
      res: { suspectImpactDiagnostics: [okRow, failedRow, freeNetworkRow] } as AdjustmentResult,
      linearUnit: 'm',
      unitScale: 1,
    });
    const text = lines.join('\n');
    expect(text).toContain('--- Leave-One-Out Influence / What-if Exclusion ---');
    expect(text).not.toContain('Suspect Impact Analysis');
    expect(text).not.toContain('Score');
    expect(text).toContain('base |t|=2.44 local=FAIL');
    expect(text).toContain('SEUW 1.5234->1.0102');
    expect(text).toContain('T=12.345/3.210 DOF=4/3 p=0.0153/0.3602');
    expect(text).toContain('max shift 0.0045 m @ P');
    expect(text).toContain('re-solve singular; status FAILED');
    expect(text).toContain('shift unavailable (free-network datum)');
  });
});
