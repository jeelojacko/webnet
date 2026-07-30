import { expect } from 'vitest';
import { LSAEngine } from '../../src/engine/adjust';
import { INDUSTRY_PARITY_CASES } from '../../src/industryParityCases';
import { extractSection, normalizeLineEndings } from './industryMultiCaseParityTextSupport';

export const parseMeasuredDirectionSection = (
  section: string,
): Array<
  | { kind: 'set'; label: string }
  | {
      kind: 'row';
      from: string;
      to: string;
      directionDms: string;
      stdErrSec: number;
      tt: number;
    }
> =>
  normalizeLineEndings(section)
    .split('\n')
    .slice(2)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .reduce<
      Array<
        | { kind: 'set'; label: string }
        | {
            kind: 'row';
            from: string;
            to: string;
            directionDms: string;
            stdErrSec: number;
            tt: number;
          }
      >
    >((entries, line) => {
      if (line.startsWith('Set ')) {
        entries.push({ kind: 'set', label: line });
        return entries;
      }
      const parts = line.split(/\s+/);
      if (
        parts.length !== 5 ||
        !/^\S+\s+\S+\s+\d{1,3}-\d{2}-\d{2}(?:\.\d+)?\s+-?\d+\.\d+\s+-?\d+\.\d+$/.test(line)
      ) {
        return entries;
      }
      entries.push({
        kind: 'row',
        from: parts[0],
        to: parts[1],
        directionDms: parts[2],
        stdErrSec: Number.parseFloat(parts[3]),
        tt: Number.parseFloat(parts[4]),
      });
      return entries;
    }, []);

export const collectMeasuredDirectionRows = (
  text: string,
  startSubstring: string,
  rowCount: number,
): Array<{
  from: string;
  to: string;
  directionDms: string;
  stdErrSec: number;
  tt: number;
}> => {
  const lines = normalizeLineEndings(text).split('\n');
  const startIndex = lines.findIndex((line) => line.includes(startSubstring));
  expect(startIndex).toBeGreaterThanOrEqual(0);
  const rows: Array<{
    from: string;
    to: string;
    directionDms: string;
    stdErrSec: number;
    tt: number;
  }> = [];
  for (let index = startIndex + 1; index < lines.length && rows.length < rowCount; index += 1) {
    const line = lines[index]?.trim() ?? '';
    if (
      /^\S+\s+\S+\s+\d{1,3}-\d{2}-\d{2}(?:\.\d+)?\s+-?\d+\.\d+\s+-?\d+\.\d+$/.test(line)
    ) {
      const parts = line.split(/\s+/);
      rows.push({
        from: parts[0],
        to: parts[1],
        directionDms: parts[2],
        stdErrSec: Number.parseFloat(parts[3]),
        tt: Number.parseFloat(parts[4]),
      });
    }
  }
  expect(rows).toHaveLength(rowCount);
  return rows;
};

export const extractGeodeticRows = (
  text: string,
  startMarker: string,
  endMarker: string,
): Map<string, { latitudeDms: string; longitudeDms: string; height: number }> => {
  const section = extractSection(text, startMarker, endMarker);
  const rows = new Map<string, { latitudeDms: string; longitudeDms: string; height: number }>();
  normalizeLineEndings(section)
    .split('\n')
    .slice(4)
    .forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) return;
      const stationId = parts[0];
      const latitudeDms = parts[1];
      const longitudeDms = parts[2];
      const height = Number.parseFloat(parts[3]);
      if (
        !stationId ||
        !latitudeDms.includes('-') ||
        !longitudeDms.includes('-') ||
        !Number.isFinite(height)
      ) {
        return;
      }
      rows.set(stationId, { latitudeDms, longitudeDms, height });
    });
  return rows;
};

export const extractCoordinateRows = (
  text: string,
  startMarker: string,
  endMarker: string,
): Map<string, { northing: number; easting: number; elevation: number }> => {
  const section = extractSection(text, startMarker, endMarker);
  const rows = new Map<string, { northing: number; easting: number; elevation: number }>();
  normalizeLineEndings(section)
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      const stationMatch = trimmed.match(/^([A-Za-z0-9_-]+)/);
      if (!stationMatch) return;
      const numericTokens = trimmed.match(/-?\d+\.\d+/g);
      if (!numericTokens || numericTokens.length < 3) return;
      rows.set(stationMatch[1], {
        northing: Number.parseFloat(numericTokens[0]),
        easting: Number.parseFloat(numericTokens[1]),
        elevation: Number.parseFloat(numericTokens[2]),
      });
    });
  return rows;
};

