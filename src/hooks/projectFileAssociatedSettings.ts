import {
  cloneAdjustedPointsExportSettings,
} from '../engine/adjustedPointsExport';
import { CRS_CATALOG, DEFAULT_CANADA_CRS_ID } from '../engine/crsCatalog';
import type { ParsedProjectPayload } from '../engine/projectFile';
import type { ParseSettings, SettingsState } from '../appStateTypes';
import type {
  AdjustedPointsExportSettings,
  CustomLevelLoopTolerancePreset,
  InstrumentLibrary,
  ProjectExportFormat,
} from '../types';

export interface PreparedAssociatedProjectSettingsImport {
  sourceName: string;
  payload: ParsedProjectPayload;
  appliedDomains: string[];
  ignoredDomains: string[];
}

export const getImportedProjectSourceName = (fileName: string): string => {
  const trimmed = fileName.trim();
  if (!trimmed) return 'file';
  if (/\.dat$/i.test(trimmed)) {
    const stem = trimmed.replace(/\.dat$/i, '').trim();
    return stem || 'file';
  }
  return trimmed;
};

export const buildImportedReviewFileName = (sourceName: string): string => {
  const trimmed = sourceName.trim();
  if (!trimmed) return 'imported.dat';
  if (/\.[^.]+$/.test(trimmed)) return trimmed.replace(/\.[^.]+$/, '.dat');
  return `${trimmed}.dat`;
};

const parseSnprojSections = (rawText: string): Map<string, Map<string, string>> => {
  const sections = new Map<string, Map<string, string>>();
  let currentSection = '';
  rawText.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const sectionMatch = line.match(/^\[(.+)\]$/);
    if (sectionMatch) {
      currentSection = sectionMatch[1]!.trim().toUpperCase();
      if (!sections.has(currentSection)) sections.set(currentSection, new Map());
      return;
    }
    const pairMatch = line.match(/^([A-Za-z0-9_./-]+)\s*(?:=|\s)\s*(.+)$/);
    if (!pairMatch || !currentSection) return;
    sections.get(currentSection)?.set(pairMatch[1]!.trim().toUpperCase(), pairMatch[2]!.trim());
  });
  return sections;
};

const parseSnprojNumber = (value: string | undefined): number | undefined => {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value);
  return Number.isFinite(numeric) ? numeric : undefined;
};

const parseSnprojBoolean = (value: string | undefined): boolean | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim().toUpperCase();
  if (trimmed === '1' || trimmed === 'Y' || trimmed === 'YES' || trimmed === 'TRUE') return true;
  if (trimmed === '0' || trimmed === 'N' || trimmed === 'NO' || trimmed === 'FALSE') return false;
  return undefined;
};

const normalizeCrsLookupToken = (value: string): string =>
  value.toUpperCase().replace(/[^A-Z0-9]/g, '');

const resolveSnprojCrsId = (rawName: string | undefined): string | undefined => {
  const token = rawName?.trim();
  if (!token) return undefined;
  const normalized = normalizeCrsLookupToken(token);
  const utmMatch = normalized.match(/UTM(?:83)?CSRS?(\d{1,2})N/);
  if (utmMatch) return `CA_NAD83_CSRS_UTM_${utmMatch[1]!.padStart(2, '0')}N`;
  const mtmMatch = normalized.match(/MTM(\d{1,2})/);
  if (mtmMatch) return `CA_NAD83_CSRS_MTM_${mtmMatch[1]!.padStart(2, '0')}`;
  const matched = CRS_CATALOG.find((row) => {
    const idToken = normalizeCrsLookupToken(row.id);
    const labelToken = normalizeCrsLookupToken(row.label);
    return normalized === idToken || normalized === labelToken || normalized.includes(idToken);
  });
  return matched?.id;
};

