import type { AdjustmentResult, Observation, StationId } from '../types';

const obsSetupStation = (obs: Observation): StationId | undefined => {
  if (obs.type === 'direction' || obs.type === 'angle') return obs.at;
  if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'zenith' ||
    obs.type === 'lev' ||
    obs.type === 'gps' ||
    obs.type === 'dir'
  ) {
    return obs.from;
  }
  return undefined;
};

const obsStationsLabel = (obs: Observation): string => {
  if (obs.type === 'angle') return `${obs.at}-${obs.from}-${obs.to}`;
  if (obs.type === 'direction') return `${obs.at}-${obs.to}`;
  if (
    obs.type === 'dist' ||
    obs.type === 'bearing' ||
    obs.type === 'zenith' ||
    obs.type === 'lev' ||
    obs.type === 'gps' ||
    obs.type === 'dir'
  ) {
    return `${obs.from}-${obs.to}`;
  }
  return '-';
};

export const buildSetupDiagnostics = ({
  activeObservations,
  directionSetDiagnostics,
}: {
  activeObservations: Observation[];
  directionSetDiagnostics?: AdjustmentResult['directionSetDiagnostics'];
}): NonNullable<AdjustmentResult['setupDiagnostics']> | undefined => {
  const setupMap = new Map<
    StationId,
    {
      station: StationId;
      directionSetIds: Set<string>;
      directionObsCount: number;
      angleObsCount: number;
      distanceObsCount: number;
      bearingObsCount: number;
      zenithObsCount: number;
      levelingObsCount: number;
      gpsObsCount: number;
      traverseDistance: number;
      orientationRmsSum: number;
      orientationSeSum: number;
      orientationCount: number;
      stdResCount: number;
      stdResSumSq: number;
      stdResMaxAbs: number;
      localFailCount: number;
      worstObsType?: string;
      worstObsStations?: string;
      worstObsLine?: number;
    }
  >();

  const ensureSetup = (station: StationId) => {
    const existing = setupMap.get(station);
    if (existing) return existing;
    const created = {
      station,
      directionSetIds: new Set<string>(),
      directionObsCount: 0,
      angleObsCount: 0,
      distanceObsCount: 0,
      bearingObsCount: 0,
      zenithObsCount: 0,
      levelingObsCount: 0,
      gpsObsCount: 0,
      traverseDistance: 0,
      orientationRmsSum: 0,
      orientationSeSum: 0,
      orientationCount: 0,
      stdResCount: 0,
      stdResSumSq: 0,
      stdResMaxAbs: 0,
      localFailCount: 0,
      worstObsType: undefined,
      worstObsStations: undefined,
      worstObsLine: undefined,
    };
    setupMap.set(station, created);
    return created;
  };

  activeObservations.forEach((obs) => {
    const setupId = obsSetupStation(obs);
    if (!setupId) return;
    const setup = ensureSetup(setupId);
    if (obs.type === 'direction') {
      setup.directionObsCount += 1;
      setup.directionSetIds.add(String((obs as any).setId));
    } else if (obs.type === 'angle') {
      setup.angleObsCount += 1;
    } else if (obs.type === 'dir') {
      setup.directionObsCount += 1;
    } else if (obs.type === 'dist') {
      setup.distanceObsCount += 1;
      const setTag = String((obs as any).setId ?? '').toUpperCase();
      if (setTag === 'T' || setTag === 'TE') {
        setup.traverseDistance += Math.abs(obs.obs);
      }
    } else if (obs.type === 'bearing') {
      setup.bearingObsCount += 1;
    } else if (obs.type === 'zenith') {
      setup.zenithObsCount += 1;
    } else if (obs.type === 'lev') {
      setup.levelingObsCount += 1;
    } else if (obs.type === 'gps') {
      setup.gpsObsCount += 1;
    }

    const stdRes = obs.stdRes;
    const absStdRes =
      typeof stdRes === 'number' && Number.isFinite(stdRes) ? Math.abs(stdRes) : undefined;
    if (absStdRes != null) {
      setup.stdResCount += 1;
      setup.stdResSumSq += absStdRes * absStdRes;
      if (absStdRes > setup.stdResMaxAbs) {
        setup.stdResMaxAbs = absStdRes;
        setup.worstObsType = obs.type;
        setup.worstObsStations = obsStationsLabel(obs);
        setup.worstObsLine = obs.sourceLine;
      }
    }

    const localComp = obs.localTestComponents;
    if (localComp) {
      if (!localComp.passE) setup.localFailCount += 1;
      if (!localComp.passN) setup.localFailCount += 1;
    } else if (obs.localTest && !obs.localTest.pass) {
      setup.localFailCount += 1;
    }
  });

  (directionSetDiagnostics ?? []).forEach((d) => {
    const setup = ensureSetup(d.occupy);
    if (d.residualRmsArcSec != null) setup.orientationRmsSum += d.residualRmsArcSec;
    if (d.orientationSeArcSec != null) setup.orientationSeSum += d.orientationSeArcSec;
    setup.orientationCount += 1;
  });

  if (setupMap.size === 0) return undefined;

  return Array.from(setupMap.values())
    .map((s) => ({
      station: s.station,
      directionSetCount: s.directionSetIds.size,
      directionObsCount: s.directionObsCount,
      angleObsCount: s.angleObsCount,
      distanceObsCount: s.distanceObsCount,
      bearingObsCount: s.bearingObsCount,
      zenithObsCount: s.zenithObsCount,
      levelingObsCount: s.levelingObsCount,
      gpsObsCount: s.gpsObsCount,
      traverseDistance: s.traverseDistance,
      orientationRmsArcSec: s.orientationCount > 0 ? s.orientationRmsSum / s.orientationCount : undefined,
      orientationSeArcSec: s.orientationCount > 0 ? s.orientationSeSum / s.orientationCount : undefined,
      stdResCount: s.stdResCount,
      rmsStdRes: s.stdResCount > 0 ? Math.sqrt(s.stdResSumSq / s.stdResCount) : undefined,
      maxStdRes: s.stdResCount > 0 ? s.stdResMaxAbs : undefined,
      localFailCount: s.localFailCount,
      worstObsType: s.worstObsType,
      worstObsStations: s.worstObsStations,
      worstObsLine: s.worstObsLine,
    }))
    .sort((a, b) => a.station.localeCompare(b.station));
};

