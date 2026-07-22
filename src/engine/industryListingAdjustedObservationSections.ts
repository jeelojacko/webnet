import { RAD_TO_DEG, radToDmsStr } from './angles';
import {
  centerIndustryLine,
  formatClassicTraverseDirectionSigmaArcSec,
  formatClassicTraverseFileLine,
  formatClassicTraverseSetLabel,
  formatClassicTraverseSignedDms,
  formatClassicTraverseStdRes,
  formatClassicTraverseZenithSigmaArcSec,
  formatDmsHundredths,
  formatQuadrantBearing,
} from './industryListingFormatters';
import type { AdjustmentResult, Observation, Station } from '../types';
import type { IndustryListingParseSettings, IndustryListingSettings } from './industryListingTypes';
import type { RelationshipRow, RenderAdjustedSection } from './industryListingSectionTypes';

export interface AppendAdjustedObservationSectionsArgs {
  lines: string[];
  res: { stations: Record<string, Station> };
  settings: IndustryListingSettings;
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  sortedListingObservations: Observation[];
  gpsObservationRows: Observation[];
  relationshipRows: RelationshipRow[];
  isPreanalysis: boolean;
  linearUnit: string;
  unitScale: number;
  coordSystemMode: string;
  confidence95Scale: number;
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
  hasTraverseStyleAngularFamilies: boolean;
  renderAdjustedGnssVectorSection: () => void;
  addCenteredHeading: (_title: string) => void;
  renderAdjustedSection: RenderAdjustedSection;
  formatLinear: (_value: number | undefined) => string;
  formatResidualLinear: (_value: number | undefined) => string;
  formatAngularLinearResidual: (_residualRad: number | undefined, _effectiveDistanceM: number | undefined) => string;
  formatAngularStdErrArcSec: (_value: number | undefined) => string;
  formatIndustryStdRes: (_obs: Observation) => string;
  sortSelectedMode: <T extends Observation>(_rows: T[]) => T[];
  pairDisplayCombinedFactor: (_from: string, _to: string) => number;
  aliasRefsForLine: (_sourceLine?: number) => string;
  autoSideshotSuffix: (_obs: Observation) => string;
  prismSuffix: (_obs: Observation) => string;
}

