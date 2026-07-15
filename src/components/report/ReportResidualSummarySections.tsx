import React from 'react';

import { RAD_TO_DEG } from '../../engine/angles';
import { toSurveyEllipseAzimuthDeg } from '../../engine/resultPrecision';
import type { AdjustmentResult } from '../../types';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

type LoadMoreRenderer = (_key: string, _shownCount: number, _totalCount: number) => React.ReactNode;

type SectionControls = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

type TypeSummaryEntry = [
  string,
  NonNullable<AdjustmentResult['typeSummary']>[string],
];

const ResidualSummaryHeader: React.FC<
  SectionControls & {
    label: string;
    sectionId: CollapsibleDetailSectionId;
  }
> = ({
  isDetailSectionPinned,
  isSectionCollapsed,
  label,
  onHeaderRef,
  sectionId,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => (
  <CollapsibleSectionHeader
    sectionId={sectionId}
    label={label}
    className="px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75"
    labelClassName="text-slate-100"
    collapsed={isSectionCollapsed(sectionId)}
    pinned={isDetailSectionPinned(sectionId)}
    onToggleCollapse={toggleDetailSection}
    onTogglePin={togglePinnedDetailSection}
    onHeaderRef={onHeaderRef}
  />
);

export const ObservationResidualsSummarySections: React.FC<
  SectionControls & {
    allDetailSectionsCollapsed: boolean;
    children: React.ReactNode;
    ellipseConfidenceScale: number;
    ellipseScale: number;
    ellipseUnit: string;
    filteredRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
    isDataCheck: boolean;
    isPreanalysis: boolean;
    renderLoadMoreFooter: LoadMoreRenderer;
    topRelativePrecisionRow?: NonNullable<AdjustmentResult['relativePrecision']>[number];
    topTypeSummaryEntry: TypeSummaryEntry | null;
    typeSummaryEntries: TypeSummaryEntry[];
    typeSummaryObsCount: number;
    unitScale: number;
    units: 'm' | 'ft';
    visibleRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
  }
> = ({
  allDetailSectionsCollapsed,
  children,
  ellipseConfidenceScale,
  ellipseScale,
  ellipseUnit,
  filteredRelativePrecision,
  isDataCheck,
  isDetailSectionPinned,
  isPreanalysis,
  isSectionCollapsed,
  onHeaderRef,
  renderLoadMoreFooter,
  toggleDetailSection,
  togglePinnedDetailSection,
  topRelativePrecisionRow,
  topTypeSummaryEntry,
  typeSummaryEntries,
  typeSummaryObsCount,
  unitScale,
  units,
  visibleRelativePrecision,
}) => {
  if (isPreanalysis || isDataCheck) return null;
  return (
    <div className="mb-8" style={{ order: -180 }}>
      <h3 className="text-blue-400 font-bold mb-3 text-base uppercase tracking-wider">
        Observations & Residuals
      </h3>
      <div className="bg-slate-800/50 rounded p-2 mb-2 text-xs text-slate-400 flex items-center justify-between">
        <span>Sorted by |StdRes|</span>
        <span>MDB: arcsec (angular) / {units} (linear). Toggle rows to exclude and press Re-run</span>
      </div>
      {allDetailSectionsCollapsed && (
        <div className="mb-3 rounded border border-slate-800 bg-slate-900/40 px-3 py-2 text-xs text-slate-400">
          Detail sections are collapsed. Click any section header to expand it, or use “Expand
          detail sections”.
        </div>
      )}
      {typeSummaryEntries.length > 0 && (
        <TypeSummarySection
          typeSummaryEntries={typeSummaryEntries}
          typeSummaryObsCount={typeSummaryObsCount}
          topTypeSummaryEntry={topTypeSummaryEntry}
          isDetailSectionPinned={isDetailSectionPinned}
          isSectionCollapsed={isSectionCollapsed}
          onHeaderRef={onHeaderRef}
          toggleDetailSection={toggleDetailSection}
          togglePinnedDetailSection={togglePinnedDetailSection}
        />
      )}
      {filteredRelativePrecision.length > 0 && (
        <RelativePrecisionUnknownsSection
          ellipseConfidenceScale={ellipseConfidenceScale}
          ellipseScale={ellipseScale}
          ellipseUnit={ellipseUnit}
          filteredRelativePrecision={filteredRelativePrecision}
          isDetailSectionPinned={isDetailSectionPinned}
          isSectionCollapsed={isSectionCollapsed}
          onHeaderRef={onHeaderRef}
          renderLoadMoreFooter={renderLoadMoreFooter}
          toggleDetailSection={toggleDetailSection}
          togglePinnedDetailSection={togglePinnedDetailSection}
          topRelativePrecisionRow={topRelativePrecisionRow}
          unitScale={unitScale}
          units={units}
          visibleRelativePrecision={visibleRelativePrecision}
        />
      )}
      {children}
    </div>
  );
};

const TypeSummarySection: React.FC<
  SectionControls & {
    topTypeSummaryEntry: TypeSummaryEntry | null;
    typeSummaryEntries: TypeSummaryEntry[];
    typeSummaryObsCount: number;
  }
> = ({
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  toggleDetailSection,
  togglePinnedDetailSection,
  topTypeSummaryEntry,
  typeSummaryEntries,
  typeSummaryObsCount,
}) => {
  const sectionId: CollapsibleDetailSectionId = 'per-type-summary';
  return (
    <div className="mb-4 border border-slate-800 rounded">
      <ResidualSummaryHeader
        sectionId={sectionId}
        label="Per-Type Summary"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Types</div>
          <div>{typeSummaryEntries.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Obs Total</div>
          <div>{typeSummaryObsCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Type</div>
          <div className="uppercase">{topTypeSummaryEntry?.[0] ?? '-'}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Max |StdRes|</div>
          <div>{topTypeSummaryEntry ? topTypeSummaryEntry[1].maxStdRes.toFixed(3) : '-'}</div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">Type</th>
                <th className="py-2 px-3 font-semibold text-right">Count</th>
                <th className="py-2 px-3 font-semibold text-right">RMS</th>
                <th className="py-2 px-3 font-semibold text-right">Max |Res|</th>
                <th className="py-2 px-3 font-semibold text-right">Max |StdRes|</th>
                <th className="py-2 px-3 font-semibold text-right">&gt;3σ</th>
                <th className="py-2 px-3 font-semibold text-right">&gt;4σ</th>
                <th className="py-2 px-3 font-semibold text-right">Unit</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {typeSummaryEntries.map(([type, summary]) => (
                <tr key={type} className="border-b border-slate-800/50">
                  <td className="py-1 px-3 uppercase text-slate-400">{type}</td>
                  <td className="py-1 px-3 text-right">{summary.count}</td>
                  <td className="py-1 px-3 text-right">{summary.rms.toFixed(4)}</td>
                  <td className="py-1 px-3 text-right">{summary.maxAbs.toFixed(4)}</td>
                  <td className="py-1 px-3 text-right">{summary.maxStdRes.toFixed(3)}</td>
                  <td className="py-1 px-3 text-right">{summary.over3}</td>
                  <td className="py-1 px-3 text-right">{summary.over4}</td>
                  <td className="py-1 px-3 text-right">{summary.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

const RelativePrecisionUnknownsSection: React.FC<
  SectionControls & {
    ellipseConfidenceScale: number;
    ellipseScale: number;
    ellipseUnit: string;
    filteredRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
    renderLoadMoreFooter: LoadMoreRenderer;
    topRelativePrecisionRow?: NonNullable<AdjustmentResult['relativePrecision']>[number];
    unitScale: number;
    units: 'm' | 'ft';
    visibleRelativePrecision: NonNullable<AdjustmentResult['relativePrecision']>;
  }
> = ({
  ellipseConfidenceScale,
  ellipseScale,
  ellipseUnit,
  filteredRelativePrecision,
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  renderLoadMoreFooter,
  toggleDetailSection,
  togglePinnedDetailSection,
  topRelativePrecisionRow,
  unitScale,
  units,
  visibleRelativePrecision,
}) => {
  const sectionId: CollapsibleDetailSectionId = 'relative-precision-unknowns';
  const ellipseUnitFactor = units === 'ft' ? 0.0328084 : 1;
  return (
    <div className="mb-4 border border-slate-800 rounded">
      <ResidualSummaryHeader
        sectionId={sectionId}
        label="Relative Precision (Unknowns)"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Pairs</div>
          <div>{filteredRelativePrecision.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Pair</div>
          <div className="font-mono">
            {topRelativePrecisionRow
              ? `${topRelativePrecisionRow.from}-${topRelativePrecisionRow.to}`
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top σDist</div>
          <div>
            {topRelativePrecisionRow?.sigmaDist != null
              ? (topRelativePrecisionRow.sigmaDist * unitScale).toFixed(4)
              : '-'}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Top Ellipse Az</div>
          <div>
            {topRelativePrecisionRow?.ellipse
              ? (toSurveyEllipseAzimuthDeg(topRelativePrecisionRow.ellipse.theta) ?? 0).toFixed(2)
              : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">From</th>
                <th className="py-2 px-3 font-semibold">To</th>
                <th className="py-2 px-3 font-semibold text-right">σN</th>
                <th className="py-2 px-3 font-semibold text-right">σE</th>
                <th className="py-2 px-3 font-semibold text-right">σDist</th>
                <th className="py-2 px-3 font-semibold text-right">σAz (")</th>
                <th className="py-2 px-3 font-semibold text-right">Ellipse ({ellipseUnit})</th>
                <th className="py-2 px-3 font-semibold text-right">Az (deg)</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {visibleRelativePrecision.map((rel, idx) => (
                <tr key={`${rel.from}-${rel.to}-${idx}`} className="border-b border-slate-800/50">
                  <td className="py-1 px-3">{rel.from}</td>
                  <td className="py-1 px-3">{rel.to}</td>
                  <td className="py-1 px-3 text-right">
                    {(rel.sigmaN * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {(rel.sigmaE * unitScale).toFixed(4)}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {rel.sigmaDist != null ? (rel.sigmaDist * unitScale).toFixed(4) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {rel.sigmaAz != null ? (rel.sigmaAz * RAD_TO_DEG * 3600).toFixed(2) : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {rel.ellipse
                      ? `${(
                          rel.ellipse.semiMajor *
                          ellipseConfidenceScale *
                          ellipseScale *
                          ellipseUnitFactor
                        ).toFixed(1)} / ${(
                          rel.ellipse.semiMinor *
                          ellipseConfidenceScale *
                          ellipseScale *
                          ellipseUnitFactor
                        ).toFixed(1)}`
                      : '-'}
                  </td>
                  <td className="py-1 px-3 text-right">
                    {rel.ellipse
                      ? (toSurveyEllipseAzimuthDeg(rel.ellipse.theta) ?? 0).toFixed(2)
                      : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {renderLoadMoreFooter(
            'relative-precision',
            visibleRelativePrecision.length,
            filteredRelativePrecision.length,
          )}
        </div>
      )}
    </div>
  );
};
