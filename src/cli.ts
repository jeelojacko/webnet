import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { LSAEngine } from './engine/adjust';
import type { ParseOptions } from './types';

type SolveProfile = 'webnet' | 'industry-parity';
type UnitsMode = 'm' | 'ft';
type CoordMode = '2D' | '3D';

const EXIT_OK = 0;
const EXIT_SOLVE_FAILED = 1;
const EXIT_USAGE_ERROR = 2;

interface CliConfig {
  inputPath: string;
  profile: SolveProfile;
  maxIterations: number;
  parseOptions: Partial<ParseOptions>;
}

const usageText = `WebNet CLI (batch adjustment)

Usage:
  npm run adjust:cli -- --input <file.dat> [options]

Options:
  --input, -i <path>            Input adjustment file (required)
  --profile <webnet|industry-parity>
  --max-iterations <n>
  --units <m|ft>
  --coord-mode <2D|3D>
  --help, -h
`;

const parseArgs = (argv: string[]): CliConfig => {
  const config: CliConfig = {
    inputPath: '',
    profile: 'webnet',
    maxIterations: 10,
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
    if (arg === '--units') {
      const value = nextValue(i, arg);
      if (value !== 'm' && value !== 'ft') {
        throw new Error(`Invalid --units value "${value}"`);
      }
      config.parseOptions.units = value as UnitsMode;
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
  const convergedLabel = result.converged ? 'YES' : 'NO';
  process.stdout.write(
    [
      `WebNet CLI solve summary`,
      `Input: ${inputPath}`,
      `Profile: ${cfg.profile}`,
      `Converged: ${convergedLabel}`,
      `Iterations: ${result.iterations}`,
      `DOF: ${result.dof}`,
      `SEUW: ${result.seuw.toFixed(6)}`,
      `Stations: ${Object.keys(result.stations).length}`,
      `Observations: ${result.observations.length}`,
    ].join('\n') + '\n',
  );
  return result.success ? EXIT_OK : EXIT_SOLVE_FAILED;
};

process.exit(run());
