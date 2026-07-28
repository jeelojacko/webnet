import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import {
  parseArgs,
  type CliConfig,
  type UnitsMode,
} from './cliArgs';
import { EXIT_OK, EXIT_SOLVE_FAILED, EXIT_USAGE_ERROR, usageText } from './cliUsage';
import { solveEngine } from './engine/solveEngine';
import type { ParseOptions } from './types';
import { buildIndustryStyleListingText } from './engine/industryListing';
import { buildLandXmlText } from './engine/landxml';

export { parseArgs } from './cliArgs';

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
  cfg.parseOptions.sourceFile = inputPath;
  const includeCache = new Map<string, string>();
  cfg.parseOptions.includeResolver = ({ includePath, parentSourceFile }) => {
    const baseFile =
      parentSourceFile && parentSourceFile !== '<input>' ? parentSourceFile : inputPath;
    const resolved = path.resolve(path.dirname(baseFile), includePath);
    try {
      const cached = includeCache.get(resolved);
      if (cached != null) {
        return { sourceFile: resolved, content: cached };
      }
      const content = readFileSync(resolved, 'utf-8');
      includeCache.set(resolved, content);
      return { sourceFile: resolved, content };
    } catch {
      return null;
    }
  };
  let inputText: string;
  try {
    inputText = readFileSync(inputPath, 'utf-8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`Failed to read input file "${inputPath}": ${message}\n`);
    return EXIT_USAGE_ERROR;
  }
  let geoidSourceData: Uint8Array | undefined;
  if (
    cfg.parseOptions.geoidSourceFormat &&
    cfg.parseOptions.geoidSourceFormat !== 'builtin' &&
    typeof cfg.parseOptions.geoidSourcePath === 'string' &&
    cfg.parseOptions.geoidSourcePath.trim().length > 0
  ) {
    const geoidPath = path.resolve(process.cwd(), cfg.parseOptions.geoidSourcePath.trim());
    try {
      geoidSourceData = readFileSync(geoidPath);
      cfg.parseOptions.geoidSourcePath = geoidPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`Failed to read geoid source file "${geoidPath}": ${message}\n`);
      return EXIT_USAGE_ERROR;
    }
  }

  const result = solveEngine({
    input: inputText,
    maxIterations: cfg.maxIterations,
    parseOptions: cfg.parseOptions,
    geoidSourceData,
  });
  const parseState: Partial<ParseOptions> = result.parseState ?? {};
  const parityProfile = cfg.profile !== 'webnet';
  const profileParseOptions: Partial<ParseOptions> = {
    ...(cfg.parseOptions ?? {}),
    ...(parityProfile
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
            runMode: result.parseState?.runMode ?? cfg.parseOptions.runMode ?? 'adjustment',
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
              listingSortObservationsBy: 'stdResidual',
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
              coordSystemMode:
                parseState.coordSystemMode ?? profileParseOptions.coordSystemMode ?? 'local',
              crsId: parseState.crsId ?? profileParseOptions.crsId,
              localDatumScheme: parseState.localDatumScheme ?? profileParseOptions.localDatumScheme,
              averageScaleFactor:
                parseState.averageScaleFactor ?? profileParseOptions.averageScaleFactor,
              commonElevation: parseState.commonElevation ?? profileParseOptions.commonElevation,
              averageGeoidHeight:
                parseState.averageGeoidHeight ?? profileParseOptions.averageGeoidHeight,
              gridBearingMode: parseState.gridBearingMode ?? profileParseOptions.gridBearingMode,
              gridDistanceMode: parseState.gridDistanceMode ?? profileParseOptions.gridDistanceMode,
              gridAngleMode: parseState.gridAngleMode ?? profileParseOptions.gridAngleMode,
              gridDirectionMode:
                parseState.gridDirectionMode ?? profileParseOptions.gridDirectionMode,
              qFixLinearSigmaM: parseState.qFixLinearSigmaM ?? profileParseOptions.qFixLinearSigmaM,
              qFixAngularSigmaSec:
                parseState.qFixAngularSigmaSec ?? profileParseOptions.qFixAngularSigmaSec,
            },
          )
        : cfg.outputFormat === 'landxml'
          ? buildLandXmlText(result, {
              units: (parseState.units ?? profileParseOptions.units ?? 'm') as UnitsMode,
              solveProfile: cfg.profile,
              showLostStations: true,
              projectName: path.basename(inputPath, path.extname(inputPath)),
              applicationName: 'WebNet',
              applicationVersion: '0.0.0',
            })
          : [
              `WebNet CLI solve summary`,
              `Input: ${inputPath}`,
              `Profile: ${cfg.profile}`,
              `Run mode: ${
                result.parseState?.runMode === 'preanalysis'
                  ? `PREANALYSIS (planned observations=${result.parseState?.plannedObservationCount ?? 0})`
                  : result.parseState?.runMode === 'data-check'
                    ? 'DATA-CHECK'
                    : result.parseState?.runMode === 'blunder-detect'
                      ? 'BLUNDER-DETECT'
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

const isDirectCliEntry = (() => {
  const entryArg = process.argv[1];
  if (!entryArg) return false;
  return import.meta.url === pathToFileURL(entryArg).href;
})();

if (isDirectCliEntry) {
  process.exit(run());
}
