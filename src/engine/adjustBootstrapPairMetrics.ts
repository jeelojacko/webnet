import { makeDirectedPairKey } from './adjustMath';
import type { BootstrapPairMetrics } from './adjustTypes';
import type { Observation } from '../types';

export const buildBootstrapPairMetrics = (
  activeObservations: Observation[],
): Map<string, BootstrapPairMetrics> => {
  const zenithStats = new Map<string, { sum: number; count: number }>();
  activeObservations.forEach((observation) => {
    if (observation.type !== 'zenith') return;
    const key = makeDirectedPairKey(observation.from, observation.to);
    const entry = zenithStats.get(key) ?? { sum: 0, count: 0 };
    entry.sum += observation.obs;
    entry.count += 1;
    zenithStats.set(key, entry);
  });

  const metrics = new Map<
    string,
    {
      slopeSum: number;
      horizSum: number;
      bootstrapZenithSum: number;
      bootstrapZenithCount: number;
      hiSum: number;
      hiCount: number;
      htSum: number;
      htCount: number;
      count: number;
    }
  >();
  activeObservations.forEach((observation) => {
    if (observation.type !== 'dist') return;
    const key = makeDirectedPairKey(observation.from, observation.to);
    const zenithEntry = zenithStats.get(key);
    const zenith =
      zenithEntry && zenithEntry.count > 0
        ? zenithEntry.sum / zenithEntry.count
        : Number.isFinite(observation.bootstrapZenithObs ?? Number.NaN)
          ? observation.bootstrapZenithObs
          : undefined;
    const slopeDistance = observation.obs;
    const horizDistance =
      observation.mode === 'slope' && Number.isFinite(zenith ?? Number.NaN)
        ? Math.abs(slopeDistance * Math.sin(zenith as number))
        : Math.abs(slopeDistance);
    const entry = metrics.get(key) ?? {
      slopeSum: 0,
      horizSum: 0,
      bootstrapZenithSum: 0,
      bootstrapZenithCount: 0,
      hiSum: 0,
      hiCount: 0,
      htSum: 0,
      htCount: 0,
      count: 0,
    };
    entry.slopeSum += slopeDistance;
    entry.horizSum += horizDistance;
    if (!(zenithEntry && zenithEntry.count > 0) && Number.isFinite(zenith ?? Number.NaN)) {
      entry.bootstrapZenithSum += zenith as number;
      entry.bootstrapZenithCount += 1;
    }
    if (Number.isFinite(observation.hi ?? Number.NaN)) {
      entry.hiSum += observation.hi as number;
      entry.hiCount += 1;
    }
    if (Number.isFinite(observation.ht ?? Number.NaN)) {
      entry.htSum += observation.ht as number;
      entry.htCount += 1;
    }
    entry.count += 1;
    metrics.set(key, entry);
  });

  return new Map(
    [...metrics.entries()].map(([key, entry]) => {
      const zenithEntry = zenithStats.get(key);
      return [
        key,
        {
          slopeDistance: entry.slopeSum / entry.count,
          horizDistance: entry.horizSum / entry.count,
          zenith:
            zenithEntry && zenithEntry.count > 0
              ? zenithEntry.sum / zenithEntry.count
              : entry.bootstrapZenithCount > 0
                ? entry.bootstrapZenithSum / entry.bootstrapZenithCount
                : undefined,
          hi: entry.hiCount > 0 ? entry.hiSum / entry.hiCount : undefined,
          ht: entry.htCount > 0 ? entry.htSum / entry.htCount : undefined,
        } satisfies BootstrapPairMetrics,
      ];
    }),
  );
};
