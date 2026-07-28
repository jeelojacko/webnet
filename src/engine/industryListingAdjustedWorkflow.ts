import { RAD_TO_DEG } from './angles';
import {
  appendDataCheckAndBlunderDiagnostics,
  appendGridDistanceDiagnostics,
  createAdjustedGnssVectorSectionRenderer,
} from './industryListingAdjustedOutputSections';
import { buildIndustryListingGpsDisplayHelpers } from './industryListingGpsDisplay';
import { buildIndustryListingRelationshipPrecisionModel } from './industryListingRelationshipPrecision';
import { appendAdjustedObservationSections } from './industryListingSections';
import { sortIndustryListingObservations } from './industryListingFormatters';
import { INDUSTRY_CONFIDENCE_95_SCALE } from './resultPrecision';
import type { StationDisplayFactors } from './industryListingStationContext';
import type {
  IndustryListingParseSettings,
  IndustryListingSettings,
} from './industryListingTypes';
import type { AdjustmentResult, GpsObservation, Observation, RunMode, Station } from '../types';

type HeadingAppender = (_title: string, _underline?: string) => void;
type TableRenderer = (_headers: string[], _rows: string[][], _rightAligned?: number[]) => void;

type AppendIndustryListingAdjustedWorkflowOptions = {
  addCenteredHeading: HeadingAppender;
  aliasRefsForLine: (_line?: number) => string;
  coordSystemMode: 'local' | 'grid';
  displayFactorsForStation: (_stationId: string, _station: Station) => StationDisplayFactors;
  gpsDisplayHelpers: ReturnType<typeof buildIndustryListingGpsDisplayHelpers>;
  gpsObservationRows: GpsObservation[];
  gridDistanceMode: string;
  hasTraverseStyleAngularFamilies: boolean;
  isPreanalysis: boolean;
  linearUnit: string;
  lines: string[];
  observationsForListing: Observation[];
  parseSettings: IndustryListingParseSettings;
  parseState: AdjustmentResult['parseState'];
  renderTextTable: TableRenderer;
  res: AdjustmentResult;
  runMode: RunMode;
  settings: IndustryListingSettings;
  unitScale: number;
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
};

export type IndustryListingAdjustedWorkflowResult = ReturnType<
  typeof buildIndustryListingRelationshipPrecisionModel
> & {
  confidence95Scale: number;
  precisionReportingMode: NonNullable<IndustryListingSettings['precisionReportingMode']>;
};

const compareStationIds = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

export const compareObsByInput = (a: Observation, b: Observation) => {
  const aLine = a.sourceLine ?? Number.MAX_SAFE_INTEGER;
  const bLine = b.sourceLine ?? Number.MAX_SAFE_INTEGER;
  if (aLine !== bLine) return aLine - bLine;
  return (a.id ?? 0) - (b.id ?? 0);
};

