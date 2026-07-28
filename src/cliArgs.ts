import process from 'node:process';

import {
  normalizeSolveProfile,
  parseFaceNormalizationModeArg,
  parseGeoidInterpolationArg,
  parseGeoidSourceFormatArg,
  parseGnssVectorFrameArg,
  parseParseModeArg,
  parseRunModeArg,
} from './cliArgValueParsers';
import { EXIT_OK, usageText } from './cliUsage';
import { normalizeCrsId } from './engine/crsCatalog';
import type { ParseOptions } from './types';

export type SolveProfile =
  | 'webnet'
  | 'industry-parity-current'
  | 'industry-parity-legacy'
  | 'legacy-compat'
  | 'industry-parity';
export type UnitsMode = 'm' | 'ft';
export type CoordMode = '2D' | '3D';
export type OutputFormat = 'summary' | 'json' | 'listing' | 'landxml';

export interface CliConfig {
  inputPath: string;
  profile: SolveProfile;
  maxIterations: number;
  outputFormat: OutputFormat;
  outputPath?: string;
  parseOptions: Partial<ParseOptions>;
}

export const parseArgs = (argv: string[]): CliConfig => {
  const config: CliConfig = {
    inputPath: '',
    profile: 'industry-parity',
    maxIterations: 10,
    outputFormat: 'summary',
    parseOptions: {},
  };
  let runModeExplicit = false;

  const nextValue = (index: number, flag: string): string => {
    const value = argv[index + 1];
    if (value == null || value.startsWith('-')) {
      throw new Error(`Missing value for ${flag}`);
    }
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      process.stdout.write(usageText);
      process.exit(EXIT_OK);
    }
    if (arg === '--input' || arg === '-i') {
      config.inputPath = nextValue(i, arg);
      i += 1;
      continue;
    }
    if (arg === '--profile') {
      const value = nextValue(i, arg);
      if (
        value !== 'webnet' &&
        value !== 'industry-parity-current' &&
        value !== 'industry-parity-legacy' &&
        value !== 'legacy-compat' &&
        value !== 'industry-parity'
      ) {
        throw new Error(`Invalid --profile value "${value}"`);
      }
      config.profile = value;
      i += 1;
      continue;
    }
    if (arg === '--max-iterations') {
      const value = Number.parseInt(nextValue(i, arg), 10);
      if (!Number.isFinite(value) || value < 1 || value > 1000) {
        throw new Error(`Invalid --max-iterations value "${argv[i + 1]}"`);
      }
      config.maxIterations = value;
      i += 1;
      continue;
    }
    if (arg === '--output') {
      const value = nextValue(i, arg);
      if (value !== 'summary' && value !== 'json' && value !== 'listing' && value !== 'landxml') {
        throw new Error(`Invalid --output value "${value}"`);
      }
      config.outputFormat = value as OutputFormat;
      i += 1;
      continue;
    }
    if (arg === '--out') {
      config.outputPath = nextValue(i, arg);
      i += 1;
      continue;
    }
    if (arg === '--units') {
      const value = nextValue(i, arg);
      if (value !== 'm' && value !== 'ft') {
        throw new Error(`Invalid --units value "${value}"`);
      }
      config.parseOptions.units = value as UnitsMode;
      i += 1;
      continue;
    }
    if (arg === '--preanalysis') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'on' && value !== 'off') {
        throw new Error(`Invalid --preanalysis value "${argv[i + 1]}"`);
      }
      config.parseOptions.preanalysisMode = value === 'on';
      if (!runModeExplicit) {
        config.parseOptions.runMode = value === 'on' ? 'preanalysis' : 'adjustment';
      }
      i += 1;
      continue;
    }
    if (arg === '--run-mode') {
      const value = parseRunModeArg(nextValue(i, arg));
      if (!value) {
        throw new Error(`Invalid --run-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.runMode = value;
      config.parseOptions.preanalysisMode = value === 'preanalysis';
      runModeExplicit = true;
      i += 1;
      continue;
    }
    if (arg === '--autoadjust') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'on' && value !== 'off') {
        throw new Error(`Invalid --autoadjust value "${argv[i + 1]}"`);
      }
      config.parseOptions.autoAdjustEnabled = value === 'on';
      i += 1;
      continue;
    }
    if (arg === '--autoadjust-threshold') {
      const value = Number.parseFloat(nextValue(i, arg));
      if (!Number.isFinite(value) || value < 1 || value > 20) {
        throw new Error(`Invalid --autoadjust-threshold value "${argv[i + 1]}"`);
      }
      config.parseOptions.autoAdjustStdResThreshold = value;
      i += 1;
      continue;
    }
    if (arg === '--autoadjust-cycles') {
      const value = Number.parseInt(nextValue(i, arg), 10);
      if (!Number.isFinite(value) || value < 1 || value > 20) {
        throw new Error(`Invalid --autoadjust-cycles value "${argv[i + 1]}"`);
      }
      config.parseOptions.autoAdjustMaxCycles = value;
      i += 1;
      continue;
    }
    if (arg === '--autoadjust-max-removals') {
      const value = Number.parseInt(nextValue(i, arg), 10);
      if (!Number.isFinite(value) || value < 1 || value > 20) {
        throw new Error(`Invalid --autoadjust-max-removals value "${argv[i + 1]}"`);
      }
      config.parseOptions.autoAdjustMaxRemovalsPerCycle = value;
      i += 1;
      continue;
    }
    if (arg === '--coord-mode') {
      const value = nextValue(i, arg).toUpperCase();
      if (value !== '2D' && value !== '3D') {
        throw new Error(`Invalid --coord-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.coordMode = value as CoordMode;
      i += 1;
      continue;
    }
    if (arg === '--parse-mode') {
      const value = parseParseModeArg(nextValue(i, arg));
      if (!value) {
        throw new Error(`Invalid --parse-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.parseCompatibilityMode = value;
      config.parseOptions.parseModeMigrated = value === 'strict';
      i += 1;
      continue;
    }
    if (arg === '--face-normalization') {
      const value = parseFaceNormalizationModeArg(nextValue(i, arg));
      if (!value) {
        throw new Error(`Invalid --face-normalization value "${argv[i + 1]}"`);
      }
      config.parseOptions.faceNormalizationMode = value;
      config.parseOptions.normalize = value !== 'off';
      i += 1;
      continue;
    }
    if (arg === '--coord-system-mode') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'local' && value !== 'grid') {
        throw new Error(`Invalid --coord-system-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.coordSystemMode = value;
      i += 1;
      continue;
    }
    if (arg === '--crs-id') {
      const value = nextValue(i, arg).trim();
      if (!value) throw new Error('Invalid --crs-id value');
      config.parseOptions.crsId = normalizeCrsId(value) ?? value.toUpperCase();
      i += 1;
      continue;
    }
    if (arg === '--local-datum-scheme') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'average-scale' && value !== 'common-elevation') {
        throw new Error(`Invalid --local-datum-scheme value "${argv[i + 1]}"`);
      }
      config.parseOptions.localDatumScheme = value;
      i += 1;
      continue;
    }
    if (arg === '--average-scale-factor') {
      const value = Number.parseFloat(nextValue(i, arg));
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(`Invalid --average-scale-factor value "${argv[i + 1]}"`);
      }
      config.parseOptions.averageScaleFactor = value;
      i += 1;
      continue;
    }
    if (arg === '--common-elevation') {
      const value = Number.parseFloat(nextValue(i, arg));
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid --common-elevation value "${argv[i + 1]}"`);
      }
      config.parseOptions.commonElevation = value;
      i += 1;
      continue;
    }
    if (arg === '--average-geoid-height') {
      const value = Number.parseFloat(nextValue(i, arg));
      if (!Number.isFinite(value)) {
        throw new Error(`Invalid --average-geoid-height value "${argv[i + 1]}"`);
      }
      config.parseOptions.averageGeoidHeight = value;
      i += 1;
      continue;
    }
    if (arg === '--grid-bearing-mode') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'measured' && value !== 'grid') {
        throw new Error(`Invalid --grid-bearing-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.gridBearingMode = value;
      i += 1;
      continue;
    }
    if (arg === '--grid-distance-mode') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'measured' && value !== 'grid' && value !== 'ellipsoidal') {
        throw new Error(`Invalid --grid-distance-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.gridDistanceMode = value;
      i += 1;
      continue;
    }
    if (arg === '--grid-angle-mode') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'measured' && value !== 'grid') {
        throw new Error(`Invalid --grid-angle-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.gridAngleMode = value;
      i += 1;
      continue;
    }
    if (arg === '--grid-direction-mode') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'measured' && value !== 'grid') {
        throw new Error(`Invalid --grid-direction-mode value "${argv[i + 1]}"`);
      }
      config.parseOptions.gridDirectionMode = value;
      i += 1;
      continue;
    }
    if (arg === '--geoid-model-id') {
      const value = nextValue(i, arg).trim();
      if (!value) {
        throw new Error('Invalid --geoid-model-id value');
      }
      config.parseOptions.geoidModelId = value.toUpperCase();
      config.parseOptions.geoidModelEnabled = true;
      i += 1;
      continue;
    }
    if (arg === '--geoid-interpolation') {
      const value = parseGeoidInterpolationArg(nextValue(i, arg));
      if (!value) {
        throw new Error(`Invalid --geoid-interpolation value "${argv[i + 1]}"`);
      }
      config.parseOptions.geoidInterpolation = value;
      config.parseOptions.geoidModelEnabled = true;
      i += 1;
      continue;
    }
    if (arg === '--geoid-source-format') {
      const value = parseGeoidSourceFormatArg(nextValue(i, arg));
      if (!value) {
        throw new Error(`Invalid --geoid-source-format value "${argv[i + 1]}"`);
      }
      config.parseOptions.geoidSourceFormat = value;
      config.parseOptions.geoidModelEnabled = true;
      i += 1;
      continue;
    }
    if (arg === '--geoid-source-path') {
      const value = nextValue(i, arg).trim();
      if (!value) {
        throw new Error('Invalid --geoid-source-path value');
      }
      config.parseOptions.geoidSourcePath = value;
      config.parseOptions.geoidModelEnabled = true;
      i += 1;
      continue;
    }
    if (arg === '--gnss-vector-frame') {
      const value = parseGnssVectorFrameArg(nextValue(i, arg));
      if (!value) {
        throw new Error(`Invalid --gnss-vector-frame value "${argv[i + 1]}"`);
      }
      config.parseOptions.gnssVectorFrameDefault = value;
      i += 1;
      continue;
    }
    if (arg === '--gnss-frame-confirm') {
      const value = nextValue(i, arg).toLowerCase();
      if (value !== 'on' && value !== 'off') {
        throw new Error(`Invalid --gnss-frame-confirm value "${argv[i + 1]}"`);
      }
      config.parseOptions.gnssFrameConfirmed = value === 'on';
      i += 1;
      continue;
    }
    throw new Error(`Unknown option "${arg}"`);
  }

  finalizeCliConfig(config);
  return config;
};

