import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { LSAEngine } from '../src/engine/adjust';
import { buildSystematicDiagnostics } from '../src/engine/systematicPatternDiagnostics';
import { appendSystematicPatternSections } from '../src/engine/runResultsTextSystematicSections';
import type { AdjustmentResult, Observation } from '../src/types';
import SystematicPatternSection from '../src/components/report/SystematicPatternSection';
import DirectionTargetRepeatabilitySection from '../src/components/report/DirectionTargetRepeatabilitySection';

/** Combined terrestrial job: distances + face-paired direction sets, no leveling. */
const TERRESTRIAL_INPUT = [
  '.2D',
  'C O 0 0 0 !',
  'C BS 0 100 0 !',
  'C P 100 0 0',
  'C Q 120 40 0',
  'D O-P 100.000 0.003',
  'D O-Q 126.491 0.003',
  'D BS-P 141.421 0.003',
  'D BS-Q 134.164 0.003',
  'DB O BS',
  'DM P 090-00-00.0 100.000 090-00-00.0 1.0 0.003',
  'DM P 090-00-08.0 100.000 090-00-00.0 1.0 0.003',
  'DM P 270-00-03.0 100.000 270-00-00.0 1.0 0.003',
  'DM P 270-00-14.0 100.000 270-00-00.0 1.0 0.003',
  'DM Q 108-26-06.0 126.491 090-00-00.0 1.0 0.003',
  'DM Q 288-26-09.0 126.491 270-00-00.0 1.0 0.003',
  'DE',
].join('\n');

const solveTerrestrial = () =>
  new LSAEngine({
    input: TERRESTRIAL_INPUT,
    maxIterations: 12,
    parseOptions: { parseCompatibilityMode: 'strict', faceNormalizationMode: 'on' },
  }).solve() as unknown as AdjustmentResult;

const link = (line: number | null | undefined) => `L${line ?? '-'}`;

let nextId = 1000;
const distObs = (lenM: number, residual: number): Observation =>
  ({
    id: nextId++,
    type: 'dist',
    subtype: 'ts',
    instCode: 'T1',
    from: 'A',
    to: 'P',
    obs: lenM,
    stdDev: 0.005,
    residual,
    stdRes: residual / 0.005,
  }) as unknown as Observation;

const levObs = (residual: number, line: number): Observation =>
  ({
    id: nextId++,
    type: 'lev',
    instCode: 'L1',
    from: 'A',
    to: 'B',
    obs: 1.0,
    lenKm: 0.02,
    stdDev: 0.002,
    residual,
    stdRes: residual / 0.002,
    sourceLine: line,
  }) as unknown as Observation;

const dirObs = (residual: number): Observation =>
  ({
    id: nextId++,
    type: 'direction',
    instCode: 'T1',
    setId: 'SET1',
    at: 'S1',
    to: 'T1',
    obs: 0.5,
    stdDev: 0.00002,
    residual,
    stdRes: Math.abs(residual / 0.00002),
  }) as unknown as Observation;

