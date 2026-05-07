import React from 'react';
import type {
  AdjustmentResult,
  LevelingLoopDiagnosticRow,
  LevelingLoopSegmentSuspectRow,
} from '../../types';
import type { CollapsibleDetailSectionId } from './reportSectionRegistry';

interface HeaderParams {
  sectionId: CollapsibleDetailSectionId;
  label: string;
  className: string;
  labelClassName: string;
  title?: string;
}

type TraverseLoop = NonNullable<
  NonNullable<AdjustmentResult['traverseDiagnostics']>['loops']
>[number];
type GpsLoop = NonNullable<NonNullable<AdjustmentResult['gpsLoopDiagnostics']>['loops']>[number];
type LevelingLoop = LevelingLoopDiagnosticRow;
type LevelingSegmentSuspect = LevelingLoopSegmentSuspectRow;

interface LoopDiagnosticsSectionsProps {
  result: AdjustmentResult;
  units: 'm' | 'ft';
  unitScale: number;
  isPreanalysis: boolean;
  isDataCheck: boolean;
  showLevelingLoopDiagnosticsSection: boolean;
  traverseLoops: TraverseLoop[];
  traverseLoopSuspects: TraverseLoop[];
  visibleTraverseLoopSuspects: TraverseLoop[];
  gpsLoopSuspects: GpsLoop[];
  visibleGpsLoopSuspects: GpsLoop[];
  levelingLoopSuspects: LevelingLoop[];
  visibleLevelingLoopSuspects: LevelingLoop[];
  levelingSegmentSuspects: LevelingSegmentSuspect[];
  highlightedLevelingSegmentLines: Set<number>;
  gpsLoopDiagnostics: AdjustmentResult['gpsLoopDiagnostics'];
  levelingLoopDiagnostics: AdjustmentResult['levelingLoopDiagnostics'];
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

const LoopDiagnosticsSections: React.FC<LoopDiagnosticsSectionsProps> = ({
  result,
  units,
  unitScale,
  isPreanalysis,
  isDataCheck,
  showLevelingLoopDiagnosticsSection,
  traverseLoops,
  traverseLoopSuspects,
  visibleTraverseLoopSuspects,
  gpsLoopSuspects,
  visibleGpsLoopSuspects,
  levelingLoopSuspects,
  visibleLevelingLoopSuspects,
  levelingSegmentSuspects,
  highlightedLevelingSegmentLines,
  gpsLoopDiagnostics,
  levelingLoopDiagnostics,
  renderCollapsibleSectionHeader,
  isSectionCollapsed,
  renderLoadMoreFooter,
  renderSourceLineLink,
}) => {
  return (
    <>
      {!isPreanalysis && !isDataCheck && result.traverseDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'traverse-diagnostics',
            label: 'Traverse Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('traverse-diagnostics') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-3 text-xs text-slate-300">
                <div><div className="text-slate-500">Closure Count</div><div>{result.traverseDiagnostics.closureCount}</div></div>
                <div><div className="text-slate-500">Status</div><div className={result.traverseDiagnostics.passes?.overall ? 'text-green-400' : 'text-yellow-400'}>{result.traverseDiagnostics.passes?.overall ? 'PASS' : 'WARN'}</div></div>
                <div><div className="text-slate-500">Misclosure dE ({units})</div><div>{(result.traverseDiagnostics.misclosureE * unitScale).toFixed(4)}</div></div>
                <div><div className="text-slate-500">Misclosure dN ({units})</div><div>{(result.traverseDiagnostics.misclosureN * unitScale).toFixed(4)}</div></div>
                <div><div className="text-slate-500">Misclosure Mag ({units})</div><div>{(result.traverseDiagnostics.misclosureMag * unitScale).toFixed(4)}</div></div>
                <div><div className="text-slate-500">Traverse Dist ({units})</div><div>{(result.traverseDiagnostics.totalTraverseDistance * unitScale).toFixed(4)}</div></div>
                <div><div className="text-slate-500">Closure Ratio</div><div>{result.traverseDiagnostics.closureRatio != null ? `1:${result.traverseDiagnostics.closureRatio.toFixed(0)}` : '-'}</div></div>
                <div><div className="text-slate-500">Linear (ppm)</div><div>{result.traverseDiagnostics.linearPpm != null ? result.traverseDiagnostics.linearPpm.toFixed(1) : '-'}</div></div>
                <div><div className="text-slate-500">Angular Miscl (")</div><div>{result.traverseDiagnostics.angularMisclosureArcSec != null ? result.traverseDiagnostics.angularMisclosureArcSec.toFixed(2) : '-'}</div></div>
                <div><div className="text-slate-500">Vertical Miscl ({units})</div><div>{result.traverseDiagnostics.verticalMisclosure != null ? (result.traverseDiagnostics.verticalMisclosure * unitScale).toFixed(4) : '-'}</div></div>
                <div>
                  <div className="text-slate-500">Thresholds</div>
                  <div className="text-[10px] text-slate-500 leading-tight">
                    ratio {result.traverseDiagnostics.thresholds?.minClosureRatio != null ? `1:${result.traverseDiagnostics.thresholds.minClosureRatio}` : '-'}, ppm {result.traverseDiagnostics.thresholds?.maxLinearPpm ?? '-'}
                  </div>
                  <div className="text-[10px] text-slate-500 leading-tight">
                    ang {result.traverseDiagnostics.thresholds?.maxAngularArcSec ?? '-'}", dH {result.traverseDiagnostics.thresholds?.maxVerticalMisclosure != null ? (result.traverseDiagnostics.thresholds.maxVerticalMisclosure * unitScale).toFixed(4) : '-'}
                  </div>
                </div>
              </div>
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
      )}

      {!isPreanalysis && !isDataCheck && traverseLoopSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'traverse-closure-suspects',
            label: 'Traverse Closure Suspects',
            className:
              'px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('traverse-closure-suspects') && (
            <>
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="text-slate-200 border-b border-slate-700/80">
                    <th className="py-2 px-3">#</th>
                    <th className="py-2">Loop</th>
                    <th className="py-2 text-right">Ratio</th>
                    <th className="py-2 text-right">Linear (ppm)</th>
                    <th className="py-2 text-right">Ang Miscl (")</th>
                    <th className="py-2 text-right">Vert Miscl ({units})</th>
                    <th className="py-2 text-right">Severity</th>
                    <th className="py-2 text-right px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="text-slate-300">
                  {visibleTraverseLoopSuspects.map((l, idx) => (
                    <tr key={`trav-suspect-${l.key}-${idx}`} className="border-b border-slate-800/30">
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1">{l.key}</td>
                      <td className="py-1 text-right font-mono">{l.closureRatio != null ? `1:${l.closureRatio.toFixed(0)}` : '-'}</td>
                      <td className="py-1 text-right font-mono">{l.linearPpm != null ? l.linearPpm.toFixed(1) : '-'}</td>
                      <td className="py-1 text-right font-mono">{l.angularMisclosureArcSec != null ? l.angularMisclosureArcSec.toFixed(2) : '-'}</td>
                      <td className="py-1 text-right font-mono">{l.verticalMisclosure != null ? (l.verticalMisclosure * unitScale).toFixed(4) : '-'}</td>
                      <td className="py-1 text-right font-mono">{l.severity.toFixed(1)}</td>
                      <td className={`py-1 px-3 text-right font-mono ${l.pass ? 'text-green-400' : 'text-yellow-400'}`}>{l.pass ? 'PASS' : 'WARN'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {renderLoadMoreFooter('traverse-loop-suspects', visibleTraverseLoopSuspects.length, traverseLoopSuspects.length)}
            </>
          )}
        </div>
      )}

      {!isDataCheck && gpsLoopDiagnostics?.enabled && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'gps-loop-diagnostics',
            label: 'GPS Loop Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('gps-loop-diagnostics') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3 p-3 text-xs text-slate-300">
                <div><div className="text-slate-500">Vectors</div><div>{gpsLoopDiagnostics.vectorCount}</div></div>
                <div><div className="text-slate-500">Loop Count</div><div>{gpsLoopDiagnostics.loopCount}</div></div>
                <div><div className="text-slate-500">Status</div><div className={gpsLoopDiagnostics.warnCount > 0 ? 'text-yellow-400' : 'text-green-400'}>{gpsLoopDiagnostics.warnCount > 0 ? 'WARN' : 'PASS'}</div></div>
                <div><div className="text-slate-500">Pass</div><div>{gpsLoopDiagnostics.passCount}</div></div>
                <div><div className="text-slate-500">Warn</div><div>{gpsLoopDiagnostics.warnCount}</div></div>
                <div><div className="text-slate-500">Tolerance</div><div className="font-mono text-[11px]">{(gpsLoopDiagnostics.thresholds.baseToleranceM * unitScale).toFixed(4)}{units} + {gpsLoopDiagnostics.thresholds.ppmTolerance}ppm*dist</div></div>
              </div>
              {gpsLoopDiagnostics.loops.length > 0 && (
                <div className="overflow-x-auto w-full border-t border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead><tr className="text-slate-200 border-b border-slate-700"><th className="py-2 px-3 font-semibold">#</th><th className="py-2 px-3 font-semibold">Loop</th><th className="py-2 px-3 font-semibold">Path</th><th className="py-2 px-3 font-semibold text-right">Mag ({units})</th><th className="py-2 px-3 font-semibold text-right">Tol ({units})</th><th className="py-2 px-3 font-semibold text-right">Linear (ppm)</th><th className="py-2 px-3 font-semibold text-right">Ratio</th><th className="py-2 px-3 font-semibold text-right">Severity</th><th className="py-2 px-3 font-semibold text-right">Status</th><th className="py-2 px-3 font-semibold text-right">Lines</th></tr></thead>
                    <tbody className="text-slate-300">
                      {gpsLoopDiagnostics.loops.map((loop) => (
                        <tr key={`gps-loop-${loop.key}-${loop.rank}`} className="border-b border-slate-800/50">
                          <td className="py-1 px-3 text-slate-500">{loop.rank}</td>
                          <td className="py-1 px-3">{loop.key}</td>
                          <td className="py-1 px-3 text-slate-400 font-mono text-[11px]">{loop.stationPath.join('->')}</td>
                          <td className="py-1 px-3 text-right">{(loop.closureMag * unitScale).toFixed(4)}</td>
                          <td className="py-1 px-3 text-right">{(loop.toleranceM * unitScale).toFixed(4)}</td>
                          <td className="py-1 px-3 text-right">{loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'}</td>
                          <td className="py-1 px-3 text-right">{loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-'}</td>
                          <td className="py-1 px-3 text-right font-mono">{loop.severity.toFixed(2)}</td>
                          <td className={`py-1 px-3 text-right ${loop.pass ? 'text-green-400' : 'text-yellow-400'}`}>{loop.pass ? 'PASS' : 'WARN'}</td>
                          <td className="py-1 px-3 text-right text-slate-500">{loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}</td>
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

      {showLevelingLoopDiagnosticsSection && levelingLoopDiagnostics && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'leveling-loop-diagnostics',
            label: 'Leveling Loop Diagnostics',
            className:
              'px-3 py-2 text-xs uppercase tracking-wider border-b border-slate-700 bg-slate-800/75',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('leveling-loop-diagnostics') && (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 p-3 text-xs text-slate-300">
                <div><div className="text-slate-500">Observations</div><div>{levelingLoopDiagnostics.observationCount}</div></div>
                <div><div className="text-slate-500">Loop Count</div><div>{levelingLoopDiagnostics.loopCount}</div></div>
                <div><div className="text-slate-500">Pass / Warn</div><div>{levelingLoopDiagnostics.passCount} / {levelingLoopDiagnostics.warnCount}</div></div>
                <div><div className="text-slate-500">Total Length (km)</div><div>{levelingLoopDiagnostics.totalLengthKm.toFixed(3)}</div></div>
                <div><div className="text-slate-500">Warn Length (km)</div><div>{levelingLoopDiagnostics.warnTotalLengthKm.toFixed(3)}</div></div>
                <div><div className="text-slate-500">Worst |dH| ({units})</div><div>{levelingLoopDiagnostics.worstClosure != null ? (levelingLoopDiagnostics.worstClosure * unitScale).toFixed(4) : '-'}</div></div>
                <div><div className="text-slate-500">Worst mm/sqrt(km)</div><div>{levelingLoopDiagnostics.worstClosurePerSqrtKmMm != null ? levelingLoopDiagnostics.worstClosurePerSqrtKmMm.toFixed(2) : '-'}</div></div>
                <div><div className="text-slate-500">Tolerance Model</div><div className="font-mono text-[11px]">{levelingLoopDiagnostics.thresholds.baseMm.toFixed(2)}mm + {levelingLoopDiagnostics.thresholds.perSqrtKmMm.toFixed(2)}mm*sqrt(km)</div></div>
                <div><div className="text-slate-500">Worst Loop</div><div className="font-mono">{levelingLoopDiagnostics.worstLoopKey ?? '-'}</div></div>
                <div><div className="text-slate-500">Top Suspect Segment</div><div className="font-mono">{levelingLoopDiagnostics.suspectSegments[0] ? `${levelingLoopDiagnostics.suspectSegments[0].from}->${levelingLoopDiagnostics.suspectSegments[0].to}` : '-'}</div></div>
              </div>
              {levelingLoopDiagnostics.loops.length > 0 && (
                <div className="overflow-x-auto w-full border-t border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead><tr className="text-slate-200 border-b border-slate-700"><th className="py-2 px-3 font-semibold">#</th><th className="py-2 px-3 font-semibold">Loop</th><th className="py-2 px-3 font-semibold">Path</th><th className="py-2 px-3 font-semibold text-right">dH ({units})</th><th className="py-2 px-3 font-semibold text-right">|dH| ({units})</th><th className="py-2 px-3 font-semibold text-right">Len (km)</th><th className="py-2 px-3 font-semibold text-right">Tol (mm)</th><th className="py-2 px-3 font-semibold text-right">mm/sqrt(km)</th><th className="py-2 px-3 font-semibold text-right">Status</th><th className="py-2 px-3 font-semibold text-right">Lines</th></tr></thead>
                    <tbody className="text-slate-300">
                      {levelingLoopDiagnostics.loops.map((loop) => (
                        <tr key={loop.key} className="border-b border-slate-800/50">
                          <td className="py-1 px-3 text-slate-500">{loop.rank}</td>
                          <td className="py-1 px-3">{loop.key}</td>
                          <td className="py-1 px-3">{loop.stationPath.join('->')}</td>
                          <td className="py-1 px-3 text-right">{(loop.closure * unitScale).toFixed(4)}</td>
                          <td className="py-1 px-3 text-right">{(loop.absClosure * unitScale).toFixed(4)}</td>
                          <td className="py-1 px-3 text-right">{loop.loopLengthKm.toFixed(3)}</td>
                          <td className="py-1 px-3 text-right">{loop.toleranceMm.toFixed(2)}</td>
                          <td className="py-1 px-3 text-right">{loop.closurePerSqrtKmMm.toFixed(2)}</td>
                          <td className={`py-1 px-3 text-right ${loop.pass ? 'text-green-400' : 'text-yellow-400'}`}>{loop.pass ? 'PASS' : 'WARN'}</td>
                          <td className="py-1 px-3 text-right">{loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {levelingLoopDiagnostics.loops.length > 0 && (
                <div className="overflow-x-auto w-full border-t border-slate-800">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead><tr className="text-slate-200 border-b border-slate-700"><th className="py-2 px-3 font-semibold">Loop</th><th className="py-2 px-3 font-semibold text-right">Seg</th><th className="py-2 px-3 font-semibold">From</th><th className="py-2 px-3 font-semibold">To</th><th className="py-2 px-3 font-semibold text-right">dH ({units})</th><th className="py-2 px-3 font-semibold text-right">Len (km)</th><th className="py-2 px-3 font-semibold text-right">Line</th><th className="py-2 px-3 font-semibold text-right">Role</th></tr></thead>
                    <tbody className="text-slate-300">
                      {levelingLoopDiagnostics.loops.flatMap((loop) => loop.segments.map((segment, index) => (
                        <tr key={`${loop.key}-${index}-${segment.from}-${segment.to}`} className={`border-b border-slate-800/50 ${segment.sourceLine != null && highlightedLevelingSegmentLines.has(segment.sourceLine) ? 'bg-yellow-950/20' : ''}`}>
                          <td className="py-1 px-3">{loop.key}</td>
                          <td className="py-1 px-3 text-right">{index + 1}</td>
                          <td className="py-1 px-3">{segment.from}</td>
                          <td className="py-1 px-3">{segment.to}</td>
                          <td className="py-1 px-3 text-right">{(segment.observedDh * unitScale).toFixed(4)}</td>
                          <td className="py-1 px-3 text-right">{segment.lengthKm.toFixed(3)}</td>
                          <td className="py-1 px-3 text-right">{renderSourceLineLink(segment.sourceLine)}</td>
                          <td className="py-1 px-3 text-right">{segment.closureLeg ? 'Closure' : 'Traverse'}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {!isPreanalysis && !isDataCheck && levelingLoopSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'leveling-loop-suspects',
            label: 'Leveling Loop Suspects (ranked)',
            className:
              'px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('leveling-loop-suspects') && (
            <>
              <table className="w-full text-left text-xs">
                <thead><tr className="text-slate-200 border-b border-slate-700/80"><th className="py-2 px-3">#</th><th className="py-2">Loop</th><th className="py-2">Path</th><th className="py-2 text-right">|dH| ({units})</th><th className="py-2 text-right">Len (km)</th><th className="py-2 text-right">Tol (mm)</th><th className="py-2 text-right">mm/sqrt(km)</th><th className="py-2 text-right px-3">Lines</th></tr></thead>
                <tbody className="text-slate-300">
                  {visibleLevelingLoopSuspects.map((loop) => (
                    <tr key={`level-suspect-${loop.key}`} className="border-b border-slate-800/30">
                      <td className="py-1 px-3 text-slate-500">{loop.rank}</td>
                      <td className="py-1">{loop.key}</td>
                      <td className="py-1">{loop.stationPath.join('->')}</td>
                      <td className="py-1 text-right font-mono">{(loop.absClosure * unitScale).toFixed(4)}</td>
                      <td className="py-1 text-right font-mono">{loop.loopLengthKm.toFixed(3)}</td>
                      <td className="py-1 text-right font-mono">{loop.toleranceMm.toFixed(2)}</td>
                      <td className="py-1 text-right font-mono">{loop.closurePerSqrtKmMm.toFixed(2)}</td>
                      <td className="py-1 px-3 text-right font-mono">{loop.sourceLines.length > 0 ? loop.sourceLines.join(',') : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {renderLoadMoreFooter('leveling-loop-suspects', visibleLevelingLoopSuspects.length, levelingLoopSuspects.length)}
            </>
          )}
        </div>
      )}

      {!isPreanalysis && !isDataCheck && levelingSegmentSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'leveling-segment-suspects',
            label: 'Leveling Segment Suspects',
            className:
              'px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('leveling-segment-suspects') && (
            <table className="w-full text-left text-xs">
              <thead><tr className="text-slate-200 border-b border-slate-700/80"><th className="py-2 px-3">#</th><th className="py-2">Segment</th><th className="py-2 text-right">Line</th><th className="py-2 text-right">Warn Loops</th><th className="py-2 text-right">Score</th><th className="py-2 text-right">Max |dH| ({units})</th><th className="py-2 text-right">Worst Loop</th></tr></thead>
              <tbody className="text-slate-300">
                {levelingSegmentSuspects.map((segment) => (
                  <tr key={`level-segment-suspect-${segment.key}`} className="border-b border-slate-800/30">
                    <td className="py-1 px-3 text-slate-500">{segment.rank}</td>
                    <td className="py-1 font-mono">{segment.from}{'->'}{segment.to}</td>
                    <td className="py-1 text-right font-mono">{renderSourceLineLink(segment.sourceLine)}</td>
                    <td className="py-1 text-right font-mono">{segment.warnLoopCount}</td>
                    <td className="py-1 text-right font-mono">{segment.suspectScore.toFixed(2)}</td>
                    <td className="py-1 text-right font-mono">{(segment.maxAbsDh * unitScale).toFixed(4)}</td>
                    <td className="py-1 text-right font-mono">{segment.worstLoopKey ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {gpsLoopSuspects.length > 0 && (
        <div className="mb-6 border border-slate-800 rounded overflow-hidden">
          {renderCollapsibleSectionHeader({
            sectionId: 'gps-loop-suspects',
            label: 'GPS Loop Suspects (ranked)',
            className:
              'px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs uppercase tracking-wider',
            labelClassName: 'text-slate-100',
          })}
          {!isSectionCollapsed('gps-loop-suspects') && (
            <>
              <table className="w-full text-left text-xs">
                <thead><tr className="text-slate-200 border-b border-slate-700/80"><th className="py-2 px-3">#</th><th className="py-2">Loop</th><th className="py-2 text-right">Mag ({units})</th><th className="py-2 text-right">Tol ({units})</th><th className="py-2 text-right">Linear (ppm)</th><th className="py-2 text-right">Ratio</th><th className="py-2 text-right">Severity</th><th className="py-2 text-right px-3">Status</th></tr></thead>
                <tbody className="text-slate-300">
                  {visibleGpsLoopSuspects.map((loop, idx) => (
                    <tr key={`gps-loop-suspect-${loop.key}-${idx}`} className="border-b border-slate-800/30">
                      <td className="py-1 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-1">{loop.key}</td>
                      <td className="py-1 text-right font-mono">{(loop.closureMag * unitScale).toFixed(4)}</td>
                      <td className="py-1 text-right font-mono">{(loop.toleranceM * unitScale).toFixed(4)}</td>
                      <td className="py-1 text-right font-mono">{loop.linearPpm != null ? loop.linearPpm.toFixed(1) : '-'}</td>
                      <td className="py-1 text-right font-mono">{loop.closureRatio != null ? `1:${loop.closureRatio.toFixed(0)}` : '-'}</td>
                      <td className="py-1 text-right font-mono">{loop.severity.toFixed(2)}</td>
                      <td className="py-1 px-3 text-right font-mono text-yellow-400">WARN</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {renderLoadMoreFooter('gps-loop-suspects', visibleGpsLoopSuspects.length, gpsLoopSuspects.length)}
            </>
          )}
        </div>
      )}
    </>
  );
};

export default LoopDiagnosticsSections;