export const buildTraverseDiagnostics = ({
  closureVectors,
  loopVectors,
  loopAngleArcSec,
  loopVerticalMisclosure,
  totalTraverseDistance,
  thresholds,
  setupDiagnostics,
  hasClosureObs,
}: {
  closureVectors: Array<{ from: StationId; to: StationId; dE: number; dN: number }>;
  loopVectors: Record<string, { dE: number; dN: number }>;
  loopAngleArcSec: Map<string, number>;
  loopVerticalMisclosure: Map<string, number>;
  totalTraverseDistance: number;
  thresholds: NonNullable<NonNullable<AdjustmentResult['traverseDiagnostics']>['thresholds']>;
  setupDiagnostics?: AdjustmentResult['setupDiagnostics'];
  hasClosureObs: boolean;
}): AdjustmentResult['traverseDiagnostics'] | undefined => {
  const hasResidualGeometry =
    closureVectors.length > 0 || loopAngleArcSec.size > 0 || loopVerticalMisclosure.size > 0;
  if (!hasResidualGeometry && !hasClosureObs) return undefined;

  const netAngularMisclosureArcSec = Array.from(loopAngleArcSec.values()).reduce((acc, v) => acc + v, 0);
  const netVerticalMisclosure = Array.from(loopVerticalMisclosure.values()).reduce((acc, v) => acc + v, 0);

  if (closureVectors.length > 0) {
    const netE = closureVectors.reduce((acc, v) => acc + v.dE, 0);
    const netN = closureVectors.reduce((acc, v) => acc + v.dN, 0);
    const mag = Math.hypot(netE, netN);
    const closureRatio = mag > 1e-12 ? totalTraverseDistance / mag : undefined;
    const linearPpm =
      totalTraverseDistance > 1e-12 ? (mag / totalTraverseDistance) * 1_000_000 : undefined;
    const ratioPass = closureRatio != null ? closureRatio >= thresholds.minClosureRatio : false;
    const ppmPass = linearPpm != null ? linearPpm <= thresholds.maxLinearPpm : false;
    const angularPass =
      loopAngleArcSec.size === 0 || Math.abs(netAngularMisclosureArcSec) <= thresholds.maxAngularArcSec;
    const verticalPass =
      loopVerticalMisclosure.size === 0 ||
      Math.abs(netVerticalMisclosure) <= thresholds.maxVerticalMisclosure;

    const setupTraverseDistance = new Map<string, number>();
    (setupDiagnostics ?? []).forEach((s) => {
      setupTraverseDistance.set(s.station, s.traverseDistance);
    });
    const loopKeys = new Set<string>([
      ...Object.keys(loopVectors),
      ...Array.from(loopAngleArcSec.keys()),
      ...Array.from(loopVerticalMisclosure.keys()),
    ]);
    const defaultLoopDist = loopKeys.size > 0 ? totalTraverseDistance / loopKeys.size : 0;
    const loops = Array.from(loopKeys)
      .map((key) => {
        const [from = '', to = ''] = key.split('->');
        const vec = loopVectors[key] ?? { dE: 0, dN: 0 };
        const loopMag = Math.hypot(vec.dE, vec.dN);
        const traverseDistance = setupTraverseDistance.get(from) ?? defaultLoopDist;
        const loopRatio = loopMag > 1e-12 ? traverseDistance / loopMag : undefined;
        const loopPpm = traverseDistance > 1e-12 ? (loopMag / traverseDistance) * 1_000_000 : undefined;
        const loopAng = loopAngleArcSec.get(key);
        const loopVert = loopVerticalMisclosure.get(key);
        const ratioOk = loopRatio != null ? loopRatio >= thresholds.minClosureRatio : false;
        const ppmOk = loopPpm != null ? loopPpm <= thresholds.maxLinearPpm : false;
        const angOk = loopAng == null || Math.abs(loopAng) <= thresholds.maxAngularArcSec;
        const vertOk = loopVert == null || Math.abs(loopVert) <= thresholds.maxVerticalMisclosure;
        let severity = 0;
        if (!ratioOk && loopRatio != null) {
          severity += (thresholds.minClosureRatio / Math.max(loopRatio, 1) - 1) * 70;
        }
        if (!ppmOk && loopPpm != null) {
          severity += (loopPpm / thresholds.maxLinearPpm - 1) * 70;
        }
        if (!angOk && loopAng != null) {
          severity += (Math.abs(loopAng) / thresholds.maxAngularArcSec - 1) * 35;
        }
        if (!vertOk && loopVert != null) {
          severity += (Math.abs(loopVert) / thresholds.maxVerticalMisclosure - 1) * 35;
        }
        severity += Math.min(loopMag * 10, 25);
        return {
          key,
          from,
          to,
          misclosureE: vec.dE,
          misclosureN: vec.dN,
          misclosureMag: loopMag,
          traverseDistance,
          closureRatio: loopRatio,
          linearPpm: loopPpm,
          angularMisclosureArcSec: loopAng,
          verticalMisclosure: loopVert,
          severity,
          pass: ratioOk && ppmOk && angOk && vertOk,
        };
      })
      .sort((a, b) => {
        if (b.severity !== a.severity) return b.severity - a.severity;
        return b.misclosureMag - a.misclosureMag;
      });

    return {
      closureCount: closureVectors.length,
      misclosureE: netE,
      misclosureN: netN,
      misclosureMag: mag,
      totalTraverseDistance,
      closureRatio,
      linearPpm,
      angularMisclosureArcSec: loopAngleArcSec.size > 0 ? netAngularMisclosureArcSec : undefined,
      verticalMisclosure: loopVerticalMisclosure.size > 0 ? netVerticalMisclosure : undefined,
      thresholds,
      passes: {
        ratio: ratioPass,
        linearPpm: ppmPass,
        angular: angularPass,
        vertical: verticalPass,
        overall: ratioPass && ppmPass && angularPass && verticalPass,
      },
      loops,
    };
  }

  return {
    closureCount: 0,
    misclosureE: 0,
    misclosureN: 0,
    misclosureMag: 0,
    totalTraverseDistance,
    closureRatio: undefined,
    linearPpm: undefined,
    angularMisclosureArcSec: loopAngleArcSec.size > 0 ? netAngularMisclosureArcSec : undefined,
    verticalMisclosure: loopVerticalMisclosure.size > 0 ? netVerticalMisclosure : undefined,
    thresholds,
    passes: {
      ratio: false,
      linearPpm: false,
      angular:
        loopAngleArcSec.size === 0 || Math.abs(netAngularMisclosureArcSec) <= thresholds.maxAngularArcSec,
      vertical:
        loopVerticalMisclosure.size === 0 ||
        Math.abs(netVerticalMisclosure) <= thresholds.maxVerticalMisclosure,
      overall: false,
    },
    loops: [],
  };
};
