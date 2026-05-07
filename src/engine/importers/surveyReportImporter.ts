import type {
  ExternalImportParseOptions,
  ExternalInputImporter,
  ImportedControlStationRecord,
  ImportedDataset,
  ImportedObservationRecord,
  ImportedTraceEntry,
} from '../importers';
import {
  appendImportedObservationBundle,
  buildLineNumberResolver,
  buildTraceDetailLine,
  choosePreferredStation,
  extractHtmlTables,
  parseDmsAngleDegrees,
  plural,
  sanitizeStationId,
  sourceLeaf,
  tableRowPairsToMap,
} from '../importers';

interface SurveyReportSetupContext {
  occupyId?: string;
  backsightId?: string;
  hiM?: number;
  setupType?: string;
}

const parseSurveyReportLinear = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const match = value.replace(/,/g, '').match(/[+-]?\d+(?:\.\d+)?/);
  return match ? Number.parseFloat(match[0]) : undefined;
};

export const detectTrimbleSurveyReport = (input: string, sourceName?: string): boolean => {
  const fileName = sourceName?.toLowerCase() ?? '';
  const looksLikeHtml =
    fileName.endsWith('.htm') || fileName.endsWith('.html') || /<html\b/i.test(input);
  if (!looksLikeHtml) return false;
  return (
    /<title>\s*Survey Report\s*<\/title>/i.test(input) &&
    /Collected Field Data/i.test(input) &&
    /Station setup/i.test(input) &&
    /Orientation/i.test(input) &&
    /<th\b[^>]*>\s*HA\s*<\/th>/i.test(input) &&
    /<th\b[^>]*>\s*VA\s*<\/th>/i.test(input) &&
    /<th\b[^>]*>\s*SD\s*<\/th>/i.test(input)
  );
};

