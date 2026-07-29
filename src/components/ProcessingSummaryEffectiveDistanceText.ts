import type { AdjustmentResult } from '../types';

const padRight = (value: string, width: number) => value.padEnd(width, ' ');
const padLeft = (value: string, width: number) => value.padStart(width, ' ');

export const appendEffectiveDistanceSummaryLines = ({
  linearUnit,
  lines,
  result,
  unitScale,
}: {
  linearUnit: string;
  lines: string[];
  result: AdjustmentResult;
  unitScale: number;
}): void => {
  const effectiveByFamily = new Map<
    string,
    { count: number; sum: number; min: number; max: number }
  >();
  result.observations.forEach((obs) => {
    if (!Number.isFinite(obs.effectiveDistance)) return;
    const effectiveDistance = obs.effectiveDistance as number;
    if (!(effectiveDistance > 0)) return;
    const family =
      obs.type === 'angle'
        ? 'Angles'
        : obs.type === 'direction'
          ? 'Directions'
          : obs.type === 'bearing' || obs.type === 'dir'
            ? 'Az/Bearings'
            : obs.type === 'zenith'
              ? 'Zenith'
              : null;
    if (family == null) return;
    const row = effectiveByFamily.get(family) ?? {
      count: 0,
      sum: 0,
      min: Number.POSITIVE_INFINITY,
      max: 0,
    };
    row.count += 1;
    row.sum += effectiveDistance;
    row.min = Math.min(row.min, effectiveDistance);
    row.max = Math.max(row.max, effectiveDistance);
    effectiveByFamily.set(family, row);
  });
  if (effectiveByFamily.size === 0) return;
  lines.push('');
  lines.push(`Effective Distance Summary (${linearUnit})`);
  lines.push(
    `${padRight('Observation', 18)}${padLeft('Count', 7)}${padLeft('Mean', 12)}${padLeft(
      'Min',
      12,
    )}${padLeft('Max', 12)}`,
  );
  [...effectiveByFamily.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([label, row]) => {
      lines.push(
        `${padRight(label, 18)}${padLeft(row.count.toString(), 7)}${padLeft(
          ((row.sum / row.count) * unitScale).toFixed(4),
          12,
        )}${padLeft((row.min * unitScale).toFixed(4), 12)}${padLeft(
          (row.max * unitScale).toFixed(4),
          12,
        )}`,
      );
    });
};
