import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CANADIAN_CRS_TEST_CATALOG,
} from '../src/engine/canadianCrsTestCatalog';
import { generateSyntheticCanadianNetwork, type TrueStation } from '../src/engine/generateSyntheticCanadianNetwork';
import {
  buildSyntheticCrsGroupedSummary,
  formatSyntheticCrsMarkdownSummary,
  runSyntheticCrsAdjustmentTest,
  type SyntheticCrsAdjustmentRunResult,
} from '../src/engine/runSyntheticCrsAdjustmentTest';

type Template = 'braced-quadrilateral' | 'short-traverse' | 'loop' | 'mixed-3d';

const TEMPLATES: Template[] = ['braced-quadrilateral', 'short-traverse', 'loop', 'mixed-3d'];

const fmt = (value: number, digits = 4): string =>
  Number.isFinite(value) ? value.toFixed(digits) : '-';

const toStationRow = (station: TrueStation, adjusted: SyntheticCrsAdjustmentRunResult['result']['stations'][string]) => {
  const dE = adjusted.x - station.easting;
  const dN = adjusted.y - station.northing;
  const dH = adjusted.h - station.elevation;
  return {
    id: station.id,
    role: station.role,
    truth: {
      easting: station.easting,
      northing: station.northing,
      elevation: station.elevation,
    },
    adjusted: {
      easting: adjusted.x,
      northing: adjusted.y,
      elevation: adjusted.h,
    },
    delta: {
      dE,
      dN,
      dH,
      horizontal: Math.hypot(dE, dN),
      verticalAbs: Math.abs(dH),
    },
    sigma: {
      sE: adjusted.sE,
      sN: adjusted.sN,
      sH: adjusted.sH,
    },
  };
};

