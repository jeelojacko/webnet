import React from 'react';
import type { HeaderParams, TraverseLoop } from './LoopDiagnosticsSections.types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface TraverseLoopDiagnosticsSectionProps {
  diagnostics: {
    closureCount: number;
    passes?: { overall: boolean };
    misclosureE: number;
    misclosureN: number;
    misclosureMag: number;
    totalTraverseDistance: number;
    closureRatio?: number | null;
    linearPpm?: number | null;
    angularMisclosureArcSec?: number | null;
    verticalMisclosure?: number | null;
    thresholds?: {
      minClosureRatio?: number | null;
      maxLinearPpm?: number | null;
      maxAngularArcSec?: number | null;
      maxVerticalMisclosure?: number | null;
    };
  } | null | undefined;
  traverseLoops: TraverseLoop[];
  units: 'm' | 'ft';
  unitScale: number;
  isPreanalysis: boolean;
  isDataCheck: boolean;
  renderCollapsibleSectionHeader: (_params: HeaderParams) => React.ReactNode;
  isSectionCollapsed: (_sectionId: CollapsibleDetailSectionId) => boolean;
}

const TraverseLoopDiagnosticsSection: React.FC<TraverseLoopDiagnosticsSectionProps> = ({
  diagnostics,
  traverseLoops,
  units,
  unitScale,
  isPreanalysis,
  isDataCheck,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
}) => {
  if (isPreanalysis || isDataCheck || !diagnostics) {
    return null;
  }

  return (
    <div className="mb-6 border border-slate-800 rounded overflow-hidden">
      {renderCollapsibleSectionHeader({
        sectionId: 'traverse-diagnostics',
        label: 'Traverse Diagnostics',
        className:
          'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
        labelClassName: 'text-slate-100',
      })}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300 border-b border-slate-800/60">
        <div><div className="text-slate-500">Closure Count</div><div>{diagnostics.closureCount}</div></div>
        <div><div className="text-slate-500">Status</div><div className={diagnostics.passes?.overall ? 'text-green-400' : 'text-yellow-400'}>{diagnostics.passes?.overall ? 'PASS' : 'WARN'}</div></div>
        <div><div className="text-slate-500">Misclosure dE ({units})</div><div>{(diagnostics.misclosureE * unitScale).toFixed(4)}</div></div>
        <div><div className="text-slate-500">Misclosure dN ({units})</div><div>{(diagnostics.misclosureN * unitScale).toFixed(4)}</div></div>
        <div><div className="text-slate-500">Misclosure Mag ({units})</div><div>{(diagnostics.misclosureMag * unitScale).toFixed(4)}</div></div>
        <div><div className="text-slate-500">Traverse Dist ({units})</div><div>{(diagnostics.totalTraverseDistance * unitScale).toFixed(4)}</div></div>
        <div><div className="text-slate-500">Closure Ratio</div><div>{diagnostics.closureRatio != null ? `1:${diagnostics.closureRatio.toFixed(0)}` : '-'}</div></div>
        <div><div className="text-slate-500">Linear (ppm)</div><div>{diagnostics.linearPpm != null ? diagnostics.linearPpm.toFixed(1) : '-'}</div></div>
        <div><div className="text-slate-500">Angular Miscl (")</div><div>{diagnostics.angularMisclosureArcSec != null ? diagnostics.angularMisclosureArcSec.toFixed(2) : '-'}</div></div>
        <div><div className="text-slate-500">Vertical Miscl ({units})</div><div>{diagnostics.verticalMisclosure != null ? (diagnostics.verticalMisclosure * unitScale).toFixed(4) : '-'}</div></div>
        <div>
          <div className="text-slate-500">Thresholds</div>
          <div className="text-[10px] text-slate-500 leading-tight">
            ratio {diagnostics.thresholds?.minClosureRatio != null ? `1:${diagnostics.thresholds.minClosureRatio}` : '-'}, ppm {diagnostics.thresholds?.maxLinearPpm ?? '-'}
          </div>
          <div className="text-[10px] text-slate-500 leading-tight">
            ang {diagnostics.thresholds?.maxAngularArcSec ?? '-'}", dH {diagnostics.thresholds?.maxVerticalMisclosure != null ? (diagnostics.thresholds.maxVerticalMisclosure * unitScale).toFixed(4) : '-'}
          </div>
        </div>
      </div>
      {!isSectionCollapsed('traverse-diagnostics') && (
        <>
          {traverseLoops.length > 0 && (
            <div className="overflow-x-auto w-full border-t border-slate-800">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700">
                    <th className="py-2 px-3 font-semibold">#</th>
                    <th className="py-2 px-3 font-semibold">Loop</th>
                    <th className="py-2 px-3 font-semibold text-right">Mag ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Dist ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Ratio</th>
                    <th className="py-2 px-3 font-semibold text-right">Linear (ppm)</th>
                    <th className="py-2 px-3 font-semibold text-right">Ang Miscl (")</th>
                    <th className="py-2 px-3 font-semibold text-right">Vert Miscl ({units})</th>
                    <th className="py-2 px-3 font-semibold text-right">Severity</th>
                    <th className="py-2 px-3 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {traverseLoops.map((l, idx) => (
                    <tr key={`trav-loop-${l.key}-${idx}`} className="border-b border-slate-800/50">
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1 px-3">{l.key}</td>
                      <td className="py-1 px-3 text-right">{(l.misclosureMag * unitScale).toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">{(l.traverseDistance * unitScale).toFixed(4)}</td>
                      <td className="py-1 px-3 text-right">{l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-'}</td>
                      <td className="py-1 px-3 text-right">{l.linearPpm != null ? l.linearPpm.toFixed(1) : '-'}</td>
                      <td className="py-1 px-3 text-right">{l.angularMisclosureArcSec != null ? l.angularMisclosureArcSec.toFixed(2) : '-'}</td>
                      <td className="py-1 px-3 text-right">{l.verticalMisclosure != null ? (l.verticalMisclosure * unitScale).toFixed(4) : '-'}</td>
                      <td className="py-1 px-3 text-right font-mono">{l.severity.toFixed(1)}</td>
                      <td className={`py-1 px-3 text-right ${l.pass ? 'text-green-400' : 'text-yellow-400'}`}>{l.pass ? 'PASS' : 'WARN'}</td>
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
};

export default TraverseLoopDiagnosticsSection;
