import {
  ecefDeltaToLocalEnu,
  transformFactoredEcefDeltaCovarianceToLocalEnu,
} from './geodesy';
import type { AdjustmentResult, GnssVectorFrame, GpsObservation, Station } from '../types';

type GpsDisplayVector = {
  calc: { dE: number; dN: number; dU?: number };
  residual: { vE: number; vN: number; vU?: number };
};

type GpsCovarianceDisplay = {
  sigmaX: number;
  sigmaY: number;
  sigmaZ: number;
  corrXY: number;
  corrXZ: number;
  corrYZ: number;
};

type BuildGpsDisplayHelpersOptions = {
  dof: number;
  gnssVectorFrameDefault: GnssVectorFrame;
  gpsObservationRows: GpsObservation[];
  stations: AdjustmentResult['stations'];
};

const stationEllipsoidHeightForGnssDisplay = (station: Station): number =>
  Number.isFinite(station.ellipsoidHeightUsed ?? Number.NaN)
    ? (station.ellipsoidHeightUsed as number)
    : station.h;

const geodeticToEcefForGnssDisplay = (
  latDeg: number,
  lonDeg: number,
  heightM: number,
): { x: number; y: number; z: number } => {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const a = 6378137;
  const f = 1 / 298.257223563;
  const e2 = f * (2 - f);
  const n = a / Math.sqrt(1 - e2 * sinLat * sinLat);
  return {
    x: (n + heightM) * cosLat * cosLon,
    y: (n + heightM) * cosLat * sinLon,
    z: (n * (1 - e2) + heightM) * sinLat,
  };
};