export const parseTrimbleSurveyReport = (
  input: string,
  sourceName?: string,
  _options?: ExternalImportParseOptions,
): ImportedDataset | null => {
  if (!detectTrimbleSurveyReport(input, sourceName)) return null;

  const resolveSourceLine = buildLineNumberResolver(input);
  const trace: ImportedTraceEntry[] = [];
  const stationMap = new Map<string, ImportedControlStationRecord>();
  const observations: ImportedObservationRecord[] = [];
  const fileLabel = sourceLeaf(sourceName);
  const tables = extractHtmlTables(input);
  let currentSetup: SurveyReportSetupContext = {};

  tables.forEach((table) => {
    if (table.rows.length === 0) return;
    const sourceLine = resolveSourceLine(table.index);

    if (table.caption === 'Station setup') {
      const values = tableRowPairsToMap(table.rows[0] ?? []);
      const rawStation = values['Station'];
      if (rawStation) {
        currentSetup = {
          occupyId: sanitizeStationId(rawStation),
          hiM: parseSurveyReportLinear(values['Instrument height']),
          setupType: values['Station type'] || undefined,
          backsightId: currentSetup.backsightId,
        };
      }
      return;
    }

    if (table.caption === 'Orientation') {
      const values = tableRowPairsToMap(table.rows[0] ?? []);
      const rawStation = values['Station'];
      const rawBacksight = values['Backsight point'];
      if (rawStation) currentSetup.occupyId = sanitizeStationId(rawStation);
      currentSetup.backsightId = rawBacksight ? sanitizeStationId(rawBacksight) : undefined;
      return;
    }

    const firstRow = table.rows[0] ?? [];
    const firstRowMap = tableRowPairsToMap(firstRow);
    const firstLabels = new Set(firstRow.filter((_, index) => index % 2 === 0));

    if (firstLabels.has('Point') && firstLabels.has('North') && firstLabels.has('East')) {
      const stationId = sanitizeStationId(firstRowMap['Point']);
      const northM = parseSurveyReportLinear(firstRowMap['North']);
      const eastM = parseSurveyReportLinear(firstRowMap['East']);
      if (!stationId || northM == null || eastM == null) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'Point',
          message:
            'Survey report point table was skipped because Point/North/East could not be resolved.',
        });
        return;
      }
      const candidate: ImportedControlStationRecord = {
        kind: 'control-station',
        coordinateMode: 'local',
        stationId,
        northM,
        eastM,
        heightM: parseSurveyReportLinear(firstRowMap['Elevation']) ?? 0,
        description: firstRowMap['Code'] || undefined,
        sourceLine,
        sourceCode: 'Point',
      };
      stationMap.set(stationId, choosePreferredStation(stationMap.get(stationId), candidate));
      return;
    }

    const pointLabel = firstRow.find((cell) => /^Point(?:\s*\(B\.S\.\))?$/i.test(cell));
    if (pointLabel && firstLabels.has('HA') && firstLabels.has('VA') && firstLabels.has('SD')) {
      const targetRaw = firstRow[1];
      if (!currentSetup.occupyId || !targetRaw) {
        trace.push({
          level: 'warning',
          sourceLine,
          sourceCode: 'Shot',
          message: 'Survey report shot was skipped because no active station setup was available.',
        });
        return;
      }

      const stdErrorRow = table.rows[1] ?? [];
      const thirdRow = table.rows[2] ?? [];
      const values = tableRowPairsToMap(firstRow);
      const thirdValues = tableRowPairsToMap(thirdRow);
      const targetId = sanitizeStationId(targetRaw);
      const angleDeg = parseDmsAngleDegrees(values['HA'] ?? '');
      const distanceM = parseSurveyReportLinear(values['SD']);
      const zenithDeg = parseDmsAngleDegrees(values['VA'] ?? '');
      const htM = parseSurveyReportLinear(thirdValues['Target height']);
      const classification =
        /B\.S\./i.test(pointLabel) || targetId === currentSetup.backsightId
          ? 'BackSight'
          : undefined;
      const raw = [firstRow.join(' | '), stdErrorRow.join(' | '), thirdRow.join(' | ')].join(
        ' || ',
      );

      appendImportedObservationBundle({
        observations,
        trace,
        sourceLine,
        sourceCode: 'Shot',
        occupyId: currentSetup.occupyId,
        targetId,
        backsightId: currentSetup.backsightId,
        angleDeg,
        distanceM,
        distanceMode: distanceM != null ? 'slope' : undefined,
        verticalMode: zenithDeg != null ? 'zenith' : undefined,
        verticalValue: zenithDeg,
        hiM: currentSetup.hiM,
        htM,
        raw,
        tracePrefix: 'Survey report shot',
        sourceMeta: {
          classification,
          setupType: currentSetup.setupType,
        },
      });
    }
  });

  const controlStations = [...stationMap.values()];
  if (controlStations.length === 0 && observations.length === 0) return null;
  const detailLines = [
    `Imported ${plural(controlStations.length, 'point')} and ${plural(observations.length, 'observation')} from ${fileLabel} into normalized WebNet input.`,
  ];
  const traceDetail = buildTraceDetailLine(trace);
  if (traceDetail) detailLines.push(traceDetail);

  return {
    importerId: 'trimble-survey-report',
    formatLabel: 'Trimble survey report',
    summary: `Imported survey report with ${plural(controlStations.length, 'point')} and ${plural(observations.length, 'observation')}`,
    notice: {
      title: 'Imported survey report dataset',
      detailLines,
    },
    comments: [
      'Imported from Trimble survey report HTML',
      `Source file: ${fileLabel}`,
      `Imported points: ${controlStations.length}`,
      `Imported observations: ${observations.length}`,
    ],
    controlStations,
    observations,
    trace,
  };
};

export const trimbleSurveyReportImporter: ExternalInputImporter = {
  id: 'trimble-survey-report',
  formatLabel: 'Trimble survey report',
  detect: (input, sourceName) => detectTrimbleSurveyReport(input, sourceName),
  parse: (input, sourceName, options) => parseTrimbleSurveyReport(input, sourceName, options),
};
