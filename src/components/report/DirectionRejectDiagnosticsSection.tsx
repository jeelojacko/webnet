import React from 'react';
import type { DirectionRejectDiagnostic } from '../../types';
import type { HeaderParams } from './DirectionDiagnosticsSections.types';
import {
  REPORT_DIAGNOSTIC_WINDOW_SIZE,
  type CollapsibleDetailSectionId,
} from './reportSectionRegistry';

interface DirectionRejectDiagnosticsSectionProps {
  directionRejects: DirectionRejectDiagnostic[];
  visibleDirectionRejects: DirectionRejectDiagnostic[];
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderLoadMoreFooter: (
    _key: string,
    _shownCount: number,
    _totalCount: number,
    _step?: number,
  ) => React.ReactNode;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
}

const DirectionRejectDiagnosticsSection: React.FC<DirectionRejectDiagnosticsSectionProps> = ({
  directionRejects,
  visibleDirectionRejects,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
  renderLoadMoreFooter,
  renderSourceLineLink,
}) => {
  const directionRejectTargetCount = directionRejects.filter((reject) => reject.target).length;
  const topDirectionReject = directionRejects[0];

  if (directionRejects.length === 0) {
    return null;
  }

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      {renderCollapsibleSectionHeader({
        sectionId: 'direction-reject-diagnostics',
        label: 'Direction Reject Diagnostics',
        className:
          'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
        labelClassName: 'text-slate-100',
      })}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div>
          <div className="text-slate-500">Rejects</div>
          <div>{directionRejects.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Target Rows</div>
          <div>{directionRejectTargetCount}</div>
        </div>
        <div>
          <div className="text-slate-500">Visible Rows</div>
          <div>{visibleDirectionRejects.length}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Reason</div>
          <div className="truncate">{topDirectionReject?.detail ?? '-'}</div>
        </div>
        <div>
          <div className="text-slate-500">Top Set</div>
          <div className="font-mono">
            {topDirectionReject ? `${topDirectionReject.setId}@${topDirectionReject.occupy}` : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed('direction-reject-diagnostics') && (
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="text-slate-200 border-b border-slate-700">
                <th className="py-2 px-3 font-semibold">#</th>
                <th className="py-2 px-3 font-semibold">Set</th>
                <th className="py-2 px-3 font-semibold">Occupy</th>
                <th className="py-2 px-3 font-semibold">Target</th>
                <th className="py-2 px-3 font-semibold text-right">Line</th>
                <th className="py-2 px-3 font-semibold">Rec</th>
                <th className="py-2 px-3 font-semibold">Expected</th>
                <th className="py-2 px-3 font-semibold">Actual</th>
                <th className="py-2 px-3 font-semibold">FaceSrc</th>
                <th className="py-2 px-3 font-semibold">Decision</th>
                <th className="py-2 px-3 font-semibold">Policy</th>
                <th className="py-2 px-3 font-semibold">Reason</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {visibleDirectionRejects.map((r, idx) => (
                <tr
                  key={`d-rej-${r.setId}-${r.target ?? 'set'}-${r.sourceLine ?? idx}-${idx}`}
                  className="border-b border-slate-800/50"
                >
                  <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                  <td className="py-1 px-3">{r.setId}</td>
                  <td className="py-1 px-3">{r.occupy}</td>
                  <td className="py-1 px-3">{r.target ?? '-'}</td>
                  <td className="py-1 px-3 text-right text-slate-500">
                    {renderSourceLineLink(r.sourceLine)}
                  </td>
                  <td className="py-1 px-3">{r.recordType ?? '-'}</td>
                  <td className="py-1 px-3">{r.expectedFace ?? '-'}</td>
                  <td className="py-1 px-3">{r.actualFace ?? '-'}</td>
                  <td className="py-1 px-3">{r.faceSource ?? '-'}</td>
                  <td className="py-1 px-3">{r.treatmentDecision ?? '-'}</td>
                  <td className="py-1 px-3">{r.policyOutcome ?? '-'}</td>
                  <td className="py-1 px-3 text-yellow-300">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {renderLoadMoreFooter(
            'direction-reject-diagnostics',
            visibleDirectionRejects.length,
            directionRejects.length,
            REPORT_DIAGNOSTIC_WINDOW_SIZE,
          )}
        </div>
      )}
    </div>
  );
};

export default DirectionRejectDiagnosticsSection;
