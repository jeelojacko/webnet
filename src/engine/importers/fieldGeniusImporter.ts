import type {
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  buildTraceDetailLine,
  plural,
  sanitizeStationId,
  sourceLeaf,
} from './shared';
import {
  FIELDGENIUS_RECORD_CODES,
  buildLocalStationFromFieldGenius,
  detectFieldGeniusRaw,
  parseFieldGeniusLine,
  pickField,
  pickNumberField,
  upsertPreferredFieldGeniusStation,
} from './fieldGeniusParsing';
export { detectFieldGeniusRaw } from './fieldGeniusParsing';

export const parseFieldGenius = (input: string, sourceName?: string): ImportedDataset | null => {
  if (!detectFieldGeniusRaw(input, sourceName)) return null;

  const trace: ImportedTraceEntry[] = [];
  const controlStations = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  let occupyId: string | undefined;
  let backsightId: string | undefined;
  let hiM: number | undefined;

  input.split(/\r?\n/).forEach((line, index) => {
    const sourceLine = index + 1;
    const parsed = parseFieldGeniusLine(line);
    if (!parsed) return;

    const { code, fields, raw } = parsed;
    if (!FIELDGENIUS_RECORD_CODES.has(code)) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: 'Unsupported FieldGenius record type was not converted.',
        raw,
      });
      return;
    }

    const localStation = buildLocalStationFromFieldGenius(code, fields, sourceLine);
    if (localStation) {
      upsertPreferredFieldGeniusStation(controlStations, localStation);
    }

    if (code === 'OC' || code === 'LS' || code === 'STN') {
      const rawPointId = pickField(fields, ['PN', 'POINT', 'NAME', 'POS1']);
      if (!rawPointId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Setup record missing occupy point identifier.',
          raw,
        });
        return;
      }
      occupyId = sanitizeStationId(rawPointId);
      hiM = pickNumberField(fields, ['HI', 'IH', 'INSTHT']);
      if (hiM == null) hiM = pickNumberField(fields, ['POS2']);
      return;
    }

    if (code === 'BK' || code === 'BS') {
      const rawPointId = pickField(fields, ['PN', 'POINT', 'NAME', 'POS1']);
      if (!rawPointId) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: 'Backsight record missing backsight point identifier.',
          raw,
        });
        return;
      }
      backsightId = sanitizeStationId(rawPointId);
      return;
    }

    if (code === 'SP' || code === 'PT' || code === 'GS' || code === 'CV') {
      if (!localStation) {
        trace.push({
          level: code === 'GS' || code === 'CV' ? 'warning' : 'error',
          sourceLine,
          sourceCode: code,
          message: 'Point record missing East/North coordinates and was skipped.',
          raw,
        });
      }
      return;
    }

    if (code === 'SS' || code === 'TR' || code === 'FR' || code === 'FS') {
      if (!occupyId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record encountered before any occupy setup.',
          raw,
        });
        return;
      }

      const targetIdRaw = pickField(fields, ['PN', 'POINT', 'POINTID', 'NAME', 'TARGET', 'POS1']);
      if (!targetIdRaw) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record missing target point identifier.',
          raw,
        });
        return;
      }
      const targetId = sanitizeStationId(targetIdRaw);
      const htM = pickNumberField(fields, ['HT', 'RH', 'RODHT', 'TARGETHT']);
      const angleDeg = pickNumberField(fields, ['HA', 'HZ', 'HORANGLE', 'ANGLE', 'HR']);
      const azimuthDeg = pickNumberField(fields, ['AZ', 'AZI', 'AZIMUTH', 'BRG', 'BEARING']);
      const distanceM = pickNumberField(fields, ['SD', 'HD', 'DIST', 'DISTANCE', 'SLOPE']);
      const zenithDeg = pickNumberField(fields, ['VA', 'ZE', 'ZENITH', 'VZ']);
      const deltaHM = pickNumberField(fields, ['DH', 'DELTAH', 'VD']);

      if (angleDeg != null && backsightId && distanceM != null) {
        observations.push({
          kind: 'measurement',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg,
          distanceM,
          verticalMode: zenithDeg != null ? 'zenith' : deltaHM != null ? 'delta-h' : undefined,
          verticalValue: zenithDeg ?? deltaHM,
          hiM,
          htM,
          sourceLine,
          sourceCode: code,
          note: 'converted to M',
        });
        return;
      }

      if (angleDeg != null && backsightId) {
        observations.push({
          kind: 'angle',
          atId: occupyId,
          fromId: backsightId,
          toId: targetId,
          angleDeg,
          sourceLine,
          sourceCode: code,
          note: 'converted to A',
        });
        return;
      }

      if (azimuthDeg != null) {
        observations.push({
          kind: 'bearing',
          fromId: occupyId,
          toId: targetId,
          bearingDeg: azimuthDeg,
          sourceLine,
          sourceCode: code,
          note: 'converted to B',
        });
        if (distanceM != null && (zenithDeg != null || deltaHM != null)) {
          observations.push({
            kind: 'distance-vertical',
            fromId: occupyId,
            toId: targetId,
            distanceM,
            verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
            verticalValue: zenithDeg ?? deltaHM ?? 0,
            hiM,
            htM,
            sourceLine,
            sourceCode: code,
            note: 'converted to DV',
          });
        } else if (distanceM != null) {
          observations.push({
            kind: 'distance',
            fromId: occupyId,
            toId: targetId,
            distanceM,
            hiM,
            htM,
            sourceLine,
            sourceCode: code,
            note: 'converted to D',
          });
        }
        return;
      }

      if (distanceM != null && (zenithDeg != null || deltaHM != null)) {
        observations.push({
          kind: 'distance-vertical',
          fromId: occupyId,
          toId: targetId,
          distanceM,
          verticalMode: zenithDeg != null ? 'zenith' : 'delta-h',
          verticalValue: zenithDeg ?? deltaHM ?? 0,
          hiM,
          htM,
          sourceLine,
          sourceCode: code,
          note: 'converted to DV',
        });
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: `Shot ${targetId} had no usable angle or azimuth; imported as distance/vertical only.`,
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
          sourceCode: code,
          note: 'converted to D',
        });
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: code,
          message: `Shot ${targetId} had no usable angle or azimuth; imported as distance only.`,
        });
        return;
      }

      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: `Shot ${targetId} did not contain a supported observation payload.`,
        raw,
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: code,
      message: 'Supported FieldGenius record was recognized but not yet converted.',
      raw,
    });
  });

  const stations = [...controlStations.values()];
  if (stations.length === 0 && observations.length === 0) return null;

  const detailLines = [
    `Imported ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  const traceDetail = buildTraceDetailLine(trace);
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: 'fieldgenius-raw',
    formatLabel: 'FieldGenius raw field data',
    summary: `Imported FieldGenius dataset with ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title: 'Imported FieldGenius dataset',
      detailLines,
    },
    comments: [
      'Imported from FieldGenius raw data',
      `Source file: ${fileLabel}`,
      `Imported points: ${stations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations: stations,
    observations,
    trace,
  };
};

export const fieldGeniusImporter: ExternalInputImporter = {
  id: 'fieldgenius-raw',
  formatLabel: 'FieldGenius raw field data',
  detect: (input, sourceName) => detectFieldGeniusRaw(input, sourceName),
  parse: (input, sourceName) => parseFieldGenius(input, sourceName),
};