const finalizeCliConfig = (config: CliConfig): void => {
  if (!config.inputPath) {
    throw new Error('Missing required --input argument');
  }

  config.profile = normalizeSolveProfile(config.profile);
  config.parseOptions.directionSetMode = 'raw';
  config.parseOptions.robustMode = 'none';
  config.parseOptions.tsCorrelationEnabled = false;
  config.parseOptions.tsCorrelationRho = 0;
  config.parseOptions.directionFaceReliabilityFromCluster = false;
  config.parseOptions.parseCompatibilityMode = 'strict';
  if (!config.parseOptions.faceNormalizationMode) {
    config.parseOptions.faceNormalizationMode = 'on';
  }
  if (typeof config.parseOptions.normalize !== 'boolean') {
    config.parseOptions.normalize = config.parseOptions.faceNormalizationMode !== 'off';
  }
  config.parseOptions.parseModeMigrated = true;
  if (!config.parseOptions.runMode) {
    config.parseOptions.runMode = config.parseOptions.preanalysisMode
      ? 'preanalysis'
      : 'adjustment';
  }
  if (config.parseOptions.runMode === 'preanalysis') {
    config.parseOptions.preanalysisMode = true;
  } else if (
    config.parseOptions.runMode === 'adjustment' ||
    config.parseOptions.runMode === 'data-check' ||
    config.parseOptions.runMode === 'blunder-detect'
  ) {
    config.parseOptions.preanalysisMode = false;
  }
};