const renderCaseMarkdown = (
  run: SyntheticCrsAdjustmentRunResult,
  stationRows: ReturnType<typeof toStationRow>[],
): string => {
  const lines: string[] = [];
  lines.push(`# Synthetic CRS Case`);
  lines.push('');
  lines.push(`- CRS: \`${run.crsId}\``);
  lines.push(`- Seed: \`${run.seed}\``);
  lines.push(`- Template: \`${run.template}\``);
  lines.push(`- Placement: \`${run.placement}\``);
  lines.push(`- Success: \`${run.result.success}\``);
  lines.push('');
  lines.push('## Metrics');
  lines.push('');
  lines.push(`- maxHorizontalErrorM: \`${fmt(run.metrics.maxHorizontalErrorM, 6)}\``);
  lines.push(`- rmsHorizontalErrorM: \`${fmt(run.metrics.rmsHorizontalErrorM, 6)}\``);
  lines.push(`- maxVerticalErrorM: \`${fmt(run.metrics.maxVerticalErrorM, 6)}\``);
  lines.push(`- rmsVerticalErrorM: \`${fmt(run.metrics.rmsVerticalErrorM, 6)}\``);
  lines.push(`- residualRms: \`${fmt(run.metrics.residualRms, 6)}\``);
  lines.push(`- seuw: \`${fmt(run.metrics.seuw, 6)}\``);
  lines.push('');
  lines.push('## Input');
  lines.push('');
  lines.push('```txt');
  lines.push(run.input);
  lines.push('```');
  lines.push('');
  lines.push('## Truth vs Adjusted');
  lines.push('');
  lines.push(
    '| ID | Role | True E | True N | True H | Adj E | Adj N | Adj H | dHorz (m) | dVert (m) | sE (m) | sN (m) | sH (m) |',
  );
  lines.push(
    '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  );
  stationRows.forEach((row) => {
    lines.push(
      `| ${row.id} | ${row.role} | ${fmt(row.truth.easting)} | ${fmt(row.truth.northing)} | ${fmt(row.truth.elevation)} | ${fmt(row.adjusted.easting)} | ${fmt(row.adjusted.northing)} | ${fmt(row.adjusted.elevation)} | ${fmt(row.delta.horizontal, 6)} | ${fmt(row.delta.verticalAbs, 6)} | ${fmt(row.sigma.sE, 6)} | ${fmt(row.sigma.sN, 6)} | ${fmt(row.sigma.sH, 6)} |`,
    );
  });
  lines.push('');
  if (run.result.logs.length > 0) {
    lines.push('## Solve Logs');
    lines.push('');
    lines.push('```txt');
    lines.push(run.result.logs.join('\n'));
    lines.push('```');
    lines.push('');
  }
  return lines.join('\n').trimEnd();
};

const toSlug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');

const main = () => {
  const perfectMode = process.argv.includes('--perfect');
  const precisionMode = perfectMode ? 'perfect' : 'standard';
  const outRoot = path.resolve(process.cwd(), 'artifacts', 'synthetic-crs');
  const casesDir = path.join(outRoot, 'cases');
  mkdirSync(casesDir, { recursive: true });

  const runs: SyntheticCrsAdjustmentRunResult[] = [];
  const runManifest: Array<{
    fileStem: string;
    crsId: string;
    name: string;
    family: string;
    template: Template;
    seed: number;
    success: boolean;
    maxHorizontalErrorM: number;
    maxVerticalErrorM: number;
    residualRms: number;
    seuw: number;
    markdownPath: string;
    jsonPath: string;
  }> = [];

  let caseIndex = 0;
  CANADIAN_CRS_TEST_CATALOG.forEach((config, crsIndex) => {
    TEMPLATES.forEach((template, templateIndex) => {
      const seed = 20000 + crsIndex * 100 + templateIndex;
      const run = runSyntheticCrsAdjustmentTest({
        crsId: config.webnetCrsId,
        seed,
        template,
        mode: 'noise-free',
        observationOptions: {
          precisionMode,
        },
      });
      runs.push(run);
      const truth = generateSyntheticCanadianNetwork({
        crsId: config.webnetCrsId,
        seed,
        template,
        placement: 'interior',
      });
      const stationRows = truth.stations
        .map((station) => {
          const adjusted = run.result.stations[station.id];
          if (!adjusted) return null;
          return toStationRow(station, adjusted);
        })
        .filter((row): row is ReturnType<typeof toStationRow> => row != null);

      const fileStem = `${String(caseIndex + 1).padStart(3, '0')}_${toSlug(config.id)}_${toSlug(template)}`;
      const markdownPath = path.join(casesDir, `${fileStem}.md`);
      const jsonPath = path.join(casesDir, `${fileStem}.json`);

      const jsonPayload = {
        case: {
          crsId: config.webnetCrsId,
          catalogId: config.id,
          name: config.name,
          family: config.family,
          seed,
          template,
          placement: 'interior',
          precisionMode,
          success: run.result.success,
        },
        metrics: run.metrics,
        input: run.input,
        stationRows,
        logs: run.result.logs,
      };
      writeFileSync(markdownPath, renderCaseMarkdown(run, stationRows), 'utf-8');
      writeFileSync(jsonPath, JSON.stringify(jsonPayload, null, 2), 'utf-8');

      runManifest.push({
        fileStem,
        crsId: config.webnetCrsId,
        name: config.name,
        family: config.family,
        template,
        seed,
        success: run.result.success,
        maxHorizontalErrorM: run.metrics.maxHorizontalErrorM,
        maxVerticalErrorM: run.metrics.maxVerticalErrorM,
        residualRms: run.metrics.residualRms,
        seuw: run.metrics.seuw,
        markdownPath: path.relative(outRoot, markdownPath),
        jsonPath: path.relative(outRoot, jsonPath),
      });
      caseIndex += 1;
    });
  });

  const groupedSummary = buildSyntheticCrsGroupedSummary(runs);
  const summaryMarkdown = [
    '# Synthetic CRS Full-Catalog Report',
    '',
    `Generated cases: ${runManifest.length}`,
    `CRS entries: ${CANADIAN_CRS_TEST_CATALOG.length}`,
    `Templates per CRS: ${TEMPLATES.length}`,
    `Precision mode: ${precisionMode}`,
    '',
    formatSyntheticCrsMarkdownSummary(runs),
    '',
    '## Case Index',
    '',
    '| Case | CRS | Family | Template | Seed | Pass | Max H (m) | Max V (m) | Residual RMS | SEUW | Markdown | JSON |',
    '| ---: | --- | --- | --- | ---: | :--: | ---: | ---: | ---: | ---: | --- | --- |',
    ...runManifest.map(
      (item, idx) =>
        `| ${idx + 1} | ${item.crsId} | ${item.family} | ${item.template} | ${item.seed} | ${item.success ? 'PASS' : 'FAIL'} | ${item.maxHorizontalErrorM.toFixed(6)} | ${item.maxVerticalErrorM.toFixed(6)} | ${item.residualRms.toFixed(6)} | ${item.seuw.toFixed(6)} | ${item.markdownPath} | ${item.jsonPath} |`,
    ),
    '',
  ].join('\n');

  writeFileSync(path.join(outRoot, 'README.md'), summaryMarkdown, 'utf-8');
  writeFileSync(path.join(outRoot, 'summary.json'), JSON.stringify(groupedSummary, null, 2), 'utf-8');
  writeFileSync(path.join(outRoot, 'manifest.json'), JSON.stringify(runManifest, null, 2), 'utf-8');

  const failures = runManifest.filter((item) => !item.success).length;
  console.log(
    `Synthetic CRS report export complete: ${runManifest.length} cases (${failures} failures). Output: ${outRoot}`,
  );
};

main();
