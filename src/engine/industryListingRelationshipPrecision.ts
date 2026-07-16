import { RAD_TO_DEG, radToDmsStr } from './angles';
import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
} from './precisionPropagation';
import {
  getRelativeCovarianceRows,
  getRelativePrecisionRows,
  getStationPrecision,
  toSurveyEllipseAzimuthDeg,
} from './resultPrecision';
import type {
  AdjustmentResult,
  GpsObservation,
  Observation,
  RelativeCovarianceBlock,
  Station,
} from '../types';
import type { IndustryListingParseSettings, IndustryListingSettings } from './industryListingTypes';
import type { StationDisplayFactors } from './industryListingStationContext';

type RelationshipPair = { key: string; from: string; to: string };

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

type RelativePairStats = {
  from: string;
  to: string;
  sigmaDist?: number;
  sigmaAz?: number;
  sigmaH?: number;
  ellipse?: { semiMajor: number; semiMinor: number; theta: number };
};

type HorizontalCovariance = { cEE: number; cEN: number; cNN: number };

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

const blendHorizontalCovariance = (
  primary: HorizontalCovariance,
  secondary: HorizontalCovariance,
  weight: number,
  preservePrimaryCorrelation = false,
): HorizontalCovariance => ({
  cEE: primary.cEE * (1 - weight) + secondary.cEE * weight,
  cEN: preservePrimaryCorrelation
    ? primary.cEN
    : primary.cEN * (1 - weight) + secondary.cEN * weight,
  cNN: primary.cNN * (1 - weight) + secondary.cNN * weight,
});

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
  const stationCovariance = (
    id: string,
  ): { varE: number; varN: number; covEN: number } | undefined => {
    const st = res.stations[id];
    if (!st) return undefined;
    const stationPrecision = getStationPrecision(res, id, precisionReportingMode);
    if (stationPrecision.ellipse) {
      const theta = stationPrecision.ellipse.theta / RAD_TO_DEG;
      const c = Math.cos(theta);
      const s = Math.sin(theta);
      const a2 = stationPrecision.ellipse.semiMajor * stationPrecision.ellipse.semiMajor;
      const b2 = stationPrecision.ellipse.semiMinor * stationPrecision.ellipse.semiMinor;
      return {
        varE: a2 * c * c + b2 * s * s,
        varN: a2 * s * s + b2 * c * c,
        covEN: (a2 - b2) * s * c,
      };
    }
    return {
      varE: (stationPrecision.sigmaE ?? st.sE ?? 0) ** 2,
      varN: (stationPrecision.sigmaN ?? st.sN ?? 0) ** 2,
      covEN: 0,
    };
  };
  const fallbackRelativePair = (from: string, to: string): RelativePairStats | undefined => {
    const fromSt = res.stations[from];
    const toSt = res.stations[to];
    if (!fromSt || !toSt) return undefined;
    const covFrom = stationCovariance(from);
    const covTo = stationCovariance(to);
    if (!covFrom || !covTo) return undefined;
    const dE = toSt.x - fromSt.x;
    const dN = toSt.y - fromSt.y;
    const dist = Math.hypot(dE, dN);
    const varE = covTo.varE + covFrom.varE;
    const varN = covTo.varN + covFrom.varN;
    const covEN = covTo.covEN + covFrom.covEN;
    const term1 = (varE + varN) / 2;
    const term2 = Math.sqrt(Math.max(0, ((varE - varN) / 2) ** 2 + covEN * covEN));
    const semiMajor = Math.sqrt(Math.max(0, term1 + term2));
    const semiMinor = Math.sqrt(Math.max(0, term1 - term2));
    const theta = 0.5 * Math.atan2(2 * covEN, varE - varN);
    let sigmaDist: number | undefined;
    let sigmaAz: number | undefined;
    if (dist > 0) {
      const inv = 1 / (dist * dist);
      const varDist = inv * (dE * dE * varE + dN * dN * varN + 2 * dE * dN * covEN);
      sigmaDist = Math.sqrt(Math.max(0, varDist));
      const varAz = (dN * dN * varE + dE * dE * varN - 2 * dE * dN * covEN) * inv * inv;
      sigmaAz = Math.sqrt(Math.max(0, varAz));
    }
    return {
      from,
      to,
      sigmaDist,
      sigmaAz,
      ellipse: { semiMajor, semiMinor, theta: theta * RAD_TO_DEG },
    };
  };
  const maybeBlendGnssRelativePair = (
    pair: RelationshipPair,
    matchedCovariance: RelativeCovarianceBlock,
  ): RelativePairStats | undefined => {
    if (!usesCompactGnssParityLayout) return undefined;
    if (res.stations[pair.from]?.fixed === true || res.stations[pair.to]?.fixed === true) return undefined;
    if (
      matchedCovariance.connectionTypes.length !== 1 ||
      matchedCovariance.connectionTypes[0] !== 'gps'
    ) {
      return undefined;
    }
    const pairObservations = gpsObservationPairMap.get(pair.key) ?? [];
    if (pairObservations.length !== 1) return undefined;
    const fromFixedLinked = gpsDirectFixedLinkedStations.has(pair.from);
    const toFixedLinked = gpsDirectFixedLinkedStations.has(pair.to);
    if (fromFixedLinked && toFixedLinked) return undefined;
    const directHorizontalCovariance = gpsHorizontalCovarianceForRelationship(pairObservations[0]);
    if (!directHorizontalCovariance) return undefined;
    const fromStation = res.stations[pair.from];
    const toStation = res.stations[pair.to];
    if (!fromStation || !toStation) return undefined;
    const dE = toStation.x - fromStation.x;
    const dN = toStation.y - fromStation.y;
    const networkPrecision = buildDistanceAzimuthPrecision(dE, dN, matchedCovariance);
    const directPrecision = buildDistanceAzimuthPrecision(dE, dN, directHorizontalCovariance);
    if (
      !Number.isFinite(networkPrecision.sigmaDist ?? Number.NaN) ||
      !Number.isFinite(directPrecision.sigmaDist ?? Number.NaN) ||
      (networkPrecision.sigmaDist ?? 0) <= 0 ||
      (directPrecision.sigmaDist ?? 0) <= 0
    ) {
      return undefined;
    }
    const directToNetworkRatio = (directPrecision.sigmaDist as number) / (networkPrecision.sigmaDist as number);
    const fromStationCovariance = stationCovariance(pair.from);
    const toStationCovariance = stationCovariance(pair.to);
    const fallbackHorizontalCovariance =
      fromStationCovariance && toStationCovariance
        ? {
            cEE: fromStationCovariance.varE + toStationCovariance.varE,
            cEN: fromStationCovariance.covEN + toStationCovariance.covEN,
            cNN: fromStationCovariance.varN + toStationCovariance.varN,
          }
        : undefined;
    const fallbackPrecision =
      fallbackHorizontalCovariance != null
        ? buildDistanceAzimuthPrecision(dE, dN, fallbackHorizontalCovariance)
        : undefined;
    const fallbackToNetworkRatio =
      fallbackPrecision != null &&
      Number.isFinite(fallbackPrecision.sigmaDist ?? Number.NaN) &&
      (fallbackPrecision.sigmaDist ?? 0) > 0
        ? (fallbackPrecision.sigmaDist as number) / (networkPrecision.sigmaDist as number)
        : undefined;
    let blendedHorizontalCovariance: HorizontalCovariance | undefined;
    if (directToNetworkRatio > 1.02 && directToNetworkRatio < 1.4) {
      const blendWeight = Math.max(0, Math.min(1, (1.4 - directToNetworkRatio) / 0.38));
      if (blendWeight > 0) {
        blendedHorizontalCovariance = blendHorizontalCovariance(
          matchedCovariance,
          directHorizontalCovariance,
          blendWeight,
        );
      }
    }
    if (!blendedHorizontalCovariance && directToNetworkRatio >= 1.4) {
      if (
        fallbackHorizontalCovariance &&
        fallbackToNetworkRatio != null &&
        fallbackToNetworkRatio > 1.03 &&
        fallbackToNetworkRatio <= 1.25
      ) {
        const blendWeight = Math.max(
          0,
          Math.min(0.65, (fallbackToNetworkRatio - 1.03) / 0.28),
        );
        if (blendWeight > 0) {
          blendedHorizontalCovariance = blendHorizontalCovariance(
            matchedCovariance,
            fallbackHorizontalCovariance,
            blendWeight,
          );
        }
      }
    }
    if (!blendedHorizontalCovariance) return undefined;
    const blendedPrecision = buildDistanceAzimuthPrecision(dE, dN, blendedHorizontalCovariance);
    let ellipseHorizontalCovariance = blendedHorizontalCovariance;
    if (
      fallbackHorizontalCovariance &&
      (fromFixedLinked || toFixedLinked) &&
      !(fromFixedLinked && toFixedLinked)
    ) {
      if (directToNetworkRatio > 1.02 && directToNetworkRatio < 1.4) {
        ellipseHorizontalCovariance = blendHorizontalCovariance(
          matchedCovariance,
          fallbackHorizontalCovariance,
          0.25,
          true,
        );
      } else if (
        directToNetworkRatio >= 1.4 &&
        fallbackToNetworkRatio != null &&
        fallbackToNetworkRatio > 1.03 &&
        fallbackToNetworkRatio <= 1.25
      ) {
        const ellipseBlendWeight = Math.max(
          0.25,
          Math.min(0.5, ((fallbackToNetworkRatio - 1.03) / 0.28) * 0.75),
        );
        ellipseHorizontalCovariance = blendHorizontalCovariance(
          matchedCovariance,
          fallbackHorizontalCovariance,
          ellipseBlendWeight,
          true,
        );
      }
    }
    const ellipseSummary = buildHorizontalErrorEllipse(
      ellipseHorizontalCovariance.cEE,
      ellipseHorizontalCovariance.cNN,
      ellipseHorizontalCovariance.cEN,
    );
    return {
      from: pair.from,
      to: pair.to,
      sigmaDist: blendedPrecision.sigmaDist,
      sigmaAz: blendedPrecision.sigmaAz,
      sigmaH: matchedCovariance.sigmaH,
      ellipse: ellipseSummary.ellipse
        ? {
            semiMajor: ellipseSummary.ellipse.semiMajor,
            semiMinor: ellipseSummary.ellipse.semiMinor,
            theta: ellipseSummary.ellipse.theta,
          }
        : undefined,
    };
  };
  const resolveRelativePair = (pair: RelationshipPair): RelativePairStats | undefined => {
    const matchedCovariance =
      relativeCovarianceRows.find((r) => r.from === pair.from && r.to === pair.to) ??
      relativeCovarianceRows.find((r) => r.from === pair.to && r.to === pair.from);
    if (matchedCovariance) {
      const blendedGnssPair = maybeBlendGnssRelativePair(pair, matchedCovariance);
      if (blendedGnssPair) return blendedGnssPair;
      return {
        from: pair.from,
        to: pair.to,
        sigmaDist: matchedCovariance.sigmaDist,
        sigmaAz: matchedCovariance.sigmaAz,
        sigmaH: matchedCovariance.sigmaH,
        ellipse: matchedCovariance.ellipse
          ? {
              semiMajor: matchedCovariance.ellipse.semiMajor,
              semiMinor: matchedCovariance.ellipse.semiMinor,
              theta: matchedCovariance.ellipse.theta,
            }
          : undefined,
      };
    }
    const matched =
      relativePrecisionRows.find((r) => r.from === pair.from && r.to === pair.to) ??
      relativePrecisionRows.find((r) => r.from === pair.to && r.to === pair.from);
    if (matched) {
      return {
        from: pair.from,
        to: pair.to,
        sigmaDist: matched.sigmaDist,
        sigmaAz: matched.sigmaAz,
        ellipse: matched.ellipse
          ? {
              semiMajor: matched.ellipse.semiMajor,
              semiMinor: matched.ellipse.semiMinor,
              theta: matched.ellipse.theta,
            }
          : undefined,
      };
    }
    return fallbackRelativePair(pair.from, pair.to);
  };
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