export const appendIndustryListingAdjustedWorkflow = ({
  addCenteredHeading,
  aliasRefsForLine,
  coordSystemMode,
  displayFactorsForStation,
  gpsDisplayHelpers,
  gpsObservationRows,
  gridDistanceMode,
  hasTraverseStyleAngularFamilies,
  isPreanalysis,
  linearUnit,
  lines,
  observationsForListing,
  parseSettings,
  parseState,
  renderTextTable,
  res,
  runMode,
  settings,
  unitScale,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
}: AppendIndustryListingAdjustedWorkflowOptions): IndustryListingAdjustedWorkflowResult => {
  const listingObservations = [...observationsForListing]
    .filter((o) => Number.isFinite(o.stdRes))
    .filter((o) =>
      settings.listingShowAzimuthsBearings
        ? true
        : !(o.type === 'direction' || o.type === 'dir' || o.type === 'bearing'),
    );
  const sortedListingObservations = sortIndustryListingObservations(
    listingObservations,
    settings.listingSortObservationsBy,
  );
  const precisionReportingMode = settings.precisionReportingMode ?? 'industry-standard';
  const confidence95Scale = INDUSTRY_CONFIDENCE_95_SCALE;
  const autoSideshotObsIds = new Set(
    res.autoSideshotDiagnostics?.candidates.flatMap((c) => [c.angleObsId, c.distObsId]) ?? [],
  );
  const autoSideshotSuffix = (obs: Observation): string =>
    autoSideshotObsIds.has(obs.id) ? ' [auto-ss]' : '';
  const prismSuffix = (obs: Observation): string => {
    if (obs.type !== 'dist' && obs.type !== 'zenith') return '';
    const correction = obs.prismCorrectionM ?? 0;
    if (!Number.isFinite(correction) || Math.abs(correction) <= 0) return '';
    const scope = obs.prismScope ?? 'global';
    const sign = correction >= 0 ? '+' : '';
    return ` [prism ${scope} ${sign}${(correction * unitScale).toFixed(4)}${linearUnit}]`;
  };
  const formatAngularStdErrArcSec = (value: number): string =>
    `${(value * RAD_TO_DEG * 3600).toFixed(2)}"`;
  const formatIndustryStdRes = (obs: Observation): string => {
    if (typeof obs.residual !== 'number') return '-';
    const sigma = obs.weightingStdDev ?? obs.stdDev;
    if (!Number.isFinite(sigma) || sigma <= 0) return '-';
    const value = Math.abs(obs.residual) / sigma;
    const rounded = value.toFixed(1);
    return value >= 3 ? `${rounded}*` : rounded;
  };
  const formatLinear = (value: number | undefined): string =>
    value != null ? (value * unitScale).toFixed(4) : '-';
  const formatResidualLinear = (value: number | undefined): string =>
    value != null ? ((-value) * unitScale).toFixed(4) : '-';
  const formatAngularLinearResidual = (
    residualRad: number | undefined,
    effectiveDistanceM: number | undefined,
  ): string =>
    residualRad != null &&
    Number.isFinite(residualRad) &&
    effectiveDistanceM != null &&
    Number.isFinite(effectiveDistanceM)
      ? ((-residualRad) * effectiveDistanceM * unitScale).toFixed(4)
      : '-';
  const relationshipModel = buildIndustryListingRelationshipPrecisionModel({
    compareObsByInput,
    compareStationIds,
    confidence95Scale,
    displayFactorsForStation,
    gpsHorizontalCovarianceForRelationship: gpsDisplayHelpers.gpsHorizontalCovarianceForRelationship,
    gpsObservationRows,
    observationsForListing,
    parseSettings,
    precisionReportingMode,
    res,
    unitScale,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  });
  const renderAdjustedSection = (
    title: string,
    rows: string[][],
    headers: string[],
    rightAligned: number[],
    preface?: string[],
  ) => {
    if (rows.length === 0) return;
    lines.push('');
    addCenteredHeading(title);
    if (preface && preface.length > 0) {
      preface.forEach((p) => lines.push(p));
    }
    lines.push('');
    renderTextTable(headers, rows, rightAligned);
  };

  appendDataCheckAndBlunderDiagnostics({
    addCenteredHeading,
    aliasRefsForLine,
    autoSideshotSuffix,
    isPreanalysis,
    linearUnit,
    lines,
    observationsForListing,
    renderTextTable,
    res,
    runMode,
    unitScale,
  });

  const shouldRenderAdjustedObservationSections =
    !isPreanalysis &&
    settings.listingShowObservationsResiduals &&
    sortedListingObservations.length > 0;
  const shouldRenderAdjustedGnssVectorSection =
    !isPreanalysis &&
    gpsObservationRows.length > 0 &&
    (settings.listingShowObservationsResiduals || usesCompactGnssParityLayout);
  const renderAdjustedGnssVectorSection = createAdjustedGnssVectorSectionRenderer({
    addCenteredHeading,
    compareObsByInput,
    formatLinear,
    formatResidualLinear,
    getGpsCovarianceDisplay: gpsDisplayHelpers.gpsCovarianceDisplay,
    getGpsDisplayVector: gpsDisplayHelpers.gpsDisplayVector,
    gpsObservationRows,
    linearUnit,
    lines,
    listingObservations,
    shouldRenderAdjustedGnssVectorSection,
    unitScale,
  });

  appendAdjustedObservationSections({
    addCenteredHeading,
    aliasRefsForLine,
    autoSideshotSuffix,
    confidence95Scale,
    coordSystemMode,
    formatAngularLinearResidual,
    formatAngularStdErrArcSec: (value: number | undefined) =>
      value != null ? formatAngularStdErrArcSec(value) : '-',
    formatIndustryStdRes,
    formatLinear: (value: number | undefined) => formatLinear(value),
    formatResidualLinear,
    gpsObservationRows,
    hasTraverseStyleAngularFamilies,
    isPreanalysis,
    linearUnit,
    lines,
    pairDisplayCombinedFactor: relationshipModel.pairDisplayCombinedFactor,
    parseSettings,
    parseState,
    prismSuffix,
    relationshipRows: relationshipModel.relationshipRows,
    renderAdjustedGnssVectorSection,
    renderAdjustedSection,
    res,
    settings,
    sortSelectedMode: <T extends Observation>(rows: T[]): T[] =>
      sortIndustryListingObservations(
        rows as Observation[],
        settings.listingSortObservationsBy,
      ) as T[],
    sortedListingObservations,
    unitScale,
    usesClassicParityLayout,
    usesCompactGnssParityLayout,
  });
  appendGridDistanceDiagnostics({
    aliasRefsForLine,
    coordSystemMode,
    gridDistanceMode,
    linearUnit,
    renderAdjustedSection,
    res,
    shouldRenderAdjustedGnssVectorSection,
    shouldRenderAdjustedObservationSections,
    sortedListingObservations,
    unitScale,
    usesClassicParityLayout,
  });

  return {
    ...relationshipModel,
    confidence95Scale,
    precisionReportingMode,
  };
};
