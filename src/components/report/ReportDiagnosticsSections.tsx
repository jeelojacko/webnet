import React from 'react';
import type { AdjustmentResult } from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface HeaderParams {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
}

interface ReportDiagnosticsSectionsProps {
  result: AdjustmentResult;
  isPreanalysis: boolean;
  isDataCheck: boolean;
  isSpecialRunMode: boolean;
  showTsCorrelationDiagnosticsSection: boolean;
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
  renderSourceLineLink: (_line: number | null | undefined) => React.ReactNode;
}

const ReportDiagnosticsSections: React.FC<ReportDiagnosticsSectionsProps> = ({
  result,
  isPreanalysis,
  isDataCheck,
  isSpecialRunMode,
  showTsCorrelationDiagnosticsSection,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
  renderSourceLineLink,
}) => {
  return (
    <>
      {!isPreanalysis && !isDataCheck && result.residualDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden" style={{ order: -170 }}>
          {renderCollapsibleSectionHeader({
            sectionId: 'residual-diagnostics',
            label: 'Residual Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('residual-diagnostics') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300">
                <div>
                  <div className="text-slate-500">Obs</div>
                  <div>{result.residualDiagnostics.observationCount}</div>
                </div>
                <div>
                  <div className="text-slate-500">With StdRes</div>
                  <div>{result.residualDiagnostics.withStdResCount}</div>
                </div>
                <div>
                  <div className="text-slate-500">|t| &gt; 2 / &gt;3 / &gt;4</div>
                  <div>
                    {result.residualDiagnostics.over2SigmaCount} /{' '}
                    {result.residualDiagnostics.over3SigmaCount} /{' '}
                    {result.residualDiagnostics.over4SigmaCount}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Local Fail</div>
                  <div className={result.residualDiagnostics.localFailCount > 0 ? 'text-red-400' : ''}>
                    {result.residualDiagnostics.localFailCount}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Redundancy (&lt;0.2 / &lt;0.1)</div>
                  <div>
                    {result.residualDiagnostics.lowRedundancyCount} /{' '}
                    {result.residualDiagnostics.veryLowRedundancyCount}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Mean Redund</div>
                  <div>
                    {result.residualDiagnostics.meanRedundancy != null
                      ? result.residualDiagnostics.meanRedundancy.toFixed(3)
                      : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Min Redund</div>
                  <div>
                    {result.residualDiagnostics.minRedundancy != null
                      ? result.residualDiagnostics.minRedundancy.toFixed(3)
                      : '-'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Max |t|</div>
                  <div>
                    {result.residualDiagnostics.maxStdRes != null
                      ? result.residualDiagnostics.maxStdRes.toFixed(2)
                      : '-'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-slate-500">Worst Observation</div>
                  <div className="truncate">
                    {result.residualDiagnostics.worst
                      ? `#${result.residualDiagnostics.worst.obsId} ${result.residualDiagnostics.worst.type.toUpperCase()} ${result.residualDiagnostics.worst.stations} line=${result.residualDiagnostics.worst.sourceLine ?? '-'} |t|=${result.residualDiagnostics.worst.stdRes?.toFixed(2) ?? '-'}`
                      : '-'}
                  </div>
                </div>
              </div>
              {result.residualDiagnostics.byType.length > 0 && (
                <div className="overflow-x-auto w-full border-t border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="text-slate-200 border-b border-slate-700">
                        <th className="py-2 px-3 font-semibold">Type</th>
                        <th className="py-2 px-3 font-semibold text-right">Count</th>
                        <th className="py-2 px-3 font-semibold text-right">With StdRes</th>
                        <th className="py-2 px-3 font-semibold text-right">Local Fail</th>
                        <th className="py-2 px-3 font-semibold text-right">&gt;3σ</th>
                        <th className="py-2 px-3 font-semibold text-right">Max |t|</th>
                        <th className="py-2 px-3 font-semibold text-right">Mean Redund</th>
                        <th className="py-2 px-3 font-semibold text-right">Min Redund</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {result.residualDiagnostics.byType.map((r) => (
                        <tr key={`resdiag-${r.type}`} className="border-b border-slate-800/50">
                          <td className="py-1 px-3 uppercase">{r.type}</td>
                          <td className="py-1 px-3 text-right">{r.count}</td>
                          <td className="py-1 px-3 text-right">{r.withStdResCount}</td>
                          <td className={`py-1 px-3 text-right ${r.localFailCount > 0 ? 'text-red-400' : ''}`}>
                            {r.localFailCount}
                          </td>
                          <td className={`py-1 px-3 text-right ${r.over3SigmaCount > 0 ? 'text-yellow-300' : ''}`}>
                            {r.over3SigmaCount}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {r.maxStdRes != null ? r.maxStdRes.toFixed(2) : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {r.meanRedundancy != null ? r.meanRedundancy.toFixed(3) : '-'}
                          </td>
                          <td className="py-1 px-3 text-right">
                            {r.minRedundancy != null ? r.minRedundancy.toFixed(3) : '-'}
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
      )}

      {!isSpecialRunMode && result.robustDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'robust-diagnostics',
            label: 'Robust Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('robust-diagnostics') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300">
                <div>
                  <div className="text-slate-500">Mode</div>
                  <div>
                    {result.robustDiagnostics.enabled ? result.robustDiagnostics.mode.toUpperCase() : 'OFF'}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">k</div>
                  <div>{result.robustDiagnostics.k.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-slate-500">Iterations</div>
                  <div>{result.robustDiagnostics.iterations.length}</div>
                </div>
                <div>
                  <div className="text-slate-500">Final Downweighted</div>
                  <div>
                    {result.robustDiagnostics.iterations.length > 0
                      ? result.robustDiagnostics.iterations[result.robustDiagnostics.iterations.length - 1].downweightedRows
                      : 0}
                  </div>
                </div>
              </div>
              {result.robustDiagnostics.enabled && result.robustDiagnostics.iterations.length > 0 && (
                <div className="overflow-x-auto w-full border-t border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="text-slate-200 border-b border-slate-700">
                        <th className="py-2 px-3 font-semibold">Iter</th>
                        <th className="py-2 px-3 font-semibold text-right">Downweighted</th>
                        <th className="py-2 px-3 font-semibold text-right">Mean Weight</th>
                        <th className="py-2 px-3 font-semibold text-right">Min Weight</th>
                        <th className="py-2 px-3 font-semibold text-right">Max |v/sigma|</th>
                        <th className="py-2 px-3 font-semibold text-right">Max dW</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {result.robustDiagnostics.iterations.map((it) => (
                        <tr key={`rob-it-${it.iteration}`} className="border-b border-slate-800/50">
                          <td className="py-1 px-3">{it.iteration}</td>
                          <td className="py-1 px-3 text-right">{it.downweightedRows}</td>
                          <td className="py-1 px-3 text-right">{it.meanWeight.toFixed(3)}</td>
                          <td className="py-1 px-3 text-right">{it.minWeight.toFixed(3)}</td>
                          <td className="py-1 px-3 text-right">{it.maxNorm.toFixed(2)}</td>
                          <td className="py-1 px-3 text-right">
                            {it.maxWeightDelta != null ? it.maxWeightDelta.toFixed(4) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {result.robustDiagnostics.enabled && result.robustDiagnostics.topDownweightedRows.length > 0 && (
                <div className="overflow-x-auto w-full border-t border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="text-slate-200 border-b border-slate-700">
                        <th className="py-2 px-3 font-semibold">#</th>
                        <th className="py-2 px-3 font-semibold">Type</th>
                        <th className="py-2 px-3 font-semibold">Stations</th>
                        <th className="py-2 px-3 font-semibold text-right">Line</th>
                        <th className="py-2 px-3 font-semibold text-right">Weight</th>
                        <th className="py-2 px-3 font-semibold text-right">Norm</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {result.robustDiagnostics.topDownweightedRows.map((r, idx) => (
                        <tr key={`rob-row-${r.obsId}-${idx}`} className="border-b border-slate-800/50">
                          <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                          <td className="py-1 px-3 uppercase text-slate-400">{r.type}</td>
                          <td className="py-1 px-3">{r.stations}</td>
                          <td className="py-1 px-3 text-right text-slate-500">{renderSourceLineLink(r.sourceLine)}</td>
                          <td className="py-1 px-3 text-right">{r.weight.toFixed(3)}</td>
                          <td className="py-1 px-3 text-right">{r.norm.toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!isPreanalysis && !isSpecialRunMode && result.robustComparison?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'robust-vs-classical-suspects',
            label: 'Robust vs Classical Suspects (Top 10)',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('robust-vs-classical-suspects') && (
            <>
              <div className="px-3 py-2 text-xs text-slate-400 border-b border-slate-800">
                Overlap: {result.robustComparison.overlapCount}/
                {Math.min(result.robustComparison.classicalTop.length, result.robustComparison.robustTop.length)}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-0">
                <div className="border-r border-slate-800">
                  <div className="px-3 py-2 text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                    Classical
                  </div>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="text-slate-200 border-b border-slate-700">
                        <th className="py-2 px-3 font-semibold">#</th>
                        <th className="py-2 px-3 font-semibold">Type</th>
                        <th className="py-2 px-3 font-semibold">Stations</th>
                        <th className="py-2 px-3 font-semibold text-right">Line</th>
                        <th className="py-2 px-3 font-semibold text-right">StdRes</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {result.robustComparison.classicalTop.map((r) => (
                        <tr key={`c-${r.obsId}-${r.rank}`} className="border-b border-slate-800/40">
                          <td className="py-1 px-3 text-slate-500">{r.rank}</td>
                          <td className="py-1 px-3 uppercase text-slate-400">{r.type}</td>
                          <td className="py-1 px-3">{r.stations}</td>
                          <td className="py-1 px-3 text-right text-slate-500">{renderSourceLineLink(r.sourceLine)}</td>
                          <td className={`py-1 px-3 text-right ${r.localFail ? 'text-red-400' : ''}`}>
                            {r.stdRes != null ? r.stdRes.toFixed(2) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div>
                  <div className="px-3 py-2 text-[11px] text-slate-500 uppercase tracking-wider border-b border-slate-800">
                    Robust
                  </div>
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="text-slate-200 border-b border-slate-700">
                        <th className="py-2 px-3 font-semibold">#</th>
                        <th className="py-2 px-3 font-semibold">Type</th>
                        <th className="py-2 px-3 font-semibold">Stations</th>
                        <th className="py-2 px-3 font-semibold text-right">Line</th>
                        <th className="py-2 px-3 font-semibold text-right">StdRes</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-300">
                      {result.robustComparison.robustTop.map((r) => (
                        <tr key={`r-${r.obsId}-${r.rank}`} className="border-b border-slate-800/40">
                          <td className="py-1 px-3 text-slate-500">{r.rank}</td>
                          <td className="py-1 px-3 uppercase text-slate-400">{r.type}</td>
                          <td className="py-1 px-3">{r.stations}</td>
                          <td className="py-1 px-3 text-right text-slate-500">{renderSourceLineLink(r.sourceLine)}</td>
                          <td className={`py-1 px-3 text-right ${r.localFail ? 'text-red-400' : ''}`}>
                            {r.stdRes != null ? r.stdRes.toFixed(2) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {showTsCorrelationDiagnosticsSection && result.tsCorrelationDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'ts-correlation-diagnostics',
            label: 'TS Correlation Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('ts-correlation-diagnostics') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 p-3 text-xs text-slate-300">
                <div><div className="text-slate-500">Enabled</div><div>{result.tsCorrelationDiagnostics.enabled ? 'ON' : 'OFF'}</div></div>
                <div><div className="text-slate-500">Scope</div><div>{result.tsCorrelationDiagnostics.scope.toUpperCase()}</div></div>
                <div><div className="text-slate-500">Rho</div><div>{result.tsCorrelationDiagnostics.rho.toFixed(3)}</div></div>
                <div><div className="text-slate-500">Groups</div><div>{result.tsCorrelationDiagnostics.groupCount}</div></div>
                <div><div className="text-slate-500">Equations</div><div>{result.tsCorrelationDiagnostics.equationCount}</div></div>
                <div><div className="text-slate-500">Pairs</div><div>{result.tsCorrelationDiagnostics.pairCount}</div></div>
                <div><div className="text-slate-500">Max Group</div><div>{result.tsCorrelationDiagnostics.maxGroupSize}</div></div>
                <div>
                  <div className="text-slate-500">Mean|OffDiagW|</div>
                  <div>
                    {result.tsCorrelationDiagnostics.meanAbsOffDiagWeight != null
                      ? result.tsCorrelationDiagnostics.meanAbsOffDiagWeight.toExponential(3)
                      : '-'}
                  </div>
                </div>
              </div>
              {result.tsCorrelationDiagnostics.enabled && result.tsCorrelationDiagnostics.groups.length > 0 && (
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
                      {result.tsCorrelationDiagnostics.groups.slice(0, 20).map((g, idx) => (
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
      )}
    </>
  );
};

export default ReportDiagnosticsSections;
