import { RAD_TO_DEG, radToDmsStr } from './angles';
import {
  getRelativeCovarianceRows,
  getRelativePrecisionRows,
  toSurveyEllipseAzimuthDeg,
} from './resultPrecision';
import {
  createRelationshipPairResolver,
  type HorizontalCovariance,
  type RelationshipPair,
} from './industryListingRelationshipPrecisionResolver';
import type {
  AdjustmentResult,
  GpsObservation,
  Observation,
  Station,
} from '../types';
import type { IndustryListingParseSettings, IndustryListingSettings } from './industryListingTypes';
import type { StationDisplayFactors } from './industryListingStationContext';

type RelationshipRow = {
  from: string;
  to: string;
  azimuth: string;
  distance: string;
  sigmaAz95: string;
  sigmaDist95: string;
  ppm95: string;
  sigmaDist?: number;
  sigmaH?: number;
  ellipse?: {
    semiMajor: number;
    semiMinor: number;
    theta: number;
  };
};

type PositionalToleranceRow = {
  from: string;
  to: string;
  distanceMeters: number;
  toleranceMeters: number;
  checkMeters: number;
  passes: boolean;
};

type BuildIndustryListingRelationshipPrecisionModelOptions = {
  compareObsByInput: (_a: Observation, _b: Observation) => number;
  compareStationIds: (_a: string, _b: string) => number;
  confidence95Scale: number;
  displayFactorsForStation: (_stationId: string, _station: Station) => StationDisplayFactors;
  gpsHorizontalCovarianceForRelationship: (_obs: GpsObservation) => HorizontalCovariance | undefined;
  gpsObservationRows: GpsObservation[];
  observationsForListing: Observation[];
  parseSettings: IndustryListingParseSettings;
  precisionReportingMode: NonNullable<IndustryListingSettings['precisionReportingMode']>;
  res: AdjustmentResult;
  unitScale: number;
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
};

type BuildIndustryListingRelationshipPrecisionModelResult = {
  formatEllipseAzDm: typeof formatEllipseAzDm;
  gpsDirectFixedLinkedStations: Set<string>;
  pairDisplayCombinedFactor: (_from: string, _to: string) => number;
  positionalToleranceConfidencePercent: number;
  positionalToleranceConstantMm: number;
  positionalToleranceEnabled: boolean;
  positionalTolerancePpm: number;
  positionalToleranceRows: PositionalToleranceRow[];
  relationshipRows: RelationshipRow[];
  selectedEllipseStationIds: Set<string>;
};

const resolveSelectedPairs = (
  pairs: Array<{ from: string; to: string }> | undefined,
  resolveStationId: (_token?: string) => string | null,
  pairKey: (_a: string, _b: string) => string,
): RelationshipPair[] => {
  const selected = new Map<string, RelationshipPair>();
  pairs?.forEach((pair) => {
    const from = resolveStationId(pair.from);
    const to = resolveStationId(pair.to);
    if (!from || !to || from === to) return;
    const key = pairKey(from, to);
    if (selected.has(key)) return;
    selected.set(key, { key, from, to });
  });
  return [...selected.values()];
};

const formatEllipseAzDm = (
  thetaDeg?: number,
  semiMajor?: number,
  semiMinor?: number,
  convergenceCorrectionDeg = 0,
): string => {
  if (
    Number.isFinite(semiMajor) &&
    Number.isFinite(semiMinor) &&
    Math.max(Math.abs(semiMajor ?? 0), Math.abs(semiMinor ?? 0)) <= 1e-12
  ) {
    return '0-00';
  }
  const surveyAzimuth = toSurveyEllipseAzimuthDeg(thetaDeg);
  if (surveyAzimuth == null) return '-';
  let az = ((surveyAzimuth + convergenceCorrectionDeg) % 180 + 180) % 180;
  let deg = Math.floor(az);
  let min = Math.round((az - deg) * 60);
  if (min >= 60) {
    min -= 60;
    deg = (deg + 1) % 180;
  }
  return `${deg}-${min.toString().padStart(2, '0')}`;
};

