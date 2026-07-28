import type {
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedSourceMetadata,
  ImportedTraceEntry,
} from '../importers';
import { normalizeImportedFace } from './sharedText';

export * from './sharedDataset';
export * from './sharedMarkup';
export * from './sharedText';

const buildTraceSummary = (trace: ImportedTraceEntry[]): { warnings: number; errors: number } => ({
  warnings: trace.filter((entry) => entry.level === 'warning').length,
  errors: trace.filter((entry) => entry.level === 'error').length,
});

const inferImportedFaceFromZenith = (
  zenithDeg: number | undefined,
  windowDeg = 45,
): 'FACE1' | 'FACE2' | undefined => {
  if (!Number.isFinite(zenithDeg as number)) return undefined;
  const wrapped = (((zenithDeg as number) % 360) + 360) % 360;
  const distanceTo = (center: number): number => {
    let delta = Math.abs(wrapped - center) % 360;
    if (delta > 180) delta = 360 - delta;
    return delta;
  };
  const f1Distance = distanceTo(90);
  const f2Distance = distanceTo(270);
  if (f1Distance <= windowDeg && f2Distance > windowDeg) return 'FACE1';
  if (f2Distance <= windowDeg && f1Distance > windowDeg) return 'FACE2';
  return undefined;
};

export const enrichImportedDatasetDirectionFaces = (
  dataset: ImportedDataset,
  options: { zenithWindowDeg?: number } = {},
): ImportedDataset => {
  const windowDeg = Math.max(1, options.zenithWindowDeg ?? 45);
  let changed = false;
  const observations = dataset.observations.map((observation) => {
    if (observation.kind !== 'measurement' && observation.kind !== 'angle') {
      return observation;
    }

    const existingFace = normalizeImportedFace(observation.sourceMeta?.face);
    if (existingFace) {
      if (
        observation.sourceMeta?.face === existingFace &&
        observation.sourceMeta?.faceSource === 'metadata'
      ) {
        return observation;
      }
      changed = true;
      return {
        ...observation,
        sourceMeta: {
          ...(observation.sourceMeta ?? {}),
          face: existingFace,
          faceSource: observation.sourceMeta?.faceSource ?? 'metadata',
        },
      } as ImportedObservationRecord;
    }

    const zenithDeg =
      observation.kind === 'measurement' &&
      observation.verticalMode === 'zenith' &&
      Number.isFinite(observation.verticalValue)
        ? observation.verticalValue
        : undefined;
    const inferredFace = inferImportedFaceFromZenith(zenithDeg, windowDeg);
    if (!inferredFace) return observation;

    changed = true;
    return {
      ...observation,
      sourceMeta: {
        ...(observation.sourceMeta ?? {}),
        face: inferredFace,
        faceSource: 'zenith',
      },
    } as ImportedObservationRecord;
  });

  if (!changed) return dataset;
  return {
    ...dataset,
    observations,
  };
};

const normalizeAngleDeg = (value: number): number => {
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped === 360 ? 0 : wrapped;
};

export const choosePreferredStation = (
  existing: ImportedControlStationRecord | undefined,
  candidate: ImportedControlStationRecord,
): ImportedControlStationRecord => {
  if (!existing) return candidate;
  if (existing.coordinateMode !== candidate.coordinateMode) {
    return candidate.coordinateMode === 'geodetic' ? candidate : existing;
  }
  const existingScore =
    Number(existing.heightM != null) +
    Number(existing.sigmaEastM != null || existing.sigmaNorthM != null) +
    Number(existing.description != null);
  const candidateScore =
    Number(candidate.heightM != null) +
    Number(candidate.sigmaEastM != null || candidate.sigmaNorthM != null) +
    Number(candidate.description != null);
  return candidateScore >= existingScore ? candidate : existing;
};

export const buildTraceDetailLine = (trace: ImportedTraceEntry[]): string | null => {
  const { warnings, errors } = buildTraceSummary(trace);
  if (warnings === 0 && errors === 0) return null;
  const parts: string[] = [];
  if (warnings > 0) parts.push(`Warnings: ${warnings}`);
  if (errors > 0) parts.push(`Errors: ${errors}`);
  parts.push('unsupported content left in comment form for traceability.');
  return parts.join('. ');
};

