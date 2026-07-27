import type {
  ImportedDistanceObservationRecord,
  ImportedDistanceVerticalObservationRecord,
  ImportedJobXmlExtras,
  ImportedObservationRecord,
  ImportedSourceMetadata,
  ImportedTraceEntry,
} from '../importers';

interface EmitJobXmlMeasurementObservationArgs {
  backsightId?: string;
  deltaHM?: number;
  derivedAngleDeg?: number;
  derivedBearingDeg?: number;
  distanceM?: number;
  fallbackTargetId?: string;
  hiM?: number;
  htM?: number;
  jobXml: ImportedJobXmlExtras;
  observations: ImportedObservationRecord[];
  observationDescription?: string;
  occupyId?: string;
  sourceLine: number;
  sourceMeta: ImportedSourceMetadata;
  targetId?: string;
  trace: ImportedTraceEntry[];
  zenithDeg?: number;
}

export const emitJobXmlMeasurementObservation = ({
  backsightId,
  deltaHM,
  derivedAngleDeg,
  derivedBearingDeg,
  distanceM,
  fallbackTargetId,
  hiM,
  htM,
  jobXml,
  observations,
  observationDescription,
  occupyId,
  sourceLine,
  sourceMeta,
  targetId,
  trace,
  zenithDeg,
}: EmitJobXmlMeasurementObservationArgs): boolean => {
  const hasVertical = zenithDeg != null || deltaHM != null;

  if (occupyId && backsightId && targetId && derivedAngleDeg != null) {
    if (distanceM != null) {
      observations.push({
        kind: 'measurement',
        atId: occupyId,
        fromId: backsightId,
        toId: targetId,
        angleDeg: derivedAngleDeg,
        distanceM,
        verticalMode: zenithDeg != null ? 'zenith' : deltaHM != null ? 'delta-h' : undefined,
        verticalValue: zenithDeg ?? deltaHM,
        hiM,
        htM,
        description: observationDescription,
        sourceLine,
        sourceCode: 'PointRecord',
        note: 'converted to M',
        sourceMeta,
        jobXml,
      });
    } else {
      observations.push({
        kind: 'angle',
        atId: occupyId,
        fromId: backsightId,
        toId: targetId,
        angleDeg: derivedAngleDeg,
        description: observationDescription,
        sourceLine,
        sourceCode: 'PointRecord',
        note: 'converted to A',
        sourceMeta,
        jobXml,
      });
      if (hasVertical) {
        observations.push({
          kind: 'vertical',
          fromId: occupyId,
          toId: targetId,
          verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
          verticalValue: zenithDeg ?? deltaHM ?? 0,
          hiM,
          htM,
          description: observationDescription,
          sourceLine,
          sourceCode: 'PointRecord',
          note: 'converted to V',
          sourceMeta,
          jobXml,
        });
      }
    }
    return true;
  }

  if (occupyId && targetId && derivedBearingDeg != null) {
    observations.push({
      kind: 'bearing',
      fromId: occupyId,
      toId: targetId,
      bearingDeg: derivedBearingDeg,
      description: observationDescription,
      sourceLine,
      sourceCode: 'PointRecord',
      note: 'converted to B',
      sourceMeta,
      jobXml,
    });
    if (distanceM != null && hasVertical) {
      observations.push({
        kind: 'distance-vertical',
        fromId: occupyId,
        toId: targetId,
        distanceM,
        verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
        verticalValue: zenithDeg ?? deltaHM ?? 0,
        hiM,
        htM,
        description: observationDescription,
        sourceLine,
        sourceCode: 'PointRecord',
        note: 'converted to DV',
        sourceMeta,
        jobXml,
      });
    } else if (distanceM != null) {
      observations.push({
        kind: 'distance',
        fromId: occupyId,
        toId: targetId,
        distanceM,
        hiM,
        htM,
        description: observationDescription,
        sourceLine,
        sourceCode: 'PointRecord',
        note: 'converted to D',
        sourceMeta,
        jobXml,
      });
    } else if (hasVertical) {
      observations.push({
        kind: 'vertical',
        fromId: occupyId,
        toId: targetId,
        verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
        verticalValue: zenithDeg ?? deltaHM ?? 0,
        hiM,
        htM,
        description: observationDescription,
        sourceLine,
        sourceCode: 'PointRecord',
        note: 'converted to V',
        sourceMeta,
        jobXml,
      });
    }
    return true;
  }

  if (occupyId && targetId && distanceM != null) {
    observations.push({
      kind: hasVertical ? 'distance-vertical' : 'distance',
      fromId: occupyId,
      toId: targetId,
      distanceM,
      ...(hasVertical
        ? {
            verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
            verticalValue: zenithDeg ?? deltaHM ?? 0,
          }
        : {}),
      hiM,
      htM,
      description: observationDescription,
      sourceLine,
      sourceCode: 'PointRecord',
      note: hasVertical ? 'converted to DV' : 'converted to D',
      sourceMeta,
      jobXml,
    } as ImportedDistanceObservationRecord | ImportedDistanceVerticalObservationRecord);
    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: 'PointRecord',
      message: `JobXML measurement-style point ${targetId} had no usable angle or azimuth; imported as distance${hasVertical ? '/vertical' : ''} only.`,
    });
    return true;
  }

  trace.push({
    level: 'warning',
    sourceLine,
    sourceCode: 'PointRecord',
    message: `JobXML measurement-style point ${targetId ?? fallbackTargetId ?? 'UNKNOWN'} was not converted because the station, target, or direction context could not be resolved.`,
  });
  return true;
};