describe('systematic pattern report section', () => {
  it('renders descriptive summaries with reasons where data are insufficient', () => {
    const result = solveTerrestrial();
    expect(result.systematicDiagnostics?.available).toBe(true);
    const html = renderToStaticMarkup(
      <SystematicPatternSection
        isDataCheck={false}
        isPreanalysis={false}
        renderSourceLineLink={link}
        result={result}
      />,
    );
    expect(html).toContain('Systematic pattern diagnostics');
    expect(html).toContain('DESCRIPTIVE');
    // Narrow distance span: trend gate reason shown, not a slope claim.
    expect(html).toContain('intercept pattern and slope pattern not separable');
    // No leveling in this job: availability reason shown.
    expect(html).toContain('no leveling residuals available');
    // Direction face facts present with a source-line link.
    expect(html).toContain('Face-count balance');
    expect(html).toContain('DESCRIPTIVE');
  });

  it('hides the section in preanalysis and data-check modes', () => {
    const result = solveTerrestrial();
    expect(
      renderToStaticMarkup(
        <SystematicPatternSection
          isDataCheck={false}
          isPreanalysis
          renderSourceLineLink={link}
          result={result}
        />,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <SystematicPatternSection
          isDataCheck
          isPreanalysis={false}
          renderSourceLineLink={link}
          result={result}
        />,
      ),
    ).toBe('');
  });

  it('renders descriptive slope and leveling drift when gates pass', () => {
    const base = solveTerrestrial();
    const obs: Observation[] = [
      distObs(50, 0.001),
      distObs(120, 0.002),
      distObs(200, 0.002),
      distObs(310, 0.004),
      distObs(420, 0.005),
      distObs(530, 0.006),
      levObs(0.001, 1),
      levObs(-0.002, 2),
      levObs(0.0015, 3),
      levObs(-0.001, 4),
      levObs(0.002, 5),
      levObs(-0.0015, 6),
      dirObs(0.00002),
      dirObs(-0.00001),
    ];
    const patched = {
      ...base,
      systematicDiagnostics: buildSystematicDiagnostics(obs, {}),
    } as AdjustmentResult;
    expect(patched.systematicDiagnostics?.distanceTrend.separable).toBe(true);
    expect(patched.systematicDiagnostics?.levelingPatterns.status).toBe('descriptive');
    const html = renderToStaticMarkup(
      <SystematicPatternSection
        isDataCheck={false}
        isPreanalysis={false}
        renderSourceLineLink={link}
        result={patched}
      />,
    );
    expect(html).toContain('mm/km');
    expect(html).toContain('input sequence');
    expect(html).toContain('DESCRIPTIVE');
    // Setup-family display units and honest labels.
    expect(html).toContain('Mean|StdRes|');
    expect(html).toContain('mm');
    // Direction family mean (0.000005 rad) displays converted to arcseconds.
    expect(html).toContain('1.031');
    // Distance tooltip stays facts-not-causes.
    expect(html).not.toContain('consistent with scale or modeling effects');
    expect(html).toContain('does not identify a cause');
    expect(html).not.toMatch(/\bcorr\b/);
    // Face summary counts set-target rows, never plain sets.
    expect(html).toContain('unpaired');
  });

  it('labels direction scores as heuristic ordering aids', () => {
    const result = solveTerrestrial();
    const html = renderToStaticMarkup(
      <DirectionTargetRepeatabilitySection
        directionTargetDiagnostics={result.directionTargetDiagnostics ?? []}
        isDataCheck={false}
        isPreanalysis={false}
        renderCollapsibleSectionHeader={() => null}
        isSectionCollapsed={() => false}
        renderSourceLineLink={link}
      />,
    );
    expect(html).toContain('Heuristic score');
    expect(html).toContain('Deterministic ordering aid only');
    expect(html).not.toContain('>Score</th>');
  });

  it('exports the systematic text block and heuristic score headers', () => {
    const result = solveTerrestrial();
    const lines: string[] = [];
    appendSystematicPatternSections({ lines, res: result });
    const text = lines.join('\n');
    expect(text).toContain('--- Systematic Pattern Diagnostics ---');
    expect(text).toContain('Descriptive only');
    // Honest framing in text export: design-collinearity proxy, set-target
    // face rows with unpaired counts, absolute |StdRes| means, no causes.
    expect(text).toContain('designCollinearity');
    expect(text).toContain('separable');
    expect(text).toContain('set-target rows');
    expect(text).toContain('Face-count balance');
    expect(text).toContain('unpaired-not-assessable');
    expect(text).toContain('meanAbsStdRes');
    expect(text).toContain('does not identify a cause');
    expect(text).not.toMatch(/\bcorr=/);
    expect(text).not.toContain('consistent with scale or modeling effects');
    const logs = (result.logs ?? []).join('\n');
    expect(logs).toContain('scores heuristic');
  });
});
