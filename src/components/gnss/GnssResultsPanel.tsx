/**
 * Phase 12G — GNSS results panel.
 *
 * Renders the production adjust result: network summary, adjusted ECEF
 * stations, baseline residuals/statistics, loop QC, removal what-if
 * (diagnostic only), and text/JSON export. ECEF authoritative throughout;
 * no projected coordinates, no legacy GPS wording.
 */
import React, { useMemo, useState } from 'react';
import type { GnssBaselineAdjustInput } from '../../engine/gnssBaselineAdjust';
import type { GnssDatumSummary } from '../../engine/gnssFreeNetwork';
import { computeGnssLoopClosures } from '../../engine/gnssBaselineLoops';
import {
  buildGnssBaselineReport,
  renderGnssBaselineTextReport,
  runGnssBaselineRemovalWhatIf,
  type GnssBaselineReport,
} from '../../engine/gnssBaselineReport';
import { saveBrowserTextFile } from '../../engine/browserFileIo';
import type { GnssRunOutcome } from '../../hooks/useGnssBaselineWorker';

const WHAT_IF_BASELINE_LIMIT = 25;
// ponytail: relative precision deferred — baseline-detail "relative to station" selector
// (Qrel = Qii + Qjj - Qij - Qji) needs block extraction + selected-blocks fallback; not tiny.

const FREE_QC_TOOLTIP = 'Residual/QC statistics are invariant to the free-network translation datum.';
const INNER_PRECISION_TOOLTIP =
  "The coordinate covariance for this station is relative to WebNet's inner-constrained free-network datum. " +
  'It depends on the chosen datum definition and should not be interpreted as absolute external control uncertainty.';

/** Per-station datum kind from the backend summary (anchor names never surface). */
const datumKindByStation = (summary: GnssDatumSummary): Map<string, 'constrained' | 'free'> => {
  const byStation = new Map<string, 'constrained' | 'free'>();
  summary.components.forEach((component) => {
    component.stations.forEach((id) => byStation.set(id, component.kind));
  });
  return byStation;
};

const fmt = (value: number | undefined, digits = 4): string =>
  value == null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);

const covToString = (cov: { xx: number; xy: number; xz: number; yy: number; yz: number; zz: number }): string =>
  `[[${cov.xx.toExponential(3)}, ${cov.xy.toExponential(3)}, ${cov.xz.toExponential(3)}], ` +
  `[${cov.xy.toExponential(3)}, ${cov.yy.toExponential(3)}, ${cov.yz.toExponential(3)}], ` +
  `[${cov.xz.toExponential(3)}, ${cov.yz.toExponential(3)}, ${cov.zz.toExponential(3)}]]`;

interface GnssResultsPanelProps {
  input: GnssBaselineAdjustInput;
  outcome: GnssRunOutcome;
}