export const buildSnprojAssociatedSettingsPayload = ({
  rawText,
  sourceName,
  settings,
  parseSettings,
  exportFormat: _exportFormat,
  adjustedPointsExportSettings,
  projectInstruments,
  selectedInstrument,
  levelLoopCustomPresets,
}: {
  rawText: string;
  sourceName: string;
  settings: SettingsState;
  parseSettings: ParseSettings;
  exportFormat: ProjectExportFormat;
  adjustedPointsExportSettings: AdjustedPointsExportSettings;
  projectInstruments: InstrumentLibrary;
  selectedInstrument: string;
  levelLoopCustomPresets: CustomLevelLoopTolerancePreset[];
}): PreparedAssociatedProjectSettingsImport => {
  const sections = parseSnprojSections(rawText);
  const adjustment = sections.get('ADJUSTMENT') ?? new Map<string, string>();
  const listing = sections.get('LISTING') ?? new Map<string, string>();
  const instrument = sections.get('INSTRUMENT') ?? new Map<string, string>();

  const nextSettings: SettingsState = {
    ...settings,
    convergenceLimit:
      parseSnprojNumber(adjustment.get('CONVERGE_LIMIT')) ?? settings.convergenceLimit,
    maxIterations:
      parseSnprojNumber(adjustment.get('MAXIMUM_ITERATIONS')) ?? settings.maxIterations,
    listingShowCoordinates:
      parseSnprojBoolean(listing.get('LIST_COORDINATES')) ?? settings.listingShowCoordinates,
    listingShowObservationsResiduals:
      parseSnprojBoolean(listing.get('LIST_ADJ_OBS_RESIDUALS')) ??
      settings.listingShowObservationsResiduals,
    listingShowErrorPropagation:
      parseSnprojBoolean(listing.get('LIST_STANDARD_DEVIATIONS')) ??
      settings.listingShowErrorPropagation,
    listingShowAzimuthsBearings:
      parseSnprojBoolean(listing.get('LIST_BEARING')) ?? settings.listingShowAzimuthsBearings,
  };

  const nextParseSettings: ParseSettings = {
    ...parseSettings,
    runMode:
      rawText.toUpperCase().includes('STAR*NET RUN MODE                   : PREANALYSIS') ||
      adjustment.get('RUN_MODE')?.trim().toUpperCase() === 'PREANALYSIS' ||
      adjustment.get('ADJUSTMENT_RUN_MODE')?.trim().toUpperCase() === 'PREANALYSIS'
        ? 'preanalysis'
        : parseSettings.runMode,
    preanalysisMode:
      rawText.toUpperCase().includes('STAR*NET RUN MODE                   : PREANALYSIS') ||
      adjustment.get('RUN_MODE')?.trim().toUpperCase() === 'PREANALYSIS' ||
      adjustment.get('ADJUSTMENT_RUN_MODE')?.trim().toUpperCase() === 'PREANALYSIS'
        ? true
        : parseSettings.preanalysisMode,
    coordMode:
      adjustment.get('ADJUSTMENT_TYPE')?.trim().toUpperCase() === '2D'
        ? '2D'
        : adjustment.get('ADJUSTMENT_TYPE')?.trim().toUpperCase() === '3D'
          ? '3D'
          : parseSettings.coordMode,
    coordSystemMode:
      resolveSnprojCrsId(adjustment.get('COORDINATE_SYSTEM_NAME')) != null ||
      adjustment.get('LOCAL_OR_GRID_ADJUSTMENT')?.trim() === '1'
        ? 'grid'
        : adjustment.get('LOCAL_OR_GRID_ADJUSTMENT')?.trim() === '0'
          ? 'local'
          : parseSettings.coordSystemMode,
    crsId:
      resolveSnprojCrsId(adjustment.get('COORDINATE_SYSTEM_NAME')) ??
      parseSettings.crsId ??
      DEFAULT_CANADA_CRS_ID,
    order:
      adjustment.get('COORDINATE_ORDER')?.trim().toUpperCase() === 'NE'
        ? 'NE'
        : adjustment.get('COORDINATE_ORDER')?.trim().toUpperCase() === 'EN'
          ? 'EN'
          : parseSettings.order,
    deltaMode:
      adjustment.get('3D_INPUT_MODE')?.trim().toUpperCase().includes('SLOPE')
        ? 'slope'
        : adjustment.get('3D_INPUT_MODE')?.trim()
              .toUpperCase()
              .includes('HORIZONTAL')
          ? 'horiz'
          : parseSettings.deltaMode,
    applyCurvatureRefraction:
      parseSnprojNumber(adjustment.get('INDEX_OF_REFRACTION')) != null
        ? true
        : parseSettings.applyCurvatureRefraction,
    refractionCoefficient:
      parseSnprojNumber(adjustment.get('INDEX_OF_REFRACTION')) ??
      parseSettings.refractionCoefficient,
    verticalReduction:
      adjustment.get('ADJUSTMENT_TYPE')?.trim().toUpperCase() === '3D' &&
      adjustment.get('3D_INPUT_MODE')?.trim().toUpperCase().includes('ZENITH') &&
      parseSnprojNumber(adjustment.get('INDEX_OF_REFRACTION')) != null
        ? 'curvref'
        : parseSettings.verticalReduction,
    qFixLinearSigmaM:
      parseSnprojNumber(adjustment.get('FIXED_LINEAR_STD_ERR')) ??
      parseSettings.qFixLinearSigmaM,
    qFixAngularSigmaSec:
      parseSnprojNumber(adjustment.get('FIXED_ANGULAR_STD_ERR')) ??
      parseSettings.qFixAngularSigmaSec,
    averageGeoidHeight:
      parseSnprojNumber(adjustment.get('GEOID_HEIGHT')) ?? parseSettings.averageGeoidHeight,
    verticalDeflectionNorthSec:
      parseSnprojNumber(adjustment.get('VERT_DEFL_NORTH')) ??
      parseSettings.verticalDeflectionNorthSec,
    verticalDeflectionEastSec:
      parseSnprojNumber(adjustment.get('VERT_DEFL_EAST')) ??
      parseSettings.verticalDeflectionEastSec,
  };

  const importedInstrumentCode = 'IMPORTED';
  const importedInstrument = {
    ...(projectInstruments[selectedInstrument] ?? projectInstruments[importedInstrumentCode] ?? {
      code: importedInstrumentCode,
      desc: 'Imported project instrument',
      edm_const: 0,
      edm_ppm: 0,
      hzPrecision_sec: 0,
      dirPrecision_sec: 0,
      azBearingPrecision_sec: 0,
      vaPrecision_sec: 0,
      instCentr_m: 0,
      tgtCentr_m: 0,
      vertCentr_m: 0,
      elevDiff_const_m: 0,
      elevDiff_ppm: 0,
      gpsStd_xy: 0,
      levStd_mmPerKm: 0,
    }),
    code: importedInstrumentCode,
    desc: `Imported project instrument (${sourceName})`,
    edm_const: parseSnprojNumber(instrument.get('DISTANCE_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.edm_const ?? 0),
    edm_ppm:
      parseSnprojNumber(instrument.get('EDM_PPM')) ??
      (projectInstruments[selectedInstrument]?.edm_ppm ?? 0),
    hzPrecision_sec:
      parseSnprojNumber(instrument.get('ANGLE_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.hzPrecision_sec ?? 0),
    dirPrecision_sec:
      parseSnprojNumber(instrument.get('DIRECTION_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.dirPrecision_sec ?? 0),
    azBearingPrecision_sec:
      parseSnprojNumber(instrument.get('AZIMUTH_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.azBearingPrecision_sec ?? 0),
    vaPrecision_sec:
      parseSnprojNumber(instrument.get('ZENITH_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.vaPrecision_sec ?? 0),
    instCentr_m:
      parseSnprojNumber(instrument.get('INSTRUMENT_CENTERING_ERROR')) ??
      (projectInstruments[selectedInstrument]?.instCentr_m ?? 0),
    tgtCentr_m:
      parseSnprojNumber(instrument.get('TARGET_CENTERING_ERROR')) ??
      (projectInstruments[selectedInstrument]?.tgtCentr_m ?? 0),
    vertCentr_m:
      parseSnprojNumber(instrument.get('VERTICAL_CENTERING_ERROR')) ??
      (projectInstruments[selectedInstrument]?.vertCentr_m ?? 0),
    elevDiff_const_m:
      parseSnprojNumber(instrument.get('DELTA_ELEV_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.elevDiff_const_m ?? 0),
    elevDiff_ppm:
      parseSnprojNumber(instrument.get('DELTA_ELEV_PPM')) ??
      (projectInstruments[selectedInstrument]?.elevDiff_ppm ?? 0),
    levStd_mmPerKm:
      parseSnprojNumber(instrument.get('LEVEL_STD_ERR')) ??
      (projectInstruments[selectedInstrument]?.levStd_mmPerKm ?? 0),
  };

  return {
    sourceName,
    payload: {
      schemaVersion: 5,
      input: '',
      includeFiles: {},
      savedRuns: [],
      ui: {
        settings: nextSettings as unknown as Record<string, unknown>,
        parseSettings: nextParseSettings as unknown as Record<string, unknown>,
        exportFormat: 'industry-style',
        adjustedPointsExport: cloneAdjustedPointsExportSettings(adjustedPointsExportSettings),
      },
      project: {
        projectInstruments: {
          ...projectInstruments,
          [importedInstrumentCode]: importedInstrument,
        },
        selectedInstrument: importedInstrumentCode,
        levelLoopCustomPresets: levelLoopCustomPresets.map((preset) => ({ ...preset })),
      },
    },
    appliedDomains: [
      'project settings',
      'parse settings',
      'industry listing options',
      'instrument defaults',
    ],
    ignoredDomains: ['data file list', 'plot settings', 'unsupported industry-only options'],
  };
};