export const buildIndustryListingGpsDisplayHelpers = ({
  dof,
  gnssVectorFrameDefault,
  gpsObservationRows,
  stations,
}: BuildGpsDisplayHelpersOptions) => {
  const gpsDisplayVector = (obs: GpsObservation): GpsDisplayVector | undefined => {
    if (obs.gpsOffsetDistanceM != null || obs.gpsAntennaHiM != null || obs.gpsAntennaHtM != null) {
      return undefined;
    }
    const frame: GnssVectorFrame = obs.gnssVectorFrame ?? gnssVectorFrameDefault;
    if (frame !== 'ecefDelta' && frame !== 'enuLocal' && frame !== 'llhBaseline') {
      return undefined;
    }
    const fromStation = stations[obs.from];
    const toStation = stations[obs.to];
    if (
      !fromStation ||
      !toStation ||
      !Number.isFinite(fromStation.latDeg ?? Number.NaN) ||
      !Number.isFinite(fromStation.lonDeg ?? Number.NaN) ||
      !Number.isFinite(toStation.latDeg ?? Number.NaN) ||
      !Number.isFinite(toStation.lonDeg ?? Number.NaN)
    ) {
      return undefined;
    }
    const observed =
      frame === 'ecefDelta'
        ? ecefDeltaToLocalEnu(
            obs.obs.dE,
            obs.obs.dN,
            obs.obs.dU ?? 0,
            fromStation.latDeg as number,
            fromStation.lonDeg as number,
          )
        : {
            east: obs.obs.dE,
            north: obs.obs.dN,
            up: obs.obs.dU ?? 0,
          };
    const fromEcef = geodeticToEcefForGnssDisplay(
      fromStation.latDeg as number,
      fromStation.lonDeg as number,
      stationEllipsoidHeightForGnssDisplay(fromStation),
    );
    const toEcef = geodeticToEcefForGnssDisplay(
      toStation.latDeg as number,
      toStation.lonDeg as number,
      stationEllipsoidHeightForGnssDisplay(toStation),
    );
    const adjusted = ecefDeltaToLocalEnu(
      toEcef.x - fromEcef.x,
      toEcef.y - fromEcef.y,
      toEcef.z - fromEcef.z,
      fromStation.latDeg as number,
      fromStation.lonDeg as number,
    );
    const includeVertical = Number.isFinite(obs.obs.dU ?? Number.NaN);
    return {
      calc: {
        dE: adjusted.east,
        dN: adjusted.north,
        dU: includeVertical ? adjusted.up : undefined,
      },
      residual: {
        vE: observed.east - adjusted.east,
        vN: observed.north - adjusted.north,
        vU: includeVertical ? observed.up - adjusted.up : undefined,
      },
    };
  };

  const gpsCovarianceDisplay = (obs: GpsObservation): GpsCovarianceDisplay => {
    if (obs.gpsCovariance3d) {
      const frame: GnssVectorFrame = obs.gnssVectorFrame ?? gnssVectorFrameDefault;
      const fromStation = stations[obs.from];
      const transformed =
        frame === 'ecefDelta' &&
        fromStation &&
        Number.isFinite(fromStation.latDeg ?? Number.NaN) &&
        Number.isFinite(fromStation.lonDeg ?? Number.NaN)
          ? transformFactoredEcefDeltaCovarianceToLocalEnu(
              obs.gpsCovariance3d,
              fromStation.latDeg as number,
              fromStation.lonDeg as number,
              obs.gpsVectorHorizontalFactor,
              obs.gpsVectorVerticalFactor,
            )
          : null;
      const sigmaX = Math.sqrt(Math.max(transformed?.cEE ?? obs.gpsCovariance3d.cXX, 0));
      const sigmaY = Math.sqrt(Math.max(transformed?.cNN ?? obs.gpsCovariance3d.cYY, 0));
      const sigmaZ = Math.sqrt(Math.max(transformed?.cUU ?? obs.gpsCovariance3d.cZZ, 0));
      const corrXY =
        sigmaX > 0 && sigmaY > 0
          ? (transformed?.cEN ?? obs.gpsCovariance3d.cXY) / (sigmaX * sigmaY)
          : 0;
      const corrXZ =
        sigmaX > 0 && sigmaZ > 0
          ? (transformed?.cEU ?? obs.gpsCovariance3d.cXZ) / (sigmaX * sigmaZ)
          : 0;
      const corrYZ =
        sigmaY > 0 && sigmaZ > 0
          ? (transformed?.cNU ?? obs.gpsCovariance3d.cYZ) / (sigmaY * sigmaZ)
          : 0;
      return { sigmaX, sigmaY, sigmaZ, corrXY, corrXZ, corrYZ };
    }
    const sigmaX = Math.max(obs.stdDevE ?? obs.stdDev ?? 0, 0);
    const sigmaY = Math.max(obs.stdDevN ?? obs.stdDev ?? 0, 0);
    const sigmaZ = Math.max(obs.stdDevU ?? obs.stdDev ?? 0, 0);
    return {
      sigmaX,
      sigmaY,
      sigmaZ,
      corrXY: obs.corrEN ?? 0,
      corrXZ: obs.corrEU ?? 0,
      corrYZ: obs.corrNU ?? 0,
    };
  };

  const gpsInputCovarianceDisplay = (obs: GpsObservation): GpsCovarianceDisplay => {
    if (!obs.gpsCovariance3d) return gpsCovarianceDisplay(obs);
    const sigmaX = Math.sqrt(Math.max(obs.gpsCovariance3d.cXX, 0));
    const sigmaY = Math.sqrt(Math.max(obs.gpsCovariance3d.cYY, 0));
    const sigmaZ = Math.sqrt(Math.max(obs.gpsCovariance3d.cZZ, 0));
    return {
      sigmaX,
      sigmaY,
      sigmaZ,
      corrXY: sigmaX > 0 && sigmaY > 0 ? obs.gpsCovariance3d.cXY / (sigmaX * sigmaY) : 0,
      corrXZ: sigmaX > 0 && sigmaZ > 0 ? obs.gpsCovariance3d.cXZ / (sigmaX * sigmaZ) : 0,
      corrYZ: sigmaY > 0 && sigmaZ > 0 ? obs.gpsCovariance3d.cYZ / (sigmaY * sigmaZ) : 0,
    };
  };

  const gpsHorizontalCovarianceForRelationship = (
    obs: GpsObservation,
  ): { cEE: number; cEN: number; cNN: number } | undefined => {
    if (obs.gpsCovariance3d) {
      const frame: GnssVectorFrame = obs.gnssVectorFrame ?? gnssVectorFrameDefault;
      const fromStation = stations[obs.from];
      const transformed =
        frame === 'ecefDelta' &&
        fromStation &&
        Number.isFinite(fromStation.latDeg ?? Number.NaN) &&
        Number.isFinite(fromStation.lonDeg ?? Number.NaN)
          ? transformFactoredEcefDeltaCovarianceToLocalEnu(
              obs.gpsCovariance3d,
              fromStation.latDeg as number,
              fromStation.lonDeg as number,
              obs.gpsVectorHorizontalFactor,
              obs.gpsVectorVerticalFactor,
            )
          : null;
      return {
        cEE: transformed?.cEE ?? obs.gpsCovariance3d.cXX,
        cEN: transformed?.cEN ?? obs.gpsCovariance3d.cXY,
        cNN: transformed?.cNN ?? obs.gpsCovariance3d.cYY,
      };
    }
    const sigmaE = Math.max(obs.stdDevE ?? obs.stdDev ?? 0, 0);
    const sigmaN = Math.max(obs.stdDevN ?? obs.stdDev ?? 0, 0);
    const corrEN = obs.corrEN ?? 0;
    return {
      cEE: sigmaE * sigmaE,
      cEN: corrEN * sigmaE * sigmaN,
      cNN: sigmaN * sigmaN,
    };
  };

  const gpsListingStatisticalRow = () => {
    let count = 0;
    let sumSquares = 0;
    gpsObservationRows.forEach((obs) => {
      const displayVector = gpsDisplayVector(obs);
      const residual =
        displayVector?.residual ??
        ((obs.residual as { vE?: number; vN?: number; vU?: number } | undefined) ?? undefined);
      const cov = gpsCovarianceDisplay(obs);
      const components = [
        {
          stdRes:
            Number.isFinite(residual?.vN ?? Number.NaN) &&
            Number.isFinite(cov.sigmaY) &&
            cov.sigmaY > 0
              ? Math.abs((residual?.vN as number) / cov.sigmaY)
              : undefined,
        },
        {
          stdRes:
            Number.isFinite(residual?.vE ?? Number.NaN) &&
            Number.isFinite(cov.sigmaX) &&
            cov.sigmaX > 0
              ? Math.abs((residual?.vE as number) / cov.sigmaX)
              : undefined,
        },
        {
          stdRes:
            obs.componentStdRes?.tU ??
            (Number.isFinite(residual?.vU ?? Number.NaN) &&
            Number.isFinite(cov.sigmaZ) &&
            cov.sigmaZ > 0
              ? Math.abs((residual?.vU as number) / cov.sigmaZ)
              : undefined),
        },
      ];
      components.forEach(({ stdRes }) => {
        if (!Number.isFinite(stdRes ?? Number.NaN)) return;
        count += 1;
        sumSquares += (stdRes as number) ** 2;
      });
    });
    if (count === 0) return null;
    return {
      label: 'GPS',
      count,
      sumSquares,
      errorFactor: dof > 0 ? Math.sqrt(sumSquares / dof) : Math.sqrt(sumSquares / count),
    };
  };

  return {
    gpsCovarianceDisplay,
    gpsDisplayVector,
    gpsHorizontalCovarianceForRelationship,
    gpsInputCovarianceDisplay,
    gpsListingStatisticalRow,
  };
};

export const formatGpsStdResValue = (value: number | undefined): string =>
  value != null && Number.isFinite(value) ? Math.abs(value).toFixed(1) : '-';
