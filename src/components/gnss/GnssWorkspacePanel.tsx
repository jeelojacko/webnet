/**
 * Phase 12G — static GNSS workspace panel (import + control + preflight + adjust).
 *
 * PRODUCT ONLY: parses GVX / delimited CSV / synthetic sample through the
 * production importers, assembles the session input, gates on preflight,
 * and runs the production worker route. No math lives here.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { StationMap } from '../../types';
import { importGnssBaselineGvx } from '../../engine/gnssGvxImport';
import {
  importGnssBaselineDelimited,
  importGnssControlCsv,
} from '../../engine/gnssBaselineCsvImport';
import type {
  GnssBaselineNetworkInput,
  GnssDiagnostic,
} from '../../engine/gnssBaselineNetworkImport';
import { buildGnssSampleNetwork } from '../../engine/gnssSampleNetwork';
import { buildGnssSessionInput,
  runGnssWorkspacePreflight,
  setStationFixed,
  summarizeGnssImport,
  type GnssImportFormat,
} from '../../engine/gnssWorkspaceSession';
import {
  classifyGnssDatumComponents,
  GNSS_FREE_NETWORK_MAX_STATIONS,
  isFullyFixedStation,
  type GnssDatumMode,
} from '../../engine/gnssFreeNetwork';
import { GnssDatumHandlingSelector } from './GnssDatumHandlingSelector';
import { useGnssBaselineWorker, type GnssRunOutcome } from '../../hooks/useGnssBaselineWorker';
import { GnssResultsPanel } from './GnssResultsPanel';
import { GnssStationTable } from './GnssStationTable';
import { mapGnssRunError } from './gnssRunErrorText';

export interface GnssExternalImport {
  readonly fileName: string;
  readonly text: string;
}

export interface GnssWorkspacePanelProps {
  runner?: (_input: Parameters<ReturnType<typeof useGnssBaselineWorker>['run']>[0]) => Promise<GnssRunOutcome>;
  pendingExternalImport?: GnssExternalImport | null;
  onConsumePendingImport?: () => void;
}

export const GnssWorkspacePanel: React.FC<GnssWorkspacePanelProps> = ({ runner, pendingExternalImport = null, onConsumePendingImport }) => {
  const worker = useGnssBaselineWorker();
  const [network, setNetwork] = useState<GnssBaselineNetworkInput | null>(null);
  const [diagnostics, setDiagnostics] = useState<GnssDiagnostic[]>([]);
  const [format, setFormat] = useState<GnssImportFormat>('unknown');
  const [sourceFile, setSourceFile] = useState('');
  const [csvStations, setCsvStations] = useState<StationMap | null>(null);
  const [csvFrame, setCsvFrame] = useState('');
  const [csvEpoch, setCsvEpoch] = useState('');
  const [csvEllipsoid, setCsvEllipsoid] = useState('WGS84');
  const [fixedOverrides, setFixedOverrides] = useState<Record<string, boolean>>({});
  const [datumMode, setDatumMode] = useState<GnssDatumMode>('constrained');
  const [centeringSigma, setCenteringSigma] = useState('0.000');
  const [heightSigma, setHeightSigma] = useState('0.000');
  const [outcome, setOutcome] = useState<GnssRunOutcome | null>(null);
  const [runError, setRunError] = useState<string | null>(null);

  const loadNetwork = useCallback(
    (
      next: GnssBaselineNetworkInput | null,
      nextDiagnostics: GnssDiagnostic[],
      nextFormat: GnssImportFormat,
      nextFile: string,
    ): void => {
      setNetwork(next);
      setDiagnostics(nextDiagnostics);
      setFormat(next ? nextFormat : 'unknown');
      setSourceFile(nextFile);
      setFixedOverrides({});
      setDatumMode('constrained');
      setOutcome(null);
      setRunError(
        next
          ? null
          : nextDiagnostics
              .filter((entry) => entry.severity === 'error')
              .map((entry) => entry.message)
              .join('\n') || 'Import failed.',
      );
    },
    [],
  );

  useEffect(() => {
    const handleExternal = (event: Event): void => {
      const detail = (event as CustomEvent<{ fileName: string; text: string }>).detail;
      if (!detail || typeof detail.text !== 'string') return;
      const imported = importGnssBaselineGvx(detail.text, detail.fileName);
      loadNetwork(imported.network, imported.diagnostics, 'gvx', detail.fileName);
    };
    window.addEventListener('webnet:open-gnss', handleExternal);
    return () => window.removeEventListener('webnet:open-gnss', handleExternal);
  }, [loadNetwork]);

  useEffect(() => {
    if (!pendingExternalImport) return;
    const imported = importGnssBaselineGvx(pendingExternalImport.text, pendingExternalImport.fileName);
    loadNetwork(imported.network, imported.diagnostics, 'gvx', pendingExternalImport.fileName);
    onConsumePendingImport?.();
  }, [pendingExternalImport, onConsumePendingImport, loadNetwork]);

  const sessionInput = useMemo(
    () =>
      network
        ? buildGnssSessionInput(network, {
            fixedOverrides,
            datumMode,
            setup: {
              horizontalCenteringSigma: Number(centeringSigma),
              antennaHeightSigma: Number(heightSigma),
            },
          })
        : null,
    [network, fixedOverrides, datumMode, centeringSigma, heightSigma],
  );

  const summary = useMemo(
    () =>
      network ? summarizeGnssImport(network, diagnostics, { format, sourceFile }) : null,
    [network, diagnostics, format, sourceFile],
  );

  const preflight = useMemo(
    () => (sessionInput ? runGnssWorkspacePreflight(sessionInput, datumMode) : null),
    [sessionInput, datumMode],
  );

  const datumClassification = useMemo(
    () =>
      sessionInput
        ? classifyGnssDatumComponents(sessionInput.stations, sessionInput.baselines)
        : null,
    [sessionInput],
  );
  const freeComponentCount = datumClassification?.freeComponents.length ?? 0;
  const totalStationCount = sessionInput ? Object.keys(sessionInput.stations).length : 0;
  const freeOverSizeCap =
    datumMode === 'allow-free' &&
    freeComponentCount > 0 &&
    totalStationCount > GNSS_FREE_NETWORK_MAX_STATIONS;

  const sigmaInvalid =
    !Number.isFinite(Number(centeringSigma)) ||
    Number(centeringSigma) < 0 ||
    !Number.isFinite(Number(heightSigma)) ||
    Number(heightSigma) < 0;

  const handleGvxFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const imported = importGnssBaselineGvx(text, file.name);
      loadNetwork(imported.network, imported.diagnostics, 'gvx', file.name);
    };
    reader.readAsText(file);
  };

  const handleControlCsv = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const imported = importGnssControlCsv(text, { units: 'm', sourceFile: file.name });
      if (!imported.stations) {
        setRunError(imported.diagnostics.map((entry) => entry.message).join('\n'));
        return;
      }
      setCsvStations(imported.stations);
      setRunError(null);
    };
    reader.readAsText(file);
  };

  const handleBaselineCsv = (file: File): void => {
    if (!csvStations) {
      setRunError('Load a stations/control CSV first, then the baselines CSV.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      const imported = importGnssBaselineDelimited(text, csvStations, {
        units: 'm',
        vectorFrame: 'ecef',
        referenceFrame: csvFrame.trim() === '' ? 'unknown' : csvFrame.trim(),
        epoch: csvEpoch.trim() === '' ? undefined : csvEpoch.trim(),
        ellipsoid: csvEllipsoid.trim() === '' ? undefined : csvEllipsoid.trim(),
        sourceFile: file.name,
      });
      loadNetwork(imported.network, imported.diagnostics, 'delimited', file.name);
    };
    reader.readAsText(file);
  };

  const handleSample = (): void => {
    const sample = buildGnssSampleNetwork();
    loadNetwork(sample, [], 'sample', 'synthetic-sample');
  };

  const handleToggleFixed = (id: string, fixed: boolean): void => {
    setFixedOverrides((prev) => ({ ...prev, [id]: fixed }));
    setOutcome(null);
  };

  const handleDatumModeChange = (mode: GnssDatumMode): void => {
    setDatumMode(mode);
    setOutcome(null);
  };

  const effectiveStations: StationMap | null = useMemo(() => {
    if (!network) return null;
    let stations = network.stations;
    Object.keys(fixedOverrides)
      .sort()
      .forEach((id) => {
        stations = setStationFixed(stations, id, fixedOverrides[id] ?? false);
      });
    return stations;
  }, [network, fixedOverrides]);

  const handleAdjust = (): void => {
    if (!sessionInput || sigmaInvalid) return;
    if (preflight && !preflight.pass) {
      setRunError(preflight.gates.filter((gate) => !gate.pass).map((gate) => gate.message).join('\n'));
      return;
    }
    setRunError(null);
    const run = runner ?? worker.run;
    void run(sessionInput).then(
      (next) => setOutcome(next),
      (failure: unknown) =>
        setRunError(failure instanceof Error ? failure.message : String(failure)),
    );
  };

  const running = worker.status === 'running';

  return (
    <div className="p-4 space-y-4 text-slate-200 max-w-5xl">
      <h2 className="text-base font-semibold">Static GNSS Baseline Network — ECEF dX/dY/dZ</h2>
      <p className="text-xs text-slate-400">
        Processed baselines only (GVX, delimited CSV, or synthetic sample). ECEF vectors with full
        3×3 correlated covariance. No RINEX, no PPP, no terrestrial mixing.
      </p>

      <section aria-label="Import" className="space-y-2 border border-slate-700 rounded p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs font-medium" htmlFor="gnss-gvx-file">
            GVX file
          </label>
          <input
            id="gnss-gvx-file"
            type="file"
            accept=".gvx,.xml"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (file) handleGvxFile(file);
            }}
            className="text-xs"
          />
          <button
            type="button"
            onClick={handleSample}
            className="text-xs px-2 py-1 border border-slate-600 rounded hover:bg-slate-800"
          >
            Load synthetic sample
          </button>
        </div>
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-300">Delimited CSV (stations + baselines)</summary>
          <div className="mt-2 space-y-2">
            <div className="flex flex-wrap gap-2 items-center">
              <label htmlFor="gnss-csv-frame">Reference frame</label>
              <input id="gnss-csv-frame" type="text" value={csvFrame} onChange={(e) => setCsvFrame(e.target.value)} placeholder="e.g. ITRF2020" className="bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              <label htmlFor="gnss-csv-epoch">Epoch</label>
              <input id="gnss-csv-epoch" type="text" value={csvEpoch} onChange={(e) => setCsvEpoch(e.target.value)} placeholder="e.g. 2020.0" className="bg-slate-800 border border-slate-700 rounded px-2 py-1" />
              <label htmlFor="gnss-csv-ellipsoid">Ellipsoid</label>
              <input id="gnss-csv-ellipsoid" type="text" value={csvEllipsoid} onChange={(e) => setCsvEllipsoid(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1" />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label htmlFor="gnss-csv-stations">1. Stations CSV (id,X,Y,Z,fixed)</label>
              <input id="gnss-csv-stations" type="file" accept=".csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleControlCsv(f); }} />
            </div>
            <div className="flex flex-wrap gap-2 items-center">
              <label htmlFor="gnss-csv-baselines">2. Baselines CSV</label>
              <input id="gnss-csv-baselines" type="file" accept=".csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) handleBaselineCsv(f); }} />
              {csvStations && <span className="text-slate-500">stations loaded: {Object.keys(csvStations).length}</span>}
            </div>
          </div>
        </details>
      </section>

      {summary && (
        <section aria-label="Import summary" className="border border-slate-700 rounded p-3 text-xs">
          <h3 className="font-medium mb-1">Import summary</h3>
          <dl className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1">
            <div><dt className="text-slate-500">Format</dt><dd>{summary.format}</dd></div>
            <div><dt className="text-slate-500">Source</dt><dd className="break-all">{summary.sourceFile || 'unknown'}</dd></div>
            <div><dt className="text-slate-500">Reference frame</dt><dd>{summary.referenceFrame}</dd></div>
            <div><dt className="text-slate-500">Epoch</dt><dd>{summary.epoch}</dd></div>
            <div><dt className="text-slate-500">Ellipsoid</dt><dd>{summary.ellipsoid}</dd></div>
            <div><dt className="text-slate-500">Adjustment frame</dt><dd>{summary.adjustmentFrame}</dd></div>
            <div><dt className="text-slate-500">Stations</dt><dd>{summary.stationCount} ({summary.fixedStationCount} fixed, {summary.freeStationCount} free)</dd></div>
            <div><dt className="text-slate-500">Baselines</dt><dd>{summary.baselineCount} in {summary.componentCount} component(s)</dd></div>
            <div><dt className="text-slate-500">Covariance</dt><dd>{summary.covarianceSource} · {summary.covarianceRepresentation}</dd></div>
          </dl>
          {summary.warnings.length > 0 && (
            <ul className="mt-2 text-amber-300 list-disc ml-4">
              {summary.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {effectiveStations && (
        <section aria-label="Stations and control" className="border border-slate-700 rounded p-3">
          <h3 className="text-sm font-medium mb-2">Stations and datum control (full-XYZ only)</h3>
          <GnssStationTable stations={effectiveStations} onToggleFixed={handleToggleFixed} />
        </section>
      )}

      {sessionInput && datumClassification && (
        <section aria-label="Datum handling" className="border border-slate-700 rounded p-3 space-y-2">
          <GnssDatumHandlingSelector value={datumMode} onChange={handleDatumModeChange} />
          <div className="text-xs">
            <h4 className="font-medium">Component datum summary</h4>
            <ul className="mt-1 space-y-0.5">
              {datumClassification.components.map((component, index) => {
                const free = datumClassification.freeComponents.some(
                  (entry) => entry[0] === component[0],
                );
                const controls = component.filter((id) =>
                  isFullyFixedStation(sessionInput.stations, id),
                );
                return (
                  <li key={component[0] ?? index}>
                    Component {index + 1}: {free ? 'Free' : 'Constrained'} ·{' '}
                    {controls.length > 0 ? `control ${controls.join(', ')}` : 'no control'} ·{' '}
                    {component.length} station(s) · defect {free ? 3 : 0}
                  </li>
                );
              })}
            </ul>
            <p className="mt-1 text-slate-400">
              {datumClassification.components.length} component(s) (
              {datumClassification.components.length - freeComponentCount} constrained,{' '}
              {freeComponentCount} free) · total datum defect {freeComponentCount * 3}
            </p>
          </div>
          {datumMode === 'allow-free' && freeComponentCount > 0 && !freeOverSizeCap && (
            <p role="note" className="text-xs text-sky-300">
              Free-network coordinates and coordinate uncertainties are expressed in an inner-constrained datum. Residuals, network QC, and relative precision are datum invariant.
            </p>
          )}
          {datumMode === 'allow-free' && freeComponentCount === 0 && (
            <p role="note" className="text-xs text-slate-400">
              All components are currently constrained by real control. WebNet will use the ordinary constrained adjustment.
            </p>
          )}
          {freeOverSizeCap && (
            <div role="alert" className="text-xs text-red-200">
              <p>
                Free-network size limit exceeded: this network has {totalStationCount} stations (certified maximum {GNSS_FREE_NETWORK_MAX_STATIONS} for the inner-constrained free-network route). Add real control or reduce the network before adjusting.
              </p>
              <details className="mt-1 text-slate-400">
                <summary className="cursor-pointer">Advanced details</summary>
                <p>FREE_NETWORK_SIZE_LIMIT: {totalStationCount} stations over the certified max {GNSS_FREE_NETWORK_MAX_STATIONS}; fail-closed.</p>
              </details>
            </div>
          )}
        </section>
      )}

      {network && (
        <section aria-label="Setup uncertainty" className="border border-slate-700 rounded p-3 text-xs space-y-2">
          <h3 className="text-sm font-medium">Setup uncertainty (metres, 1-sigma)</h3>
          <p className="text-slate-400">
            Tripod centering (EN plane) and antenna height (Up) error, rotated per-endpoint to
            ECEF. Augments — never replaces — the raw baseline covariance. Defaults 0.000 m
            (no augmentation, bit-identical solve).
          </p>
          <div className="flex flex-wrap gap-3 items-center">
            <label htmlFor="gnss-setup-centering">Centering σ EN (m)</label>
            <input id="gnss-setup-centering" type="text" inputMode="decimal" value={centeringSigma} onChange={(e) => setCenteringSigma(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-24" />
            <label htmlFor="gnss-setup-height">Height σ Up (m)</label>
            <input id="gnss-setup-height" type="text" inputMode="decimal" value={heightSigma} onChange={(e) => setHeightSigma(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-24" />
            {sigmaInvalid && <span role="alert" className="text-red-300">Setup sigmas must be finite numbers ≥ 0 m.</span>}
          </div>
        </section>
      )}

      {preflight && (
        <section aria-label="Preflight" className="border border-slate-700 rounded p-3 text-xs">
          <h3 className="text-sm font-medium mb-2">Preflight</h3>
          <ul className="space-y-1">
            {preflight.gates.map((gate) => (
              <li key={gate.id} className={gate.pass ? 'text-emerald-300' : 'text-red-300'}>
                <span aria-label={gate.pass ? 'pass' : 'fail'}>{gate.pass ? '✓' : '✗'}</span>{' '}
                <strong>{gate.id}</strong>: {gate.message}
              </li>
            ))}
          </ul>
          {preflight.warnings.length > 0 && (
            <ul className="mt-2 text-amber-300 list-disc ml-4">
              {preflight.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {network && (
        <div>
          <button
            type="button"
            onClick={handleAdjust}
            disabled={running || sigmaInvalid || !sessionInput}
            className="px-4 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:opacity-50 rounded text-sm font-medium"
          >
            {running ? 'Adjusting…' : 'Adjust (production route)'}
          </button>
        </div>
      )}

      {runError && (() => {
        const mapped = mapGnssRunError(runError);
        return (
          <div role="alert" className="border border-red-700 bg-red-950/50 rounded p-3 text-xs text-red-200 whitespace-pre-wrap">
            {mapped ? mapped.text : runError}
            {mapped && (
              <details className="mt-2 text-slate-400">
                <summary className="cursor-pointer">Advanced details (error code)</summary>
                <p className="mt-1 font-mono break-all">{mapped.detail}</p>
              </details>
            )}
          </div>
        );
      })()}

      {outcome && sessionInput && (
        <GnssResultsPanel input={sessionInput} outcome={outcome} />
      )}
    </div>
  );
};