export const appendAdjustedObservationSections = ({
  lines,
  res,
  settings,
  parseSettings,
  parseState,
  sortedListingObservations,
  gpsObservationRows,
  relationshipRows,
  isPreanalysis,
  linearUnit,
  unitScale,
  coordSystemMode,
  confidence95Scale,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
  hasTraverseStyleAngularFamilies,
  renderAdjustedGnssVectorSection,
  addCenteredHeading,
  renderAdjustedSection,
  formatLinear,
  formatResidualLinear,
  formatAngularLinearResidual,
  formatAngularStdErrArcSec,
  formatIndustryStdRes,
  sortSelectedMode,
  pairDisplayCombinedFactor,
  aliasRefsForLine,
  autoSideshotSuffix,
  prismSuffix,
}: AppendAdjustedObservationSectionsArgs) => {
  const shouldRenderAdjustedObservationSections =
    !isPreanalysis &&
    settings.listingShowObservationsResiduals &&
    sortedListingObservations.length > 0;
  const shouldRenderAdjustedGnssVectorSection =
    !isPreanalysis &&
    gpsObservationRows.length > 0 &&
    (settings.listingShowObservationsResiduals || usesCompactGnssParityLayout);

  if (!shouldRenderAdjustedObservationSections && !shouldRenderAdjustedGnssVectorSection) return;
  if (!usesClassicParityLayout) {
    lines.push('');
    addCenteredHeading('Adjusted Observations and Residuals');
  }

  if (usesClassicParityLayout && shouldRenderAdjustedObservationSections) {
    const angleUnitLabel = (parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase();
    const distanceRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'dist' } => obs.type === 'dist',
      ),
    );
    if (distanceRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Measured Distance Observations (${linearUnit})`));
      lines.push('');
      lines.push('           From       To              Distance      Residual   StdErr StdRes File:Line');
      distanceRows.forEach((obs) => {
        const adjustedDistance = formatLinear((obs.calc as number | undefined) ?? obs.obs);
        const residual = formatResidualLinear(obs.residual as number | undefined);
        const sigma = formatLinear(obs.weightingStdDev ?? obs.stdDev);
        const stdRes = formatClassicTraverseStdRes(obs);
        const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
        lines.push(
          `           ${obs.from.padEnd(11)}${obs.to.padEnd(15)}${adjustedDistance.padStart(10)}${residual.padStart(14)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
        );
      });
    }
    const zenithRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'zenith' } => obs.type === 'zenith',
      ),
    );
    if (zenithRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Zenith Observations (${angleUnitLabel})`));
      lines.push('');
      lines.push('           From       To              Zenith        Residual     Distance   StdErr StdRes File:Line');
      zenithRows.forEach((obs) => {
        const adjustedZenith = formatDmsHundredths((obs.calc as number | undefined) ?? obs.obs);
        const residual = formatClassicTraverseSignedDms(
          typeof obs.residual === 'number' ? -obs.residual : undefined,
        );
        const distance = formatAngularLinearResidual(
          obs.residual as number | undefined,
          obs.effectiveDistance,
        );
        const sigma = formatClassicTraverseZenithSigmaArcSec(
          (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600,
        );
        const stdRes = formatClassicTraverseStdRes(obs);
        const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
        lines.push(
          `           ${obs.from.padEnd(11)}${obs.to.padEnd(11)}${adjustedZenith.padStart(13)}${residual.padStart(15)}${distance.padStart(13)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
        );
      });
    }
    const directionRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'direction' } => obs.type === 'direction',
      ),
    );
    if (directionRows.length > 0) {
      const groupedDirections = new Map<string, Array<Observation & { type: 'direction' }>>();
      directionRows.forEach((obs) => {
        const key = String(obs.setId ?? 'UNKNOWN');
        const group = groupedDirections.get(key) ?? [];
        group.push(obs);
        groupedDirections.set(key, group);
      });
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Measured Direction Observations (${angleUnitLabel})`));
      lines.push('');
      lines.push('           From       To            Direction        Residual     Distance   StdErr StdRes File:Line');
      [...groupedDirections.entries()].forEach(([setId, group], groupIndex) => {
        lines.push('');
        lines.push(`           Set ${formatClassicTraverseSetLabel(setId, groupIndex + 1)}`);
        sortSelectedMode(group).forEach((obs) => {
          const adjustedDirection = formatDmsHundredths((obs.calc as number | undefined) ?? obs.obs);
          const residual = formatClassicTraverseSignedDms(
            typeof obs.residual === 'number' ? -obs.residual : undefined,
          );
          const distance = formatAngularLinearResidual(
            obs.residual as number | undefined,
            obs.effectiveDistance,
          );
          const sigma = formatClassicTraverseDirectionSigmaArcSec(
            (obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600,
          );
          const stdRes = formatClassicTraverseStdRes(obs);
          const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
          lines.push(
            `           ${obs.at.padEnd(11)}${obs.to.padEnd(10)}${adjustedDirection.padStart(14)}${residual.padStart(15)}${distance.padStart(13)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
          );
        });
      });
    }
    const bearingRows = sortSelectedMode(
      sortedListingObservations.filter(
        (obs): obs is Observation & { type: 'bearing' } => obs.type === 'bearing',
      ),
    );
    if (bearingRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Grid Azimuth/Bearing Observations (${angleUnitLabel})`));
      lines.push('');
      lines.push('           From       To            Bearing         Residual     Distance   StdErr StdRes File:Line');
      bearingRows.forEach((obs) => {
        const adjustedBearing = formatQuadrantBearing((obs.calc as number | undefined) ?? obs.obs);
        const residualRad = typeof obs.residual === 'number' ? -obs.residual : undefined;
        const residual =
          obs.sigmaSource === 'fixed' && (residualRad == null || Math.abs(residualRad) < 1e-12)
            ? '-0-00-00.00'
            : formatClassicTraverseSignedDms(residualRad);
        const distance =
          obs.sigmaSource === 'fixed' && (obs.residual == null || Math.abs(obs.residual) < 1e-12)
            ? '-0.0000'
            : formatAngularLinearResidual(obs.residual as number | undefined, obs.effectiveDistance);
        const sigma =
          obs.sigmaSource === 'fixed'
            ? 'FIXED'
            : ((obs.weightingStdDev ?? obs.stdDev) * RAD_TO_DEG * 3600).toFixed(2);
        const stdRes = formatClassicTraverseStdRes(obs);
        const fileLine = formatClassicTraverseFileLine(parseState, obs.sourceLine);
        lines.push(
          `           ${obs.from.padEnd(11)}${obs.to.padEnd(11)}${adjustedBearing.padStart(13)}${residual.padStart(15)}${distance.padStart(13)}${sigma.padStart(9)}${stdRes.padStart(6)}${fileLine.padStart(10)}`,
        );
      });
    }
    renderAdjustedGnssVectorSection();
    if (relationshipRows.length > 0) {
      lines.push('');
      lines.push(centerIndustryLine(`Adjusted Bearings (${angleUnitLabel}) and Horizontal Distances (${linearUnit})`));
      lines.push(centerIndustryLine('========================================================='));
      lines.push(centerIndustryLine('(Relative Confidence of Bearing is in Seconds)'));
      lines.push('');
      lines.push('From       To          Grid Bearing   Grid Dist       95% RelConfidence');
      lines.push('                                      Grnd Dist     Brg    Dist       PPM');
      relationshipRows.forEach((row) => {
        const fromStation = res.stations[row.from];
        const toStation = res.stations[row.to];
        const gridDistMeters =
          fromStation && toStation ? Math.hypot(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const avgCombined = pairDisplayCombinedFactor(row.from, row.to);
        const relationshipLinearDisplayScale =
          coordSystemMode === 'grid' && Number.isFinite(avgCombined) && avgCombined > 0 ? 1 / avgCombined : 1;
        const groundDistMeters =
          Number.isFinite(gridDistMeters) && avgCombined > 0 ? gridDistMeters / avgCombined : Number.NaN;
        const azRad =
          fromStation && toStation ? Math.atan2(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const sigmaDistDisplay = row.sigmaDist != null ? row.sigmaDist * relationshipLinearDisplayScale : undefined;
        const sigmaDist95 =
          sigmaDistDisplay != null ? (sigmaDistDisplay * unitScale * confidence95Scale).toFixed(4) : '-';
        const ppm95 =
          sigmaDistDisplay != null && Number.isFinite(gridDistMeters)
            ? ((sigmaDistDisplay * confidence95Scale * 1_000_000) / Math.max(1e-12, Math.abs(gridDistMeters))).toFixed(4)
            : '-';
        lines.push(
          `${row.from.padEnd(11)}${row.to.padEnd(12)}${formatQuadrantBearing(azRad).padStart(13)}${(Number.isFinite(gridDistMeters) ? (gridDistMeters * unitScale).toFixed(4) : '-').padStart(12)}${row.sigmaAz95.padStart(8)}${sigmaDist95.padStart(8)}${ppm95.padStart(10)}`,
        );
        lines.push(`${''.padEnd(36)}${(Number.isFinite(groundDistMeters) ? (groundDistMeters * unitScale).toFixed(4) : '-').padStart(12)}`);
      });
    }
    return;
  }

  if (shouldRenderAdjustedObservationSections) {
    const angleRows = sortedListingObservations
      .filter((obs) => obs.type === 'angle')
      .map((obs) => [
        `${obs.at}-${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr((obs.calc as number | undefined) ?? obs.obs),
        formatAngularLinearResidual(obs.residual as number | undefined, undefined).replace(/^-/, ''),
        obs.effectiveDistance != null && Number.isFinite(obs.effectiveDistance) && obs.effectiveDistance > 0
          ? (obs.effectiveDistance * unitScale).toFixed(4)
          : '-',
        formatAngularStdErrArcSec(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `Adjusted Angle Observations (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      angleRows,
      ['Stations', 'Angle', 'Residual', 'Distance', 'StdErr', 'StdRes', 'File:Line'],
      [5],
    );

    const distanceRows = sortedListingObservations
      .filter((obs) => obs.type === 'dist')
      .map((obs) => [
        `${obs.from}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}${prismSuffix(obs)}`,
        formatLinear((obs.calc as number | undefined) ?? obs.obs),
        formatResidualLinear(obs.residual as number | undefined),
        formatLinear(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `${hasTraverseStyleAngularFamilies ? 'Adjusted Measured Distance Observations' : 'Adjusted Distance Observations'} (${linearUnit})`,
      distanceRows,
      ['Stations', 'Distance', 'Residual', 'StdErr', 'StdRes', 'File:Line'],
      [1, 2, 3, 4],
    );

    const directionRows = sortedListingObservations
      .filter((obs) => obs.type === 'direction')
      .map((obs) => [
        `${obs.at}-${obs.to}${aliasRefsForLine(obs.sourceLine)}${autoSideshotSuffix(obs)}`,
        radToDmsStr((obs.calc as number | undefined) ?? obs.obs),
        ((obs.residual != null && Number.isFinite(obs.residual)) ? ((-obs.residual) * RAD_TO_DEG * 3600).toFixed(2) : '-'),
        formatAngularLinearResidual(obs.residual as number | undefined, obs.effectiveDistance),
        formatAngularStdErrArcSec(obs.weightingStdDev ?? obs.stdDev),
        formatIndustryStdRes(obs),
        obs.sourceLine != null ? `1:${obs.sourceLine}` : '-',
      ]);
    renderAdjustedSection(
      `${hasTraverseStyleAngularFamilies ? 'Adjusted Measured Direction Observations' : 'Adjusted Direction Observations'} (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()})`,
      directionRows,
      ['Stations', 'Direction', 'Residual', 'Distance', 'StdErr', 'StdRes', 'File:Line'],
      [5],
    );
  }

  renderAdjustedGnssVectorSection();
  if (shouldRenderAdjustedObservationSections && relationshipRows.length > 0) {
    lines.push('');
    const isGridBearingSection = coordSystemMode === 'grid';
    const useCompactGnssRelationshipLayout = usesCompactGnssParityLayout && isGridBearingSection;
    const azTitle = isGridBearingSection
      ? `Adjusted Bearings (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) and Horizontal Distances (${linearUnit})`
      : `Adjusted Azimuths (${(parseState?.angleUnits ?? parseSettings.angleUnits).toUpperCase()}) and Horizontal Distances (${linearUnit})`;
    if (useCompactGnssRelationshipLayout) {
      lines.push(centerIndustryLine(azTitle));
      lines.push(centerIndustryLine('========================================================='));
    } else {
      addCenteredHeading(azTitle);
    }
    lines.push(
      isGridBearingSection
        ? '                 (Relative Confidence of Bearing is in Seconds)'
        : '                 (Relative Confidence of Azimuth is in Seconds)',
    );
    lines.push('');
    if (isGridBearingSection) {
      lines.push('From       To          Grid Bearing   Grid Dist       95% RelConfidence');
      lines.push('                                      Grnd Dist     Brg    Dist       PPM');
      relationshipRows.forEach((row) => {
        const fromStation = res.stations[row.from];
        const toStation = res.stations[row.to];
        const gridDistMeters =
          fromStation && toStation ? Math.hypot(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const avgCombined = pairDisplayCombinedFactor(row.from, row.to);
        const relationshipLinearDisplayScale =
          Number.isFinite(avgCombined) && avgCombined > 0 ? 1 / avgCombined : 1;
        const groundDistMeters =
          Number.isFinite(gridDistMeters) && avgCombined > 0 ? gridDistMeters / avgCombined : Number.NaN;
        const azRad =
          fromStation && toStation ? Math.atan2(toStation.x - fromStation.x, toStation.y - fromStation.y) : Number.NaN;
        const sigmaDistDisplay = row.sigmaDist != null ? row.sigmaDist * relationshipLinearDisplayScale : undefined;
        const sigmaDist95 =
          sigmaDistDisplay != null ? (sigmaDistDisplay * confidence95Scale * unitScale).toFixed(4) : '-';
        const ppm95 =
          sigmaDistDisplay != null && Number.isFinite(gridDistMeters)
            ? ((sigmaDistDisplay * confidence95Scale * 1_000_000) / Math.max(1e-12, Math.abs(gridDistMeters))).toFixed(4)
            : '-';
        lines.push(
          useCompactGnssRelationshipLayout
            ? `${row.from.padEnd(11)}${row.to.padEnd(11)}${formatQuadrantBearing(azRad).padStart(13)}${(Number.isFinite(gridDistMeters) ? (gridDistMeters * unitScale).toFixed(4) : '-').padStart(12)}${row.sigmaAz95.padStart(8)}${sigmaDist95.padStart(9)}${ppm95.padStart(10)}`
            : `${row.from.padEnd(11)}${row.to.padEnd(12)}${formatQuadrantBearing(azRad).padStart(13)}${(Number.isFinite(gridDistMeters) ? (gridDistMeters * unitScale).toFixed(4) : '-').padStart(12)}${row.sigmaAz95.padStart(8)}${sigmaDist95.padStart(8)}${ppm95.padStart(10)}`,
        );
        lines.push(`${''.padEnd(useCompactGnssRelationshipLayout ? 35 : 36)}${(Number.isFinite(groundDistMeters) ? (groundDistMeters * unitScale).toFixed(4) : '-').padStart(12)}`);
      });
    } else {
      lines.push('From       To               Azimuth    Distance       95% RelConfidence');
      lines.push('                                                    Azi    Dist       PPM');
      relationshipRows.forEach((row) => {
        lines.push(
          `${row.from.padEnd(10)} ${row.to.padEnd(10)} ${row.azimuth.padStart(14)} ${row.distance.padStart(10)} ${row.sigmaAz95.padStart(7)} ${row.sigmaDist95.padStart(8)} ${row.ppm95.padStart(10)}`,
        );
      });
    }
  }
};

