import {
  buildResultStatisticalSummaryModel,
  buildResultTraceabilityModel,
} from './resultDerivedModels';
import {
  centerIndustryLine,
  formatLevelingOnlyFileLine,
} from './industryListingFormatters';
import type {
  IndustryListingParseSettings,
  IndustryListingRunDiagnostics,
  IndustryListingSettings,
} from './industryListingTypes';
import { getStationPrecision } from './resultPrecision';
import type { AdjustmentResult, LevelObservation } from '../types';

const ONE_DIMENSIONAL_CONFIDENCE_95_SCALE = 1.959963984540054;

export const buildLevelingOnlyIndustryListingText = (
  res: AdjustmentResult,
  settings: IndustryListingSettings,
  parseSettings: IndustryListingParseSettings,
  runDiagnostics: IndustryListingRunDiagnostics,
): string => {
  const lines: string[] = [];
  const parseState = res.parseState;
  const linearUnit = settings.units === 'ft' ? 'FeetUS' : 'Meters';
  const coordOrder =
    (parseState?.order ?? parseSettings.order) === 'NE' ? 'North-East' : 'East-North';
  const traceabilityModel = buildResultTraceabilityModel(parseState);
  const levObservations = res.observations.filter(
    (obs): obs is LevelObservation => obs.type === 'lev',
  );
  const statisticalSummary = buildResultStatisticalSummaryModel(res, 'listing');
  const levelStats = statisticalSummary.rows.find((row) => row.label === 'Level Data');
  const stationEntries = Object.entries(res.stations);
  const enteredHeightControls = stationEntries.filter(([, station]) =>
    station.fixedH ||
    station.constraintModeH === 'fixed' ||
    station.constraintModeH === 'weighted',
  );
  const stationOrder: string[] = [];
  const pushStation = (stationId: string) => {
    if (!stationId || stationOrder.includes(stationId) || !res.stations[stationId]) return;
    stationOrder.push(stationId);
  };
  enteredHeightControls.forEach(([stationId]) => pushStation(stationId));
  levObservations.forEach((obs) => {
    pushStation(obs.from);
    pushStation(obs.to);
  });
  const defaultLevelStdMmPerKm =
    runDiagnostics.currentInstrumentLevStdMmPerKm && runDiagnostics.currentInstrumentLevStdMmPerKm > 0
      ? runDiagnostics.currentInstrumentLevStdMmPerKm
      : (() => {
          const defaultObs = levObservations.find(
            (obs) => obs.sigmaSource === 'default' && (obs.weightingStdDev ?? obs.stdDev) > 0 && obs.lenKm > 0,
          );
          if (!defaultObs) return 0;
          return (((defaultObs.weightingStdDev ?? defaultObs.stdDev) * 1000) / Math.sqrt(defaultObs.lenKm));
        })();
  const levelStdMetersPerKm = defaultLevelStdMmPerKm / 1000;
  const formatSettingRow = (label: string, value: string) =>
    lines.push(`      ${label.padEnd(35)} : ${value}`);
  const formatCountRow = (label: string, value: number) =>
    lines.push(`                        ${label.padEnd(23)} = ${String(value).padStart(6)}`);

  lines.push('INDUSTRY-STANDARD-STYLE Listing (WebNet Emulation)');
  lines.push(`Run Date: ${new Date().toLocaleString()}`);
  lines.push('');
  lines.push(centerIndustryLine('Summary of Files Used and Option Settings'));
  lines.push(centerIndustryLine('========================================='));
  lines.push('');
  lines.push(centerIndustryLine('Project Option Settings'));
  lines.push('');
  formatSettingRow('STAR*NET Run Mode', 'Adjust with Error Propagation');
  formatSettingRow('Type of Adjustment', 'Lev');
  formatSettingRow('Project Units', linearUnit === 'Meters' ? 'Meters' : linearUnit);
  formatSettingRow('Input/Output Coordinate Order', coordOrder);
  formatSettingRow('Create Coordinate File', 'Yes');
  lines.push('');
  lines.push(centerIndustryLine('Instrument Standard Error Settings'));
  lines.push('');
  lines.push('      Project Default Instrument');
  lines.push(
    `        Differential Levels               :    ${levelStdMetersPerKm.toFixed(6)} Meters / Km`,
  );
  lines.push('');
  lines.push(centerIndustryLine('Summary of Inconsistent Descriptions'));
  lines.push(centerIndustryLine('===================================='));
  lines.push('');
  lines.push('');
  lines.push(
    centerIndustryLine(`Number of Occurrences = ${traceabilityModel.descriptionConflictCount}`),
  );
  lines.push('');
  lines.push('Network Stations');
  lines.push('Point ID         Description                     File:Line                     ');
  lines.push('');
  lines.push('Sideshots');
  lines.push('Point ID         Description                     File:Line                     ');
  lines.push('');
  lines.push(centerIndustryLine('Summary of Unadjusted Input Observations'));
  lines.push(centerIndustryLine('========================================'));
  lines.push('');
  lines.push(
    centerIndustryLine(
      `Number of Entered Stations (${linearUnit === 'Meters' ? 'Meters' : linearUnit}) = ${enteredHeightControls.length}`,
    ),
  );
  lines.push('');
  lines.push('Fixed Stations         Elev   Description');
  enteredHeightControls.forEach(([stationId, station]) => {
    lines.push(`${stationId.padEnd(20)}${station.h.toFixed(4).padStart(8)}`);
  });
  lines.push('');
  lines.push(
    centerIndustryLine(
      `Number of Differential Level Observations (${linearUnit === 'Meters' ? 'Meters' : linearUnit}) = ${levObservations.length}`,
    ),
  );
  lines.push('');
  lines.push('From            To                  Elev Diff    StdErr  Length');
  levObservations.forEach((obs) => {
    const stdErr = (obs.weightingStdDev ?? obs.stdDev).toFixed(4);
    const length =
      obs.sigmaSource === 'explicit' || !(obs.lenKm > 0) ? 'n/a' : String(Math.round(obs.lenKm * 1000));
    const prefix = `${obs.from.padEnd(16)}${obs.to.padEnd(21)}${obs.obs.toFixed(4).padStart(8)}${stdErr.padStart(10)}${length.padStart(8)}`;
    lines.push(
      prefix,
    );
  });
  lines.push('');
  lines.push(centerIndustryLine('Adjustment Statistical Summary'));
  lines.push(centerIndustryLine('=============================='));
  lines.push('');
  formatCountRow('Number of Stations', stationOrder.length);
  lines.push('');
  formatCountRow('Number of Observations', levObservations.length);
  formatCountRow('Number of Unknowns', Math.max(0, levObservations.length - res.dof));
  formatCountRow('Number of Redundant Obs', res.dof);
  lines.push('');
  lines.push('            Observation   Count   Sum Squares         Error');
  lines.push('                                    of StdRes        Factor');
  lines.push(
    `             ${'Level Data'.padEnd(10)}${String(levelStats?.count ?? levObservations.length).padStart(8)}${(levelStats?.sumSquares ?? statisticalSummary.totalSumSquares).toFixed(3).padStart(14)}${(levelStats?.errorFactor ?? res.seuw).toFixed(3).padStart(14)}`,
  );
  lines.push('');
  lines.push(
    `                  Total${String(statisticalSummary.totalCount).padStart(8)}${statisticalSummary.totalSumSquares.toFixed(3).padStart(14)}${res.seuw.toFixed(3).padStart(14)}`,
  );
  lines.push('');
  if (res.chiSquare) {
    lines.push(
      `                  The Chi-Square Test at 5.00% Level ${res.chiSquare.pass95 ? 'Passed' : 'Failed'}`,
    );
    lines.push(
      `                       Lower/Upper Bounds (${Math.sqrt(res.chiSquare.varianceFactorLower).toFixed(3)}/${Math.sqrt(res.chiSquare.varianceFactorUpper).toFixed(3)})`,
    );
  }
  lines.push('');
  lines.push(centerIndustryLine('Adjusted Elevations and Error Propagation (Meters)'));
  lines.push(centerIndustryLine('=================================================='));
  lines.push('');
  lines.push('Station                  Elev        StdDev         95%     Description');
  stationOrder.forEach((stationId) => {
    const station = res.stations[stationId];
    const precision = getStationPrecision(
      res,
      stationId,
      settings.precisionReportingMode ?? 'industry-standard',
    );
    const sigmaH = precision.sigmaH ?? station.sH ?? 0;
    const ci95 = sigmaH * ONE_DIMENSIONAL_CONFIDENCE_95_SCALE;
    lines.push(
      `${stationId.padEnd(22)}${station.h.toFixed(4).padStart(8)}${sigmaH.toFixed(6).padStart(14)}${ci95.toFixed(6).padStart(14)}`,
    );
  });
  lines.push('');
  lines.push(centerIndustryLine('Adjusted Observations and Residuals'));
  lines.push(centerIndustryLine('==================================='));
  lines.push('');
  lines.push(centerIndustryLine('Adjusted Differential Level Observations (Meters)'));
  lines.push('');
  lines.push('From            To                   Elev Diff      Residual   StdErr StdRes File:Line');
  levObservations.forEach((obs) => {
    const adjusted = (typeof obs.calc === 'number' ? obs.calc : obs.obs).toFixed(4);
    const residualValue = typeof obs.residual === 'number' ? -obs.residual : 0;
    const residual = residualValue.toFixed(4);
    const stdErr = (obs.weightingStdDev ?? obs.stdDev).toFixed(4);
    const stdResValue = Math.abs(residualValue) / Math.max(obs.weightingStdDev ?? obs.stdDev, 1e-24);
    const stdRes = stdResValue.toFixed(1);
    const prefix =
      `${obs.from.padEnd(16)}${obs.to.padEnd(22)}${adjusted.padStart(8)}${residual.padStart(14)}` +
      `${stdErr.padStart(9)}${stdRes.padStart(6)}`;
    lines.push(
      `${prefix.padEnd(80)}${formatLevelingOnlyFileLine(parseState, obs.sourceLine).padEnd(6)}`,
    );
  });
  lines.push('');
  lines.push('');
  lines.push('                           Elapsed Time = 00:00:00');
  lines.push('');
  lines.push('');
  return lines.join('\n');
};
