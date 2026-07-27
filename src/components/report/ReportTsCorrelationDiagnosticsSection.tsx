import React from 'react';
import type { AdjustmentResult } from '../../types';
import type { HeaderParams } from './ReportDiagnosticsSections.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface ReportTsCorrelationDiagnosticsSectionProps {
  diagnostics: NonNullable<AdjustmentResult['tsCorrelationDiagnostics']>;
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
}

const ReportTsCorrelationDiagnosticsSection: React.FC<
  ReportTsCorrelationDiagnosticsSectionProps
> = ({ diagnostics, renderCollapsibleSectionHeader, isSectionCollapsed }) => (
  <div className="mb-6 border border-slate-800 rounded overflow-hidden">
    {renderCollapsibleSectionHeader({
      sectionId: 'ts-correlation-diagnostics',
      label: 'TS Correlation Diagnostics',
      className:
        'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
      labelClassName: 'text-slate-100',
    })}
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
      <div><div className="text-slate-500">Enabled</div><div>{diagnostics.enabled ? 'ON' : 'OFF'}</div></div>
      <div><div className="text-slate-500">Scope</div><div>{diagnostics.scope.toUpperCase()}</div></div>
      <div><div className="text-slate-500">Rho</div><div>{diagnostics.rho.toFixed(3)}</div></div>
      <div><div className="text-slate-500">Groups</div><div>{diagnostics.groupCount}</div></div>
      <div><div className="text-slate-500">Equations</div><div>{diagnostics.equationCount}</div></div>
      <div><div className="text-slate-500">Pairs</div><div>{diagnostics.pairCount}</div></div>
      <div><div className="text-slate-500">Max Group</div><div>{diagnostics.maxGroupSize}</div></div>
      <div>
        <div className="text-slate-500">Mean|OffDiagW|</div>
        <div>
          {diagnostics.meanAbsOffDiagWeight != null
            ? diagnostics.meanAbsOffDiagWeight.toExponential(3)
            : '-'}
        </div>
      </div>
    </div>
    {!isSectionCollapsed('ts-correlation-diagnostics') && (
      <>
        {diagnostics.enabled && diagnostics.groups.length > 0 && (
          <div className="overflow-x-auto w-full border-t border-slate-800">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="text-slate-200 border-b border-slate-700">
                  <th className="py-2 px-3 font-semibold">#</th>
                  <th className="py-2 px-3 font-semibold">Key</th>
                  <th className="py-2 px-3 font-semibold">Setup</th>
                  <th className="py-2 px-3 font-semibold">Set</th>
                  <th className="py-2 px-3 font-semibold text-right">Rows</th>
                  <th className="py-2 px-3 font-semibold text-right">Pair Count</th>
                  <th className="py-2 px-3 font-semibold text-right">Mean|W|</th>
                </tr>
              </thead>
              <tbody className="text-slate-300">
                {diagnostics.groups.slice(0, 20).map((g, idx) => (
                  <tr key={`${g.key}-${idx}`} className="border-b border-slate-800/50">
                    <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                    <td className="py-1 px-3 font-mono text-[11px]">{g.key}</td>
                    <td className="py-1 px-3">{g.station}</td>
                    <td className="py-1 px-3">{g.setId ?? '-'}</td>
                    <td className="py-1 px-3 text-right">{g.rows}</td>
                    <td className="py-1 px-3 text-right">{g.pairCount}</td>
                    <td className="py-1 px-3 text-right">
                      {g.meanAbsOffDiagWeight != null ? g.meanAbsOffDiagWeight.toExponential(3) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    )}
  </div>
);

export default ReportTsCorrelationDiagnosticsSection;
