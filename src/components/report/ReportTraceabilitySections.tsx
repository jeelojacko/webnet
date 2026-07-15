import React from 'react';

import type { AdjustmentResult } from '../../types';
import CollapsibleSectionHeader from './CollapsibleSectionHeader';
import type { ReportReviewSelectorModel } from './reportReviewSelectors';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

type SourceLineRenderer = (_line: number | null | undefined) => React.ReactNode;

type SectionControls = {
  isDetailSectionPinned: (_id: CollapsibleDetailSectionId) => boolean;
  isSectionCollapsed: (_id: CollapsibleDetailSectionId) => boolean;
  onHeaderRef: (_id: CollapsibleDetailSectionId, _node: HTMLDivElement | null) => void;
  toggleDetailSection: (_id: CollapsibleDetailSectionId) => void;
  togglePinnedDetailSection: (_id: CollapsibleDetailSectionId, _label: string) => void;
};

const TraceabilityHeader: React.FC<
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
    className="px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-800 bg-slate-900/40"
    labelClassName="text-slate-400"
    collapsed={isSectionCollapsed(sectionId)}
    pinned={isDetailSectionPinned(sectionId)}
    onToggleCollapse={toggleDetailSection}
    onTogglePin={togglePinnedDetailSection}
    onHeaderRef={onHeaderRef}
  />
);

export const AliasTraceabilitySection: React.FC<
  SectionControls & {
    aliasTrace: ReportReviewSelectorModel['aliasTrace'];
    parseState: AdjustmentResult['parseState'];
    renderSourceLineLink: SourceLineRenderer;
  }
> = ({
  aliasTrace,
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  parseState,
  renderSourceLineLink,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => {
  if (aliasTrace.length === 0) return null;
  const sectionId: CollapsibleDetailSectionId = 'alias-traceability';
  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      <TraceabilityHeader
        sectionId={sectionId}
        label="Alias Traceability"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-3 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Explicit Maps</div>
          <div>{parseState?.aliasExplicitCount ?? 0}</div>
        </div>
        <div>
          <div className="text-slate-500">Pattern Rules</div>
          <div>{parseState?.aliasRuleCount ?? 0}</div>
        </div>
        <div>
          <div className="text-slate-500">Remap References</div>
          <div>{aliasTrace.length}</div>
        </div>
        <div className="col-span-2">
          <div className="text-slate-500">Rule Summary</div>
          <div className="truncate">
            {(parseState?.aliasRuleSummaries ?? [])
              .map((r) => `${r.rule} @${r.sourceLine}`)
              .join('; ') || '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <>
          <div className="overflow-x-auto w-full">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">Context</th>
                  <th className="py-2 px-3 font-semibold">Detail</th>
                  <th className="py-2 px-3 font-semibold text-right">Line</th>
                  <th className="py-2 px-3 font-semibold">Source Alias</th>
                  <th className="py-2 px-3 font-semibold">Canonical ID</th>
                  <th className="py-2 px-3 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {aliasTrace.slice(0, 200).map((entry, idx) => (
                  <tr
                    key={`alias-trace-${entry.context}-${entry.sourceLine ?? 'na'}-${entry.sourceId}-${entry.canonicalId}-${idx}`}
                    className="border-b border-slate-800/50"
                  >
                    <td className="py-1 px-3 uppercase">{entry.context}</td>
                    <td className="py-1 px-3">{entry.detail ?? '-'}</td>
                    <td className="py-1 px-3 text-right text-slate-500">
                      {renderSourceLineLink(entry.sourceLine)}
                    </td>
                    <td className="py-1 px-3 font-mono">{entry.sourceId}</td>
                    <td className="py-1 px-3 font-mono">{entry.canonicalId}</td>
                    <td className="py-1 px-3">{entry.reference ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {aliasTrace.length > 200 && (
            <div className="px-3 py-2 text-[11px] text-slate-500 border-t border-slate-800">
              Showing first 200 rows of {aliasTrace.length}. Full trace available in export output.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const DescriptionReconciliationSection: React.FC<
  SectionControls & {
    descriptionAppendDelimiter: string;
    descriptionConflicts: ReportReviewSelectorModel['descriptionConflicts'];
    descriptionReconcileMode: ReportReviewSelectorModel['descriptionReconcileMode'];
    descriptionRefsByStation: ReportReviewSelectorModel['descriptionRefsByStation'];
    descriptionScanSummary: ReportReviewSelectorModel['descriptionScanSummary'];
    parseState: AdjustmentResult['parseState'];
  }
> = ({
  descriptionAppendDelimiter,
  descriptionConflicts,
  descriptionReconcileMode,
  descriptionRefsByStation,
  descriptionScanSummary,
  isDetailSectionPinned,
  isSectionCollapsed,
  onHeaderRef,
  parseState,
  toggleDetailSection,
  togglePinnedDetailSection,
}) => {
  if (descriptionScanSummary.length === 0) return null;
  const sectionId: CollapsibleDetailSectionId = 'description-reconciliation-summary';
  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      <TraceabilityHeader
        sectionId={sectionId}
        label="Description Reconciliation Summary"
        isDetailSectionPinned={isDetailSectionPinned}
        isSectionCollapsed={isSectionCollapsed}
        onHeaderRef={onHeaderRef}
        toggleDetailSection={toggleDetailSection}
        togglePinnedDetailSection={togglePinnedDetailSection}
      />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Mode</div>
          <div>
            {descriptionReconcileMode.toUpperCase()}
            {descriptionReconcileMode === 'append' ? ` ("${descriptionAppendDelimiter}")` : ''}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Stations</div>
          <div>{descriptionScanSummary.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Repeated IDs</div>
          <div>{parseState?.descriptionRepeatedStationCount ?? 0}</div>
        </div>
        <div>
          <div className="text-slate-500">Conflicts</div>
          <div className={descriptionConflicts.length > 0 ? 'text-amber-300' : ''}>
            {descriptionConflicts.length}
          </div>
        </div>
      </div>
      {!isSectionCollapsed(sectionId) && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">Station</th>
                <th className="py-2 px-3 font-semibold text-right">Records</th>
                <th className="py-2 px-3 font-semibold text-right">Unique</th>
                <th className="py-2 px-3 font-semibold text-center">Conflict</th>
                <th className="py-2 px-3 font-semibold">Descriptions (line refs)</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {descriptionScanSummary.map((row) => {
                const details = (descriptionRefsByStation.get(row.stationId) ?? [])
                  .map((detail) => {
                    const lines = detail.lines
                      .slice()
                      .sort((a, b) => a - b)
                      .join(', ');
                    return `${detail.description} [${lines}]`;
                  })
                  .join(' ; ');
                return (
                  <tr key={`desc-summary-${row.stationId}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 font-mono">{row.stationId}</td>
                    <td className="py-1 px-3 text-right">{row.recordCount}</td>
                    <td className="py-1 px-3 text-right">{row.uniqueCount}</td>
                    <td className="py-1 px-3 text-center">
                      {row.conflict ? (
                        <span className="text-amber-300 font-semibold">YES</span>
                      ) : (
                        <span className="text-slate-500">no</span>
                      )}
                    </td>
                    <td className="py-1 px-3 text-slate-400">{details || '-'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