export const GnssResultsPanel: React.FC<GnssResultsPanelProps> = ({ input, outcome }) => {
  const [selectedBaseline, setSelectedBaseline] = useState<number | null>(null);
  const { result } = outcome;

  const report: GnssBaselineReport = useMemo(() => {
    const loops = computeGnssLoopClosures(input.baselines);
    const effectiveById = new Map(
      (result.setupContributions ?? []).map((contribution) => [contribution.baselineId, contribution]),
    );
    const observations = input.baselines.map((baseline) => {
      const contribution = effectiveById.get(baseline.id);
      return contribution
        ? {
            ...baseline,
            covariance: contribution.effectiveCovariance,
            rawCovariance: contribution.rawCovariance,
            setupCovariance: contribution.setupCovariance,
          }
        : baseline;
    });
    const built = buildGnssBaselineReport(
      result,
      result.statistics,
      loops.loops,
      input,
      observations,
      result.setupModel,
    );
    return { ...built, connectedComponents: loops.componentCount, cycleRank: loops.cycleRank };
  }, [input, result]);

  const whatIfInput: GnssBaselineAdjustInput = useMemo(
    () => (result.datumSummary ? { ...input, datumMode: 'allow-free' } : input),
    [input, result],
  );

  const whatIf = useMemo(
    () =>
      whatIfInput.baselines.length <= WHAT_IF_BASELINE_LIMIT
        ? whatIfInput.baselines.map((baseline) => runGnssBaselineRemovalWhatIf(whatIfInput, baseline.id))
        : null,
    [whatIfInput],
  );

  const stationRows = useMemo(() => {
    const dense = 'qxx' in result ? result.qxx : null;
    return Object.keys(result.stations)
      .sort()
      .map((id) => {
        const adjusted = result.stations[id];
        const prior = input.stations[id];
        const fixed = !!adjusted?.fixedX && !!adjusted?.fixedY && !!adjusted?.fixedH;
        let sigma: [number, number, number] | null = null;
        if (!fixed && dense) {
          const base = result.unknowns.indexOf(id) * 3;
          if (base >= 0) {
            sigma = [
              Math.sqrt(Math.max((dense[base]?.[base] ?? Number.NaN) * result.varianceFactor, 0)),
              Math.sqrt(Math.max((dense[base + 1]?.[base + 1] ?? Number.NaN) * result.varianceFactor, 0)),
              Math.sqrt(Math.max((dense[base + 2]?.[base + 2] ?? Number.NaN) * result.varianceFactor, 0)),
            ];
          }
        } else if (fixed) {
          sigma = [0, 0, 0];
        }
        return {
          id,
          x: adjusted?.x ?? 0,
          y: adjusted?.y ?? 0,
          z: adjusted?.h ?? 0,
          dx: (adjusted?.x ?? 0) - (prior?.x ?? 0),
          dy: (adjusted?.y ?? 0) - (prior?.y ?? 0),
          dz: (adjusted?.h ?? 0) - (prior?.h ?? 0),
          fixed,
          sigma,
        };
      });
  }, [input, result]);

  const detail = selectedBaseline != null
    ? report.baselines.find((entry) => entry.baselineId === selectedBaseline) ?? null
    : null;
  const detailInput = selectedBaseline != null
    ? input.baselines.find((baseline) => baseline.id === selectedBaseline) ?? null
    : null;
  const selectedEffectiveCov = useMemo(
    () =>
      selectedBaseline != null
        ? result.setupContributions?.find((contribution) => contribution.baselineId === selectedBaseline)?.effectiveCovariance ?? null
        : null,
    [result, selectedBaseline],
  );

  const handleTextExport = (): void => {
    const stations = stationRows
      .map((row) => `${row.id} X=${row.x.toFixed(4)} Y=${row.y.toFixed(4)} Z=${row.z.toFixed(4)} ${row.fixed ? 'FIXED' : 'FREE'}`)
      .join('\n');
    void saveBrowserTextFile('gnss-baseline-report.txt', `${renderGnssBaselineTextReport(report)}\nADJUSTED ECEF STATIONS\n${stations}\n`, [
      { description: 'Text', accept: { 'text/plain': ['.txt'] } },
    ]);
  };

  const handleJsonExport = (): void => {
    void saveBrowserTextFile(
      'gnss-baseline-report.json',
      `${JSON.stringify({ report, stations: result.stations, ...(result.datumSummary ? { datumSummary: result.datumSummary } : {}), route: outcome.route, reasons: outcome.reasons }, null, 2)}\n`,
      [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
    );
  };

  const datum = result.datumSummary ?? null;
  const datumByStation = useMemo(() => (datum ? datumKindByStation(datum) : null), [datum]);
  const fixedIds = useMemo(
    () =>
      new Set(
        Object.entries(result.stations)
          .filter(([, station]) => !!station?.fixedX && !!station?.fixedY && !!station?.fixedH)
          .map(([id]) => id),
      ),
    [result],
  );

  return (
    <div className="space-y-4">
      <section aria-label="Adjustment summary" className="border border-slate-700 rounded p-3 text-xs">
        <h3 className="text-sm font-medium mb-1">Static GNSS Baseline Network — ECEF dX/dY/dZ (adjusted)</h3>
        <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
          <div><dt className="text-slate-500">Stations</dt><dd>{report.stationCount} ({report.fixedStationCount} fixed)</dd></div>
          <div><dt className="text-slate-500">Baselines</dt><dd>{report.baselineCount}</dd></div>
          <div><dt className="text-slate-500">Equations</dt><dd>{report.observationEquationCount}</dd></div>
          <div><dt className="text-slate-500">Unknowns</dt><dd>{report.unknownCount}</dd></div>
          <div><dt className="text-slate-500" title="Degrees of freedom: equations minus unknowns; the redundancy the network check rests on.">DOF</dt><dd>{report.degreesOfFreedom}</dd></div>
          <div><dt className="text-slate-500" title="Standard error of unit weight: overall agreement between residuals and the stated covariances. Near 1 means the weighting matches the observed scatter.">SEUW</dt><dd>{fmt(report.seuw)}</dd></div>
          <div><dt className="text-slate-500" title="Weighted sum of squared residuals (vTPv): the minimized least-squares objective at convergence.">vTPv</dt><dd>{report.weightedResidualSum.toExponential(4)}</dd></div>
          <div><dt className="text-slate-500">Convergence</dt><dd>{result.converged ? `yes (${result.iterations} iter)` : 'no'}</dd></div>
        </dl>
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-400">Advanced: route provenance</summary>
          <p className="mt-1 text-slate-400">
            Route: {outcome.route}{outcome.workerBacked ? ' (production worker)' : ' (direct)'}
            {outcome.reasons.length > 0 && ` — ${outcome.reasons.join('; ')}`}
            {' '}· report route: {report.routeProvenance}
            {datum && ' · free-network engine: TypeScript dense inner-constraint (supported production route for free networks, not a fallback failure)'}
          </p>
        </details>
      </section>

      {datum && (
        <section aria-label="Datum definition" className="border border-sky-700 bg-sky-950/40 rounded p-3 text-xs">
          <h3 className="text-sm font-medium mb-1">
            Datum: {datum.kind === 'mixed' ? 'MIXED' : 'FREE — INNER CONSTRAINED'}
            <span className="sr-only">{datum.kind === 'mixed' ? 'mixed free and constrained components' : 'free network, inner-constrained datum'}</span>
          </h3>
          <p className="text-slate-300">Zero-mean ECEF coordinate corrections per free component.</p>
          <p className="text-slate-400">Datum defect: 3 per free component · requested mode: {datum.modeRequested}</p>
          <dl className="grid grid-cols-2 md:grid-cols-5 gap-x-4 gap-y-1 mt-2">
            <div><dt className="text-slate-500">Coordinate parameters</dt><dd>{datum.fullParameterCount}</dd></div>
            <div><dt className="text-slate-500">Datum defect</dt><dd>{datum.totalDatumDefect}</dd></div>
            <div><dt className="text-slate-500">Estimable rank</dt><dd>{datum.estimableRank}</dd></div>
            <div><dt className="text-slate-500">Scalar observations</dt><dd>{result.numObsEquations}</dd></div>
            <div><dt className="text-slate-500">Degrees of freedom</dt><dd>{result.dof} (expected {result.numObsEquations - datum.estimableRank})</dd></div>
          </dl>
          <ul className="mt-2 space-y-1 text-slate-300">
            {datum.components.map((component, index) => {
              const control = component.kind === 'constrained'
                ? component.stations.filter((id) => fixedIds.has(id))
                : [];
              return (
                <li key={index}>
                  Component {index + 1} — {component.kind === 'constrained'
                    ? `constrained by ${control.length > 0 ? control.join(', ') : 'control'}`
                    : 'free, inner constrained'} ({component.stations.length} station(s), rank {component.rank}/{component.paramCount})
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-label="Adjusted stations" className="border border-slate-700 rounded p-3 text-xs">
        <h3 className="text-sm font-medium mb-2">Adjusted ECEF stations (metres)</h3>
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="py-1 pr-2">Station</th>
              <th className="py-1 pr-2">X</th>
              <th className="py-1 pr-2">Y</th>
              <th className="py-1 pr-2">Z</th>
              <th className="py-1 pr-2">dX</th>
              <th className="py-1 pr-2">dY</th>
              <th className="py-1 pr-2">dZ</th>
              <th className="py-1 pr-2">Control</th>
              {datum && <th className="py-1 pr-2">Datum</th>}
              <th className="py-1 pr-2" title={datum ? INNER_PRECISION_TOOLTIP : undefined}>{datum ? 'Inner-constrained precision (m)' : 'σ (m)'}</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {stationRows.map((row) => (
              <tr key={row.id} className="border-b border-slate-800">
                <td className="py-1 pr-2">{row.id}</td>
                <td className="py-1 pr-2">{row.x.toFixed(4)}</td>
                <td className="py-1 pr-2">{row.y.toFixed(4)}</td>
                <td className="py-1 pr-2">{row.z.toFixed(4)}</td>
                <td className="py-1 pr-2">{row.dx >= 0 ? '+' : ''}{row.dx.toFixed(4)}</td>
                <td className="py-1 pr-2">{row.dy >= 0 ? '+' : ''}{row.dy.toFixed(4)}</td>
                <td className="py-1 pr-2">{row.dz >= 0 ? '+' : ''}{row.dz.toFixed(4)}</td>
                <td className="py-1 pr-2 font-sans">{row.fixed ? 'FIXED' : 'FREE'}</td>
                {datumByStation && <td className="py-1 pr-2 font-sans">{datumByStation.get(row.id) === 'free' ? 'free, inner constrained' : 'constrained'}</td>}
                <td className="py-1 pr-2">{row.sigma ? `${fmt(row.sigma[0], 5)} / ${fmt(row.sigma[1], 5)} / ${fmt(row.sigma[2], 5)}` : 'n/a (selected-blocks route)'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Baselines" className="border border-slate-700 rounded p-3 text-xs">
        <h3 className="text-sm font-medium mb-2" title={datum ? FREE_QC_TOOLTIP : undefined}>Baselines (observed / computed / residual, metres)</h3>
        <table className="w-full">
          <thead>
            <tr className="text-left text-slate-400 border-b border-slate-700">
              <th className="py-1 pr-2">ID</th>
              <th className="py-1 pr-2">Vector</th>
              <th className="py-1 pr-2">|v|</th>
              <th className="py-1 pr-2" title="Standardized residuals per component: residual divided by its own uncertainty. Values beyond ±3 deserve a look at the underlying session.">t (x/y/z)</th>
              <th className="py-1 pr-2" title="Redundancy trace: how much of this baseline is checked by the rest of the network (0 = unchecked, up to 3 = fully checked).">r trace</th>
              <th className="py-1 pr-2" title="Whole-block diagnostic T for this baseline. A large T flags the whole 3-component vector, never a single component.">Block T</th>
              <th className="py-1 pr-2">Session / source</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {report.baselines.map((entry) => (
              <tr
                key={entry.baselineId}
                onClick={() => setSelectedBaseline(entry.baselineId)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedBaseline(entry.baselineId);
                  }
                }}
                tabIndex={0}
                aria-label={`Baseline ${entry.baselineId} ${entry.from} to ${entry.to}, select for detail`}
                className={`border-b border-slate-800 cursor-pointer ${selectedBaseline === entry.baselineId ? 'bg-slate-800' : ''}`}
              >
                <td className="py-1 pr-2">#{entry.baselineId} {entry.from}→{entry.to}</td>
                <td className="py-1 pr-2">v=({fmt(entry.residual.x)} {fmt(entry.residual.y)} {fmt(entry.residual.z)})</td>
                <td className="py-1 pr-2">{fmt(entry.residual.magnitude)}</td>
                <td className="py-1 pr-2">{fmt(entry.standardized.x, 2)} / {fmt(entry.standardized.y, 2)} / {fmt(entry.standardized.z, 2)}</td>
                <td className="py-1 pr-2">{fmt(entry.redundancy.trace, 3)}</td>
                <td className="py-1 pr-2">{entry.blockT != null ? fmt(entry.blockT, 2) : 'n/a'}</td>
                <td className="py-1 pr-2">{entry.sessionId ?? entry.solutionId ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {detail && (
          <div aria-label="Baseline detail" className="mt-3 border border-slate-600 rounded p-2 space-y-2">
            <h4 className="font-medium">Baseline #{detail.baselineId} {detail.from}→{detail.to} detail</h4>
            <p className="font-mono">observed=({fmt(detail.observed.x)} {fmt(detail.observed.y)} {fmt(detail.observed.z)}) computed=({fmt(detail.computed.x)} {fmt(detail.computed.y)} {fmt(detail.computed.z)})</p>
            <p className="font-mono">residual Qvv/Cvv diag: ({detail.residualCovariance ? `${detail.residualCovariance.xx.toExponential(3)}, ${detail.residualCovariance.yy.toExponential(3)}, ${detail.residualCovariance.zz.toExponential(3)}` : 'n/a'}) m²</p>
            <p>redundancy=({fmt(detail.redundancy.x, 3)} {fmt(detail.redundancy.y, 3)} {fmt(detail.redundancy.z, 3)}) trace={fmt(detail.redundancy.trace, 3)} · blockT={detail.blockT != null ? fmt(detail.blockT, 2) : 'n/a'} rank={detail.blockRank ?? 'n/a'} · status={detail.status}</p>
            <details>
              <summary className="cursor-pointer">Raw covariance (as imported, m²)</summary>
              <p className="font-mono mt-1">{detail.rawCovariance ? covToString(detail.rawCovariance) : covToString(detailInput?.covariance ?? { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 })}{detail.rawCovariance ? '' : ' (setup inactive: raw = effective)'}</p>
            </details>
            {detail.setupCovariance && (
              <details>
                <summary className="cursor-pointer">Setup covariance (summed endpoint contribution, m²)</summary>
                <p className="font-mono mt-1">{covToString(detail.setupCovariance)}</p>
              </details>
            )}
            <details>
              <summary className="cursor-pointer">Effective covariance (what weighted the solve, m²)</summary>
              <p className="font-mono mt-1">{covToString(selectedEffectiveCov ?? detailInput?.covariance ?? { xx: 0, xy: 0, xz: 0, yy: 0, yz: 0, zz: 0 })}{selectedEffectiveCov ? '' : ' (setup inactive: raw = effective)'}</p>
            </details>
          </div>
        )}
      </section>

      <section aria-label="Loop QC" className="border border-slate-700 rounded p-3 text-xs">
        <h3 className="text-sm font-medium mb-2" title={datum ? FREE_QC_TOOLTIP : 'Loop closures compare observed vectors around a closed ring before adjustment. A small closure means the sessions agree with each other.'}>Loop QC</h3>
        {report.loops.length === 0 ? (
          <p className="text-slate-500">(no fundamental cycles — nothing to close)</p>
        ) : (
          <ul className="space-y-1 font-mono">
            {report.loops.map((loop) => (
              <li key={loop.id}>
                {loop.id}: |s|={fmt(loop.magnitude)} m T_loop={loop.tLoop != null ? fmt(loop.tLoop, 2) : 'n/a'} status={loop.status}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Removal impact" className="border border-slate-700 rounded p-3 text-xs">
        <h3 className="text-sm font-medium mb-1">Removal impact (diagnostic what-if — nothing is deleted)</h3>
        {whatIf == null ? (
          <p className="text-slate-500">What-if skipped: networks over {WHAT_IF_BASELINE_LIMIT} baselines rerun one solve per baseline.</p>
        ) : (
          <ul className="space-y-1 font-mono">
            {whatIf.map((entry) => (
              <li key={entry.removedBaselineId}>
                without #{entry.removedBaselineId}: {entry.solvable ? `SEUW ${fmt(entry.seuwBefore)} → ${fmt(entry.seuwAfter)}, max shift ${entry.maxCoordinateShiftM != null ? fmt(entry.maxCoordinateShiftM) : 'n/a'} m` : `not solvable — ${entry.reason ?? 'uncontrolled'}`}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex gap-2">
        <button type="button" onClick={handleTextExport} className="text-xs px-3 py-1.5 border border-slate-600 rounded hover:bg-slate-800">Export text report</button>
        <button type="button" onClick={handleJsonExport} className="text-xs px-3 py-1.5 border border-slate-600 rounded hover:bg-slate-800">Export JSON report</button>
      </div>
    </div>
  );
};
