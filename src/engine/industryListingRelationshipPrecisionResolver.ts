import { RAD_TO_DEG } from './angles';
import {
  buildDistanceAzimuthPrecision,
  buildHorizontalErrorEllipse,
} from './precisionPropagation';
import {
  getRelativeCovarianceRows,
  getRelativePrecisionRows,
  getStationPrecision,
} from './resultPrecision';
import type {
  AdjustmentResult,
  GpsObservation,
  RelativeCovarianceBlock,
} from '../types';
import type { IndustryListingSettings } from './industryListingTypes';

export type RelationshipPair = { key: string; from: string; to: string };

export type RelativePairStats = {
  from: string;
  to: string;
  sigmaDist?: number;
  sigmaAz?: number;
  sigmaH?: number;
  ellipse?: { semiMajor: number; semiMinor: number; theta: number };
};

export type HorizontalCovariance = { cEE: number; cEN: number; cNN: number };

interface CreateRelationshipPairResolverOptions {
  gpsDirectFixedLinkedStations: Set<string>;
  gpsHorizontalCovarianceForRelationship: (_obs: GpsObservation) => HorizontalCovariance | undefined;
  gpsObservationPairMap: Map<string, GpsObservation[]>;
  precisionReportingMode: NonNullable<IndustryListingSettings['precisionReportingMode']>;
  relativeCovarianceRows: ReturnType<typeof getRelativeCovarianceRows>;
  relativePrecisionRows: ReturnType<typeof getRelativePrecisionRows>;
  res: AdjustmentResult;
  usesCompactGnssParityLayout: boolean;
}

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

export const createRelationshipPairResolver = ({
  gpsDirectFixedLinkedStations,
  gpsHorizontalCovarianceForRelationship,
  gpsObservationPairMap,
  precisionReportingMode,
  relativeCovarianceRows,
  relativePrecisionRows,
  res,
  usesCompactGnssParityLayout,
}: CreateRelationshipPairResolverOptions): ((_pair: RelationshipPair) => RelativePairStats | undefined) => {
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
    return buildBlendedGnssRelativePair({
      directHorizontalCovariance,
      fromFixedLinked,
      matchedCovariance,
      pair,
      stationCovariance,
      toFixedLinked,
      dE: toStation.x - fromStation.x,
      dN: toStation.y - fromStation.y,
    });
  };

  return (pair) => {
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
};

const buildBlendedGnssRelativePair = ({
  directHorizontalCovariance,
  dE,
  dN,
  fromFixedLinked,
  matchedCovariance,
  pair,
  stationCovariance,
  toFixedLinked,
}: {
  directHorizontalCovariance: HorizontalCovariance;
  dE: number;
  dN: number;
  fromFixedLinked: boolean;
  matchedCovariance: RelativeCovarianceBlock;
  pair: RelationshipPair;
  stationCovariance: (_id: string) => { varE: number; varN: number; covEN: number } | undefined;
  toFixedLinked: boolean;
}): RelativePairStats | undefined => {
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
  const fallbackHorizontalCovariance = buildFallbackHorizontalCovariance(
    pair,
    stationCovariance,
  );
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
  const blendedHorizontalCovariance = resolveBlendedHorizontalCovariance({
    directHorizontalCovariance,
    directToNetworkRatio,
    fallbackHorizontalCovariance,
    fallbackToNetworkRatio,
    matchedCovariance,
  });
  if (!blendedHorizontalCovariance) return undefined;
  const blendedPrecision = buildDistanceAzimuthPrecision(dE, dN, blendedHorizontalCovariance);
  const ellipseHorizontalCovariance = resolveEllipseHorizontalCovariance({
    blendedHorizontalCovariance,
    directToNetworkRatio,
    fallbackHorizontalCovariance,
    fallbackToNetworkRatio,
    fromFixedLinked,
    matchedCovariance,
    toFixedLinked,
  });
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

const buildFallbackHorizontalCovariance = (
  pair: RelationshipPair,
  stationCovariance: (_id: string) => { varE: number; varN: number; covEN: number } | undefined,
): HorizontalCovariance | undefined => {
  const fromStationCovariance = stationCovariance(pair.from);
  const toStationCovariance = stationCovariance(pair.to);
  return fromStationCovariance && toStationCovariance
    ? {
        cEE: fromStationCovariance.varE + toStationCovariance.varE,
        cEN: fromStationCovariance.covEN + toStationCovariance.covEN,
        cNN: fromStationCovariance.varN + toStationCovariance.varN,
      }
    : undefined;
};

const resolveBlendedHorizontalCovariance = ({
  directHorizontalCovariance,
  directToNetworkRatio,
  fallbackHorizontalCovariance,
  fallbackToNetworkRatio,
  matchedCovariance,
}: {
  directHorizontalCovariance: HorizontalCovariance;
  directToNetworkRatio: number;
  fallbackHorizontalCovariance?: HorizontalCovariance;
  fallbackToNetworkRatio?: number;
  matchedCovariance: RelativeCovarianceBlock;
}): HorizontalCovariance | undefined => {
  if (directToNetworkRatio > 1.02 && directToNetworkRatio < 1.4) {
    const blendWeight = Math.max(0, Math.min(1, (1.4 - directToNetworkRatio) / 0.38));
    if (blendWeight > 0) {
      return blendHorizontalCovariance(matchedCovariance, directHorizontalCovariance, blendWeight);
    }
  }
  if (
    directToNetworkRatio >= 1.4 &&
    fallbackHorizontalCovariance &&
    fallbackToNetworkRatio != null &&
    fallbackToNetworkRatio > 1.03 &&
    fallbackToNetworkRatio <= 1.25
  ) {
    const blendWeight = Math.max(0, Math.min(0.65, (fallbackToNetworkRatio - 1.03) / 0.28));
    if (blendWeight > 0) {
      return blendHorizontalCovariance(matchedCovariance, fallbackHorizontalCovariance, blendWeight);
    }
  }
  return undefined;
};

const resolveEllipseHorizontalCovariance = ({
  blendedHorizontalCovariance,
  directToNetworkRatio,
  fallbackHorizontalCovariance,
  fallbackToNetworkRatio,
  fromFixedLinked,
  matchedCovariance,
  toFixedLinked,
}: {
  blendedHorizontalCovariance: HorizontalCovariance;
  directToNetworkRatio: number;
  fallbackHorizontalCovariance?: HorizontalCovariance;
  fallbackToNetworkRatio?: number;
  fromFixedLinked: boolean;
  matchedCovariance: RelativeCovarianceBlock;
  toFixedLinked: boolean;
}): HorizontalCovariance => {
  if (
    !fallbackHorizontalCovariance ||
    !(fromFixedLinked || toFixedLinked) ||
    (fromFixedLinked && toFixedLinked)
  ) {
    return blendedHorizontalCovariance;
  }
  if (directToNetworkRatio > 1.02 && directToNetworkRatio < 1.4) {
    return blendHorizontalCovariance(matchedCovariance, fallbackHorizontalCovariance, 0.25, true);
  }
  if (
    directToNetworkRatio >= 1.4 &&
    fallbackToNetworkRatio != null &&
    fallbackToNetworkRatio > 1.03 &&
    fallbackToNetworkRatio <= 1.25
  ) {
    const ellipseBlendWeight = Math.max(
      0.25,
      Math.min(0.5, ((fallbackToNetworkRatio - 1.03) / 0.28) * 0.75),
    );
    return blendHorizontalCovariance(
      matchedCovariance,
      fallbackHorizontalCovariance,
      ellipseBlendWeight,
      true,
    );
  }
  return blendedHorizontalCovariance;
};