interface ImportedObservationBundleOptions {
  observations: ImportedObservationRecord[];
  trace: ImportedTraceEntry[];
  sourceLine: number;
  sourceCode: string;
  occupyId: string;
  targetId: string;
  backsightId?: string;
  angleDeg?: number;
  bearingDeg?: number;
  distanceM?: number;
  distanceMode?: 'slope' | 'horizontal';
  verticalMode?: 'zenith' | 'delta-h';
  verticalValue?: number;
  hiM?: number;
  htM?: number;
  raw?: string;
  tracePrefix?: string;
  sourceMeta?: ImportedSourceMetadata;
}

export const appendImportedObservationBundle = ({
  observations,
  trace,
  sourceLine,
  sourceCode,
  occupyId,
  targetId,
  backsightId,
  angleDeg,
  bearingDeg,
  distanceM,
  distanceMode,
  verticalMode,
  verticalValue,
  hiM,
  htM,
  raw,
  tracePrefix = 'Observation',
  sourceMeta,
}: ImportedObservationBundleOptions): void => {
  const hasVertical = verticalMode != null && verticalValue != null;
  const useMeasurementRecord =
    backsightId != null && angleDeg != null && distanceMode !== 'horizontal';
  const useDistanceVerticalRecord =
    distanceM != null && distanceMode !== 'horizontal' && hasVertical;

  if (backsightId && angleDeg != null) {
    if (useMeasurementRecord && distanceM != null) {
      observations.push({
        kind: 'measurement',
        atId: occupyId,
        fromId: backsightId,
        toId: targetId,
        angleDeg: normalizeAngleDeg(angleDeg),
        distanceM,
        verticalMode,
        verticalValue,
        hiM,
        htM,
        sourceLine,
        sourceCode,
        note: 'converted to M',
        sourceMeta,
      });
      return;
    }

    observations.push({
      kind: 'angle',
      atId: occupyId,
      fromId: backsightId,
      toId: targetId,
      angleDeg: normalizeAngleDeg(angleDeg),
      sourceLine,
      sourceCode,
      note: 'converted to A',
      sourceMeta,
    });
  } else if (bearingDeg != null) {
    observations.push({
      kind: 'bearing',
      fromId: occupyId,
      toId: targetId,
      bearingDeg: normalizeAngleDeg(bearingDeg),
      sourceLine,
      sourceCode,
      note: 'converted to B',
      sourceMeta,
    });
  }

  if (useDistanceVerticalRecord && distanceM != null) {
    observations.push({
      kind: 'distance-vertical',
      fromId: occupyId,
      toId: targetId,
      distanceM,
      verticalMode: verticalMode!,
      verticalValue: verticalValue!,
      hiM,
      htM,
      sourceLine,
      sourceCode,
      note: 'converted to DV',
      sourceMeta,
    });
    return;
  }

  if (distanceM != null) {
    observations.push({
      kind: 'distance',
      fromId: occupyId,
      toId: targetId,
      distanceM,
      hiM,
      htM,
      sourceLine,
      sourceCode,
      note: 'converted to D',
      sourceMeta,
    });
  }

  if (hasVertical) {
    observations.push({
      kind: 'vertical',
      fromId: occupyId,
      toId: targetId,
      verticalMode: verticalMode!,
      verticalValue: verticalValue!,
      hiM,
      htM,
      sourceLine,
      sourceCode,
      note: 'converted to V',
      sourceMeta,
    });
  }

  if (angleDeg == null && bearingDeg == null && distanceM != null) {
    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode,
      message: `${tracePrefix} ${targetId} had no usable angle or azimuth; imported as ${hasVertical ? 'distance/vertical' : 'distance'} only.`,
      raw,
    });
    return;
  }

  if (angleDeg == null && bearingDeg == null && hasVertical) {
    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode,
      message: `${tracePrefix} ${targetId} had no usable angle, azimuth, or distance; imported as vertical only.`,
      raw,
    });
  }
};