export const buildIndustryListingRelationshipPrecisionModel = ({
  compareObsByInput,
  compareStationIds,
  confidence95Scale,
  displayFactorsForStation,
  gpsHorizontalCovarianceForRelationship,
  gpsObservationRows,
  observationsForListing,
  parseSettings,
  precisionReportingMode,
  res,
  unitScale,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
}: BuildIndustryListingRelationshipPrecisionModelOptions): BuildIndustryListingRelationshipPrecisionModelResult => {
  const relativePrecisionRows = getRelativePrecisionRows(res, precisionReportingMode);
  const relativeCovarianceRows = getRelativeCovarianceRows(res, precisionReportingMode);
  const pairKey = (a: string, b: string) =>
    compareStationIds(a, b) <= 0 ? `${a}::${b}` : `${b}::${a}`;
  const stationIdLookup = new Map<string, string>(
    Object.keys(res.stations).map((stationId) => [stationId.toUpperCase(), stationId]),
  );
  const resolveSelectedStationId = (token?: string): string | null => {
    const trimmed = token?.trim();
    if (!trimmed) return null;
    return stationIdLookup.get(trimmed.toUpperCase()) ?? null;
  };
  const selectedEllipseStationIds = new Set(
    (res.parseState?.ellipseStationIds ?? [])
      .map((token) => resolveSelectedStationId(token))
      .filter((stationId): stationId is string => stationId != null),
  );
  const selectedRelativePairs = resolveSelectedPairs(
    res.parseState?.relativeLinePairs,
    resolveSelectedStationId,
    pairKey,
  );
  const selectedPositionalTolerancePairs = resolveSelectedPairs(
    res.parseState?.positionalTolerancePairs,
    resolveSelectedStationId,
    pairKey,
  );
  const positionalToleranceEnabled =
    res.parseState?.positionalToleranceEnabled ?? parseSettings.positionalToleranceEnabled ?? false;
  const positionalToleranceConstantMm =
    res.parseState?.positionalToleranceConstantMm ?? parseSettings.positionalToleranceConstantMm ?? 0;
  const positionalTolerancePpm =
    res.parseState?.positionalTolerancePpm ?? parseSettings.positionalTolerancePpm ?? 0;
  const positionalToleranceConfidencePercent =
    res.parseState?.positionalToleranceConfidencePercent ??
    parseSettings.positionalToleranceConfidencePercent ??
    95;
  const positionalToleranceConfidenceScale = Math.sqrt(
    Math.max(0, -2 * Math.log(Math.max(1e-12, 1 - positionalToleranceConfidencePercent / 100))),
  );
  const gpsObservationPairMap = new Map<string, GpsObservation[]>();
  const gpsDirectFixedLinkedStations = new Set<string>();
  gpsObservationRows.forEach((obs) => {
    const key = pairKey(obs.from, obs.to);
    const rows = gpsObservationPairMap.get(key) ?? [];
    rows.push(obs);
    gpsObservationPairMap.set(key, rows);
    const fromFixed = res.stations[obs.from]?.fixed === true;
    const toFixed = res.stations[obs.to]?.fixed === true;
    if (fromFixed !== toFixed) {
      gpsDirectFixedLinkedStations.add(fromFixed ? obs.to : obs.from);
    }
  });

  const relationshipPairMap = new Map<string, RelationshipPair>();
  const addRelationshipPair = (from?: string, to?: string, preserveOrientation = false) => {
    if (!from || !to || from === to) return;
    const fromStation = res.stations[from];
    const toStation = res.stations[to];
    const oriented = preserveOrientation
      ? { from, to }
      : usesClassicParityLayout
        ? compareStationIds(from, to) <= 0
          ? { from, to }
          : { from: to, to: from }
        : fromStation?.fixed === true && toStation?.fixed !== true
          ? { from, to }
          : toStation?.fixed === true && fromStation?.fixed !== true
            ? { from: to, to: from }
            : { from, to };
    const key = pairKey(from, to);
    if (!relationshipPairMap.has(key)) {
      relationshipPairMap.set(key, {
        key,
        from: oriented.from,
        to: oriented.to,
      });
    }
  };
  if (!usesClassicParityLayout) {
    relativeCovarianceRows.forEach((row) => {
      if (!row.connected && !row.selectedByRelativeDirective) return;
      addRelationshipPair(row.from, row.to, true);
    });
  }
  [...observationsForListing].sort(compareObsByInput).forEach((obs) => {
    switch (obs.type) {
      case 'angle':
        addRelationshipPair(obs.at, obs.from);
        addRelationshipPair(obs.at, obs.to);
        break;
      case 'direction':
        addRelationshipPair(obs.at, obs.to);
        break;
      case 'dist':
      case 'dir':
      case 'bearing':
      case 'gps':
        addRelationshipPair(obs.from, obs.to);
        break;
      default:
        break;
    }
  });
  selectedRelativePairs.forEach((pair) => {
    addRelationshipPair(pair.from, pair.to, true);
  });
  const relationshipPairs = [...relationshipPairMap.values()];

  const pairAzimuthDms = (from: string, to: string): string => {
    const a = res.stations[from];
    const b = res.stations[to];
    if (!a || !b) return '-';
    const az = Math.atan2(b.x - a.x, b.y - a.y);
    const wrapped = az >= 0 ? az : az + 2 * Math.PI;
    return radToDmsStr(wrapped);
  };
  const horizDistanceMeters = (from: string, to: string): number | undefined => {
    const a = res.stations[from];
    const b = res.stations[to];
    if (!a || !b) return undefined;
    return Math.hypot(b.x - a.x, b.y - a.y);
  };
  const horizDistance = (from: string, to: string): string => {
    const distance = horizDistanceMeters(from, to);
    if (distance == null) return '-';
    return (distance * unitScale).toFixed(4);
  };
  const resolveRelativePair = createRelationshipPairResolver({
    gpsDirectFixedLinkedStations,
    gpsHorizontalCovarianceForRelationship,
    gpsObservationPairMap,
    precisionReportingMode,
    relativeCovarianceRows,
    relativePrecisionRows,
    res,
    usesCompactGnssParityLayout,
  });
  const relationshipRows = relationshipPairs
    .map((pair) => {
      const rel = resolveRelativePair(pair);
      const from = rel?.from ?? pair.from;
      const to = rel?.to ?? pair.to;
      const distanceMeters = horizDistanceMeters(from, to);
      const distance = horizDistance(from, to);
      const sigmaAz95 =
        rel?.sigmaAz != null
          ? (rel.sigmaAz * RAD_TO_DEG * 3600 * confidence95Scale).toFixed(2)
          : '-';
      const sigmaDist95 =
        rel?.sigmaDist != null
          ? (rel.sigmaDist * unitScale * confidence95Scale).toFixed(4)
          : '-';
      const ppm95 =
        rel?.sigmaDist != null && distanceMeters != null
          ? (
              (rel.sigmaDist * confidence95Scale * 1_000_000) /
              Math.max(1e-12, Math.abs(distanceMeters))
            ).toFixed(4)
          : '-';
      return {
        from,
        to,
        azimuth: pairAzimuthDms(from, to),
        distance,
        sigmaAz95,
        sigmaDist95,
        ppm95,
        sigmaDist: rel?.sigmaDist,
        sigmaH: rel?.sigmaH,
        ellipse: rel?.ellipse,
      };
    })
    .filter((row) => row.distance !== '-');
  const positionalToleranceRows = positionalToleranceEnabled
    ? selectedPositionalTolerancePairs
        .map((pair) => {
          const rel = resolveRelativePair(pair);
          const distanceMeters = horizDistanceMeters(pair.from, pair.to);
          if (!rel?.ellipse || distanceMeters == null || !Number.isFinite(distanceMeters)) return null;
          const toleranceMeters =
            positionalToleranceConstantMm / 1000 + (Math.abs(distanceMeters) * positionalTolerancePpm) / 1_000_000;
          const checkMeters = rel.ellipse.semiMajor * positionalToleranceConfidenceScale;
          return {
            from: pair.from,
            to: pair.to,
            distanceMeters,
            toleranceMeters,
            checkMeters,
            passes: checkMeters <= toleranceMeters + 1e-12,
          };
        })
        .filter((row): row is PositionalToleranceRow => row != null)
    : [];
  const pairDisplayCombinedFactor = (from: string, to: string): number => {
    const fromStation = res.stations[from];
    const toStation = res.stations[to];
    if (!fromStation || !toStation) return 1;
    const fromFactors = displayFactorsForStation(from, fromStation);
    const toFactors = displayFactorsForStation(to, toStation);
    return (fromFactors.combinedFactor + toFactors.combinedFactor) / 2;
  };
  if (usesClassicParityLayout) {
    relationshipRows.sort(
      (a, b) => compareStationIds(a.from, b.from) || compareStationIds(a.to, b.to),
    );
  }
  return {
    formatEllipseAzDm,
    gpsDirectFixedLinkedStations,
    pairDisplayCombinedFactor,
    positionalToleranceConfidencePercent,
    positionalToleranceConstantMm,
    positionalToleranceEnabled,
    positionalTolerancePpm,
    positionalToleranceRows,
    relationshipRows,
    selectedEllipseStationIds,
  };
};
