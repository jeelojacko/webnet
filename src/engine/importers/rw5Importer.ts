import type {
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  appendImportedObservationBundle,
  buildTraceDetailLine,
  choosePreferredStation,
  plural,
  sanitizeStationId,
  sourceLeaf,
} from './shared';
import {
  buildLocalStationFromRw5,
  detectCarlsonRw5,
  detectTdsRaw,
  parseRw5Line,
  parseRw5AngleToken,
  pickRw5Field,
  pickRw5NumberField,
  resolveRw5ShotOrientation,
  resolveRw5VerticalPayload,
  RW5_RECORD_CODES,
  type Rw5Context,
} from './rw5ImporterHelpers';

export { detectCarlsonRw5, detectTdsRaw } from './rw5ImporterHelpers';

export const parseRw5Dataset = (
  input: string,
  sourceName: string | undefined,
  flavor: 'carlson' | 'tds',
): ImportedDataset | null => {
  const detect = flavor === 'carlson' ? detectCarlsonRw5 : detectTdsRaw;
  if (!detect(input, sourceName)) return null;

  const trace: ImportedTraceEntry[] = [];
  const controlStations = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  const context: Rw5Context = {};

  input.split(/\r?\n/).forEach((line, index) => {
    const sourceLine = index + 1;
    const parsed = parseRw5Line(line);
    if (!parsed) return;

    const { code, fields, raw } = parsed;
    if (!RW5_RECORD_CODES.has(code)) {
      trace.push({
        level: 'warning',
        sourceLine,
        sourceCode: code,
        message: 'Unsupported Carlson/TDS record type was not converted.',
        raw,
      });
      return;
    }

    const localStation = buildLocalStationFromRw5(code, fields, sourceLine);
    if (localStation) {
      const existing = controlStations.get(localStation.stationId);
      controlStations.set(localStation.stationId, choosePreferredStation(existing, localStation));
    }

    if (code === 'JB' || code === 'MO') return;

    if (code === 'OC') {
      const rawPointId = pickRw5Field(fields, ['OP', 'PN', 'POINT', 'NAME']);
      if (!rawPointId) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Occupy record missing station identifier.',
          raw,
        });
        return;
      }
      context.occupyId = sanitizeStationId(rawPointId);
      context.hiM = pickRw5NumberField(fields, ['HI', 'IH']) ?? context.hiM;
      context.backsightId = undefined;
      context.backsightAzimuthDeg = undefined;
      context.setCircleDeg = undefined;
      return;
    }

    if (code === 'BK') {
      const backsightPoint = pickRw5Field(fields, ['BP', 'BSPOINT', 'PN']);
      const backsightAzimuth = parseRw5AngleToken(pickRw5Field(fields, ['BS', 'AZ']));
      context.backsightId = backsightPoint ? sanitizeStationId(backsightPoint) : undefined;
      context.backsightAzimuthDeg = backsightAzimuth;
      context.setCircleDeg = parseRw5AngleToken(pickRw5Field(fields, ['BC', 'SC'])) ?? 0;
      return;
    }

    if (code === 'LS') {
      context.hiM = pickRw5NumberField(fields, ['HI', 'IH']) ?? context.hiM;
      context.htM = pickRw5NumberField(fields, ['HR', 'HT', 'RH']) ?? context.htM;
      return;
    }

    if (code === 'SP' || code === 'PT') {
      if (!localStation) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Point record missing East/North coordinates and was skipped.',
          raw,
        });
      }
      return;
    }

    if (
      code === 'SS' ||
      code === 'TR' ||
      code === 'FR' ||
      code === 'FS' ||
      code === 'FD' ||
      code === 'BD' ||
      code === 'BR' ||
      code === 'CL' ||
      code === 'AB'
    ) {
      const occupyId =
        context.occupyId ??
        (pickRw5Field(fields, ['OP', 'FROM', 'AT'])
          ? sanitizeStationId(pickRw5Field(fields, ['OP', 'FROM', 'AT'])!)
          : undefined);
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

      const targetRaw = pickRw5Field(fields, ['FP', 'PN', 'POINT', 'TO', 'TARGET', 'POS1']);
      if (!targetRaw) {
        trace.push({
          level: 'error',
          sourceLine,
          sourceCode: code,
          message: 'Shot record missing target point identifier.',
          raw,
        });
        return;
      }

      const targetId = sanitizeStationId(targetRaw);
      const distanceM = pickRw5NumberField(fields, ['SD', 'DIST', 'DISTANCE', 'SLOPE', 'HD']);
      const distanceMode =
        pickRw5Field(fields, ['SD', 'DIST', 'DISTANCE', 'SLOPE']) != null
          ? 'slope'
          : pickRw5Field(fields, ['HD']) != null
            ? 'horizontal'
            : undefined;
      const htM = pickRw5NumberField(fields, ['HR', 'HT', 'RH']) ?? context.htM;
      const { angleDeg, bearingDeg } = resolveRw5ShotOrientation(context, fields);
      const { verticalMode, verticalValue } = resolveRw5VerticalPayload(fields);

      appendImportedObservationBundle({
        observations,
        trace,
        sourceLine,
        sourceCode: code,
        occupyId,
        targetId,
        backsightId: context.backsightId,
        angleDeg,
        bearingDeg,
        distanceM,
        distanceMode,
        verticalMode,
        verticalValue,
        hiM: context.hiM,
        htM,
        raw,
        tracePrefix: 'Shot',
      });
      return;
    }

    trace.push({
      level: 'warning',
      sourceLine,
      sourceCode: code,
      message: 'Supported Carlson/TDS record was recognized but not yet converted.',
      raw,
    });
  });

  const stations = [...controlStations.values()];
  if (stations.length === 0 && observations.length === 0) return null;

  const formatLabel = flavor === 'carlson' ? 'Carlson RW5 field data' : 'TDS raw field data';
  const title = flavor === 'carlson' ? 'Imported Carlson dataset' : 'Imported TDS dataset';
  const traceDetail = buildTraceDetailLine(trace);
  const detailLines = [
    `Imported ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: flavor === 'carlson' ? 'carlson-rw5' : 'tds-raw',
    formatLabel,
    summary: `Imported ${flavor === 'carlson' ? 'Carlson' : 'TDS'} dataset with ${plural(stations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title,
      detailLines,
    },
    comments: [
      `Imported from ${flavor === 'carlson' ? 'Carlson RW5' : 'TDS raw'} data`,
      `Source file: ${fileLabel}`,
      `Imported points: ${stations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations: stations,
    observations,
    trace,
  };
};

export const carlsonImporter: ExternalInputImporter = {
  id: 'carlson-rw5',
  formatLabel: 'Carlson RW5 field data',
  detect: (input, sourceName) => detectCarlsonRw5(input, sourceName),
  parse: (input, sourceName) => parseRw5Dataset(input, sourceName, 'carlson'),
};

export const tdsImporter: ExternalInputImporter = {
  id: 'tds-raw',
  formatLabel: 'TDS raw field data',
  detect: (input, sourceName) => detectTdsRaw(input, sourceName),
  parse: (input, sourceName) => parseRw5Dataset(input, sourceName, 'tds'),
};