export const extractAdjustedGpsVectorRows = (
  text: string,
  startMarker: string,
  endMarker: string,
): Map<
  string,
  {
    from: string;
    to: string;
    dN?: { value: number; residual: number; stdErr: number };
    dE?: { value: number; residual: number; stdErr: number };
    dU?: { value: number; residual: number; stdErr: number };
    length?: number;
  }
> => {
  const section = extractSection(text, startMarker, endMarker);
  const rows = new Map<
    string,
    {
      from: string;
      to: string;
      dN?: { value: number; residual: number; stdErr: number };
      dE?: { value: number; residual: number; stdErr: number };
      dU?: { value: number; residual: number; stdErr: number };
      length?: number;
    }
  >();
  let currentLabel: string | null = null;
  normalizeLineEndings(section)
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      if (trimmed.startsWith('(') && trimmed.endsWith(')')) {
        currentLabel = trimmed.slice(1, -1);
        rows.set(currentLabel, { from: '', to: '' });
        return;
      }
      if (
        !currentLabel ||
        trimmed.startsWith('Adjusted GPS Vector Observations') ||
        trimmed.startsWith('From') ||
        trimmed === 'To' ||
        trimmed.startsWith('====')
      ) {
        return;
      }
      const parts = trimmed.split(/\s+/);
      const entry = rows.get(currentLabel);
      if (!entry) return;
      const residualIndex = parts.length >= 5 ? parts.length - 3 : -1;
      const hasResidualTriple = residualIndex >= 2 && Number.isFinite(Number.parseFloat(parts[residualIndex]));
      if (trimmed.startsWith('Length')) {
        entry.length = Number.parseFloat(parts[1]);
        return;
      }
      if (parts[1] === 'Delta-N' && hasResidualTriple) {
        entry.from = parts[0];
        entry.dN = {
          value: Number.parseFloat(parts[2]),
          residual: Number.parseFloat(parts[3]),
          stdErr: Number.parseFloat(parts[4]),
        };
        return;
      }
      if (parts[1] === 'Delta-E' && hasResidualTriple) {
        entry.to = parts[0];
        entry.dE = {
          value: Number.parseFloat(parts[2]),
          residual: Number.parseFloat(parts[3]),
          stdErr: Number.parseFloat(parts[4]),
        };
        return;
      }
      if (parts[0] === 'Delta-U' && hasResidualTriple) {
        entry.dU = {
          value: Number.parseFloat(parts[1]),
          residual: Number.parseFloat(parts[2]),
          stdErr: Number.parseFloat(parts[3]),
        };
      }
    });
  return rows;
};

export const buildCaseResult = (
  caseId: keyof typeof INDUSTRY_PARITY_CASES,
  parseOptionOverrides: Record<string, unknown> = {},
) => {
  const startup = INDUSTRY_PARITY_CASES[caseId].startupDefaults;
  expect(startup).toBeDefined();

  return new LSAEngine({
    input: startup?.input ?? '',
    maxIterations: startup?.settingsPatch.maxIterations ?? 15,
    convergenceThreshold: startup?.settingsPatch.convergenceLimit ?? 0.001,
    instrumentLibrary: startup?.projectInstruments,
    parseOptions: {
      currentInstrument: startup?.selectedInstrument,
      sourceFile: startup?.projectRunFiles?.[0]?.name,
      projectRunFiles: startup?.projectRunFiles?.map((file) => ({
        ...file,
        content: startup?.input ?? '',
      })),
      runMode: startup?.parseSettingsPatch.runMode,
      preanalysisMode: startup?.parseSettingsPatch.preanalysisMode,
      coordSystemMode: startup?.parseSettingsPatch.coordSystemMode,
      crsId: startup?.parseSettingsPatch.crsId,
      coordMode: startup?.parseSettingsPatch.coordMode ?? '3D',
      order: startup?.parseSettingsPatch.order ?? 'EN',
      deltaMode: startup?.parseSettingsPatch.deltaMode ?? 'slope',
      angleStationOrder: startup?.parseSettingsPatch.angleStationOrder ?? 'atfromto',
      lonSign: startup?.parseSettingsPatch.lonSign ?? 'west-negative',
      levelWeight: startup?.parseSettingsPatch.levelWeight,
      applyCurvatureRefraction: startup?.parseSettingsPatch.applyCurvatureRefraction,
      verticalReduction: startup?.parseSettingsPatch.verticalReduction,
      refractionCoefficient: startup?.parseSettingsPatch.refractionCoefficient,
      verticalDeflectionNorthSec: startup?.parseSettingsPatch.verticalDeflectionNorthSec,
      verticalDeflectionEastSec: startup?.parseSettingsPatch.verticalDeflectionEastSec,
      ...parseOptionOverrides,
    },
  }).solve();
};

