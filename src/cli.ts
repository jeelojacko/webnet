import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { LSAEngine } from './engine/adjust';
import type { ParseOptions } from './types';
import { buildIndustryStyleListingText } from './engine/industryListing';

type SolveProfile = 'webnet' | 'industry-parity';
type UnitsMode = 'm' | 'ft';
type CoordMode = '2D' | '3D';
type OutputFormat = 'summary' | 'json' | 'listing';

const EXIT_OK = 0;
const EXIT_SOLVE_FAILED = 1;
const EXIT_USAGE_ERROR = 2;

interface CliConfig {
  inputPath: string;
  profile: SolveProfile;
  maxIterations: number;
  outputFormat: OutputFormat;
  outputPath?: string;
  parseOptions: Partial<ParseOptions>;
}

const usageText = `WebNet CLI (batch adjustment)

Usage:
  npm run adjust:cli -- --input <file.dat> [options]

Options:
  --input, -i <path>            Input adjustment file (required)
  --profile <webnet|industry-parity>
  --max-iterations <n>
  --output <summary|json|listing>
  --out <path>                  Write output payload to file instead of stdout
  --units <m|ft>
  --coord-mode <2D|3D>
  --preanalysis <on|off>
  --autoadjust <on|off>
  --autoadjust-threshold <n>
  --autoadjust-cycles <n>
  --autoadjust-max-removals <n>
  --help, -h
`;

const parseArgs = (argv: string[]): CliConfig => {
  const config: CliConfig = {
    inputPath: '',
    profile: 'webnet',
    maxIterations: 10,
    outputFormat: 'summary',
    parseOptions: {},
  };

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
      if (value !== 'webnet' && value !== 'industry-parity') {
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
      if (value !== 'summary' && value !== 'json' && value !== 'listing') {
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
    throw new Error(`Unknown option "${arg}"`);
  }

  if (!config.inputPath) {
    throw new Error('Missing required --input argument');
  }

  if (config.profile === 'industry-parity') {
    config.parseOptions.directionSetMode = 'raw';
    config.parseOptions.robustMode = 'none';
    config.parseOptions.tsCorrelationEnabled = false;
    config.parseOptions.tsCorrelationRho = 0;
  }

  return config;
};

const run = (): number => {
  let cfg: CliConfig;
  try {
    cfg = parseArgs(process.argv.slice(2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`CLI argument error: ${message}\n\n${usageText}`);
    return EXIT_USAGE_ERROR;
  }

  const inputPath = path.resolve(process.cwd(), cfg.inputPath);
  let inputText: string;
  try {
    inputText = readFileSync(inputPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to read input file "${inputPath}": ${message}\n`);
    return EXIT_USAGE_ERROR;
  }

  const engine = new LSAEngine({
    input: inputText,
    maxIterations: cfg.maxIterations,
    parseOptions: cfg.parseOptions,
  });
  const result = engine.solve();
  const parseState = result.parseState ?? {};
  const profileParseOptions = {
    ...(cfg.parseOptions ?? {}),
    ...(cfg.profile === 'industry-parity'
      ? {
          directionSetMode: 'raw' as const,
          robustMode: 'none' as const,
          tsCorrelationEnabled: false,
          tsCorrelationRho: 0,
        }
      : {}),
  };
  const payload =
    cfg.outputFormat === 'json'
      ? JSON.stringify(
          {
            inputPath,
            profile: cfg.profile,
            success: result.success,
            converged: result.converged,
            iterations: result.iterations,
            dof: result.dof,
            seuw: result.seuw,
            preanalysisMode: result.preanalysisMode === true,
            plannedObservationCount: result.parseState?.plannedObservationCount ?? 0,
            stationCount: Object.keys(result.stations).length,
            observationCount: result.observations.length,
            chiSquare: result.chiSquare,
            parseState: result.parseState,
          },
          null,
          2,
        )
      : cfg.outputFormat === 'listing'
        ? buildIndustryStyleListingText(
            result,
            {
              maxIterations: cfg.maxIterations,
              units: (parseState.units ?? profileParseOptions.units ?? 'm') as UnitsMode,
              listingShowCoordinates: true,
              listingShowObservationsResiduals: true,
              listingShowErrorPropagation: true,
              listingShowProcessingNotes: false,
              listingShowAzimuthsBearings: true,
              listingShowLostStations: true,
              listingSortCoordinatesBy: 'name',
              listingSortObservationsBy: 'residual',
              listingObservationLimit: 500,
            },
            {
              coordMode: parseState.coordMode ?? profileParseOptions.coordMode ?? '3D',
              order: parseState.order ?? profileParseOptions.order ?? 'EN',
              angleUnits: parseState.angleUnits ?? profileParseOptions.angleUnits ?? 'dms',
              angleStationOrder:
                parseState.angleStationOrder ?? profileParseOptions.angleStationOrder ?? 'atfromto',
              deltaMode: parseState.deltaMode ?? profileParseOptions.deltaMode ?? 'slope',
              refractionCoefficient:
                parseState.refractionCoefficient ??
                profileParseOptions.refractionCoefficient ??
                0.13,
              descriptionReconcileMode:
                parseState.descriptionReconcileMode ??
                profileParseOptions.descriptionReconcileMode ??
                'first',
              descriptionAppendDelimiter:
                parseState.descriptionAppendDelimiter ??
                profileParseOptions.descriptionAppendDelimiter ??
                ' | ',
            },
            {
              solveProfile: cfg.profile,
              angleCenteringModel: 'geometry-aware-correlated-rays',
              defaultSigmaCount: 0,
              defaultSigmaByType: '',
              stochasticDefaultsSummary: 'cli',
              rotationAngleRad: parseState.rotationAngleRad ?? 0,
              qFixLinearSigmaM: parseState.qFixLinearSigmaM ?? profileParseOptions.qFixLinearSigmaM,
              qFixAngularSigmaSec:
                parseState.qFixAngularSigmaSec ?? profileParseOptions.qFixAngularSigmaSec,
            },
          )
        : [
            `WebNet CLI solve summary`,
            `Input: ${inputPath}`,
            `Profile: ${cfg.profile}`,
            `Run mode: ${
              result.preanalysisMode
                ? `PREANALYSIS (planned observations=${result.parseState?.plannedObservationCount ?? 0})`
                : 'ADJUSTMENT'
            }`,
            `Converged: ${result.converged ? 'YES' : 'NO'}`,
            `Iterations: ${result.iterations}`,
            `DOF: ${result.dof}`,
            `SEUW: ${result.seuw.toFixed(6)}`,
            `Stations: ${Object.keys(result.stations).length}`,
            `Observations: ${result.observations.length}`,
          ].join('\n');

  try {
    if (cfg.outputPath) {
      const outPath = path.resolve(process.cwd(), cfg.outputPath);
      writeFileSync(outPath, `${payload}\n`, 'utf-8');
      process.stdout.write(`Output written: ${outPath}\n`);
    } else {
      process.stdout.write(`${payload}\n`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to write output: ${message}\n`);
    return EXIT_USAGE_ERROR;
  }

  return result.success ? EXIT_OK : EXIT_SOLVE_FAILED;
};

process.exit(run());
