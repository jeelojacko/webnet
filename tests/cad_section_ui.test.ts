import { describe, expect, it } from 'vitest';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import { computeCadSurfaceSourceRevision } from '../src/engine/cad/cadSurfaces';
import { computeCadSampleLineRevision } from '../src/engine/cad/cadSectionRevision';
import { seedCadSectionStyles } from '../src/engine/cad/cadSectionTypes';
import { filterCadDisplaySceneForViewport } from '../src/engine/cad/cadViewportAppearance';
import {
  buildSampleLineDisplayLayers,
  buildSectionViewDisplayLayers,
  interpolateSectionElevation,
} from '../src/engine/cad/cadSectionView';
import { createCadSectionCache } from '../src/engine/cad/sectionCache';
import {
  buildCadSectionSnapshot,
  formatSectionElevationAnswer,
  layoutSectionViewStack,
  querySectionElevationAtOffset,
  validateSectionView,
} from '../src/cad-app/shell/cadSectionSnapshot';
import type { CadSurfaceSectionResult } from '../src/engine/cad/cadSectionTypes';
import type {
  CadAlignmentElement,
  CadProject,
  CadSurveyPointEntity,
} from '../src/engine/cad/cadTypes';

const point = (id: string, stationId: string, x: number, y: number, z: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'points',
  visible: true,
  locked: false,
  stationId,
  x,
  y,
  z,
  pointClass: 'free',
  source: 'parsed-input',
});

const line = (x0: number, y0: number, x1: number, y1: number): CadAlignmentElement => ({
  kind: 'line',
  start: { x: x0, y: y0 },
  end: { x: x1, y: y1 },
});

// Alignment (0,5)->(10,5), start 0: raw s maps to (s,5); +offset = +y (left).
const baseProject = (): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'Sections UI', units: 'm' });
  return {
    ...drawing.project,
    entities: [
      point('p1', 'P1', 0, 0, 5),
      point('p2', 'P2', 10, 0, 5),
      point('p3', 'P3', 10, 10, 5),
      point('p4', 'P4', 0, 10, 5),
      {
        id: 'align-1',
        type: 'alignment',
        layerId: 'general',
        visible: true,
        locked: false,
        name: 'CL',
        elements: [line(0, 5, 10, 5)],
        startStation: 0,
      },
    ],
    surfaces: [
      { id: 'surf-1', name: 'Existing', definition: { pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3', 'p4'] } }, cachedRevision: null },
      { id: 'surf-2', name: 'Design', definition: { pointSource: { kind: 'points', pointEntityIds: ['p1', 'p2', 'p3', 'p4'] } }, cachedRevision: null },
    ],
    sampleLineGroups: [
      {
        id: 'grp-1',
        name: 'Corridor',
        alignmentEntityId: 'align-1',
        surfaceSources: [{ surfaceId: 'surf-1' }, { surfaceId: 'surf-2' }],
        sampleLines: [
          { id: 'line-1', rawStation: 2, leftWidth: 5, rightWidth: 5, skewDeg: 0 },
        ],
      },
    ],
  };
};

/** Hand-built CURRENT result: flat plane at z over the given offset runs. */
const flatResult = (
  project: CadProject,
  groupId: string,
  lineId: string,
  surfaceId: string,
  rawStation: number,
  z: number,
  runs: Array<[number, number]>,
): CadSurfaceSectionResult => {
  const group = project.sampleLineGroups!.find((entry) => entry.id === groupId)!;
  const link = group.sampleLines.find((entry) => entry.id === lineId)!;
  const alignment = project.entities.find((entry) => entry.id === group.alignmentEntityId)!;
  const surface = project.surfaces!.find((entry) => entry.id === surfaceId)!;
  if (alignment.type !== 'alignment') throw new Error('alignment missing');
  const segments = runs.map(([o0, o1]) => ({
    samples: [
      { offset: o0, elevation: z, x: rawStation, y: 5 + o0 },
      { offset: o1, elevation: z, x: rawStation, y: 5 + o1 },
    ],
  }));
  return {
    groupId,
    lineId,
    surfaceId,
    revision: computeCadSampleLineRevision(
      link,
      { id: alignment.id, elements: alignment.elements, startStation: alignment.startStation },
      group.alignmentEntityId,
    ),
    surfaceRevision: computeCadSurfaceSourceRevision(project, surface),
    rawStation,
    segments,
    minElevation: z,
    maxElevation: z,
    coveredWidth: runs.reduce((total, [o0, o1]) => total + (o1 - o0), 0),
    gapWidth: 0,
    diagnostics: [],
  };
};

const statusOf = () => ({ status: 'CURRENT' as const, stale: false });

describe('18K section UI: plan display layers', () => {
  it('draws the centerline across left/right widths with a station label', () => {
    const layers = buildSampleLineDisplayLayers(baseProject());
    expect(layers).toHaveLength(1);
    const [entry] = layers[0]!.lines;
    // Center (2,5), direction +y: M2 10L2 0.
    expect(entry!.d).toBe('M2 10L2 0');
    expect(entry!.label).toBe('0+02.000');
    expect(entry!.tickD).not.toBe('');
    expect(entry!.ambiguousLabel).toBe(false);
  });

  it('equation change relabels without moving XY', () => {
    const before = buildSampleLineDisplayLayers(baseProject());
    const withEquation = baseProject();
    const alignment = withEquation.entities.find((entry) => entry.id === 'align-1')!;
    if (alignment.type !== 'alignment') throw new Error('alignment missing');
    alignment.stationEquations = [{ backStation: 1, aheadStation: 11, rawStation: 1 }];
    const after = buildSampleLineDisplayLayers(withEquation);
    // Raw 2 past the equation shifts +10 in display; geometry is raw-based.
    expect(after[0]!.lines[0]!.label).toBe('0+12.000');
    expect(after[0]!.lines[0]!.d).toBe(before[0]!.lines[0]!.d);
  });

  it('layer OFF/FROZEN hides plan lines without extraction', () => {
    const project = baseProject();
    const layers = buildSampleLineDisplayLayers(project);
    expect(layers[0]!.lines[0]!.d).not.toBe('');
    const scene = filterCadDisplaySceneForViewport(project, {
      bounds: null,
      primitives: [],
      sampleLineLayers: layers,
    });
    expect(scene.sampleLineLayers).toHaveLength(1);
    const hidden = {
      ...project,
      layers: project.layers.map((entry) =>
        entry.id === 'general' ? { ...entry, visible: false } : entry,
      ),
    };
    const offScene = filterCadDisplaySceneForViewport(hidden, {
      bounds: null,
      primitives: [],
      sampleLineLayers: layers,
    });
    expect(offScene.sampleLineLayers).toHaveLength(0);
    // ON restores from the same derived layers — no rebuild involved.
    const restored = filterCadDisplaySceneForViewport(project, {
      bounds: null,
      primitives: [],
      sampleLineLayers: layers,
    });
    expect(restored.sampleLineLayers).toHaveLength(1);
  });

  it('layer FROZEN hides plan lines like OFF does', () => {
    const project = baseProject();
    const layers = buildSampleLineDisplayLayers(project);
    const frozen = {
      ...project,
      layers: project.layers.map((entry) =>
        entry.id === 'general' ? { ...entry, frozen: true } : entry,
      ),
    };
    const scene = filterCadDisplaySceneForViewport(frozen, {
      bounds: null,
      primitives: [],
      sampleLineLayers: layers,
    });
    expect(scene.sampleLineLayers).toHaveLength(0);
  });
});

describe('18K section UI: section-view display', () => {
  const viewProject = (): CadProject => ({
    ...baseProject(),
    sectionViews: [
      {
        id: 'view-1',
        name: 'STA 2',
        sampleLineGroupId: 'grp-1',
        sampleLineId: 'line-1',
        sourceSurfaceIds: ['surf-1', 'surf-2'],
        insertionX: 100,
        insertionY: 50,
        horizontalScale: 1,
        verticalExaggeration: 1,
        datumMode: 'auto',
        offsetGridInterval: 5,
        elevationGridInterval: 1,
        showCutFill: true,
      },
    ],
  });

  it('puts LEFT on visual left with L/R ticks and a CL centerline', () => {
    const project = viewProject();
    const cache = createCadSectionCache('draw-1');
    const group = project.sampleLineGroups![0]!;
    const link = group.sampleLines[0]!;
    cache.set('line-1', 'surf-1', flatResult(project, 'grp-1', 'line-1', 'surf-1', link.rawStation, 5, [[-5, 5]]));
    const layers = buildSectionViewDisplayLayers(project, cache);
    expect(layers).toHaveLength(1);
    const view = layers[0]!;
    // Offset +5 (left) renders left of insertion (x < 100); -5 right (x > 100).
    const tickTexts = view.offsetTicks.map((tick) => tick.text);
    expect(tickTexts).toContain('5L');
    expect(tickTexts).toContain('5R');
    const leftTick = view.offsetTicks.find((tick) => tick.text === '5L')!;
    const rightTick = view.offsetTicks.find((tick) => tick.text === '5R')!;
    expect(leftTick.x).toBeLessThan(100);
    expect(rightTick.x).toBeGreaterThan(100);
    expect(view.centerlineD).toContain('M100 ');
    expect(view.title).toBe('CL — STA 0+02.000');
  });

  it('per-source section styles color traces; "None" hides a trace', () => {
    const styled = viewProject();
    const styles = seedCadSectionStyles();
    styled.sectionStyles = styles;
    styled.sampleLineGroups = [
      {
        ...styled.sampleLineGroups![0]!,
        surfaceSources: [
          { surfaceId: 'surf-1', sectionStyleId: styles[0]!.id },
          { surfaceId: 'surf-2', sectionStyleId: 'section-style-none' },
        ],
      },
    ];
    const cache = createCadSectionCache('draw-1');
    const link = styled.sampleLineGroups![0]!.sampleLines[0]!;
    cache.set('line-1', 'surf-1', flatResult(styled, 'grp-1', 'line-1', 'surf-1', link.rawStation, 5, [[-5, 5]]));
    cache.set('line-1', 'surf-2', flatResult(styled, 'grp-1', 'line-1', 'surf-2', link.rawStation, 7, [[-5, 5]]));
    const layers = buildSectionViewDisplayLayers(styled, cache);
    const view = layers[0]!;
    // Styled trace takes the style color; the "None" trace is dropped
    // (no path, no legend entry) — style decision, not a render bug.
    expect(view.tracePaths).toHaveLength(1);
    expect(view.tracePaths[0]!.surfaceId).toBe('surf-1');
    expect(view.tracePaths[0]!.color).toBe(styles[0]!.color);
    expect(view.legend).toHaveLength(1);
  });

  it('leaves gaps empty and stops shading at gap edges', () => {
    const project = {
      ...viewProject(),
      sampleLineGroups: [
        {
          ...viewProject().sampleLineGroups![0]!,
          areaComparison: { baseSurfaceId: 'surf-1', comparisonSurfaceId: 'surf-2' },
        },
      ],
    };
    const cache = createCadSectionCache('draw-1');
    const group = project.sampleLineGroups![0]!;
    const link = group.sampleLines[0]!;
    // Base full width at z=5; comparison +2 only over [-5,0] (void right half).
    cache.set('line-1', 'surf-1', flatResult(project, 'grp-1', 'line-1', 'surf-1', link.rawStation, 5, [[-5, 5]]));
    cache.set('line-1', 'surf-2', flatResult(project, 'grp-1', 'line-1', 'surf-2', link.rawStation, 7, [[-5, 0]]));
    const layers = buildSectionViewDisplayLayers(project, cache);
    const view = layers[0]!;
    // Comparison trace has two M runs only across its covered half — never bridged.
    const compPath = view.tracePaths.find((entry) => entry.surfaceId === 'surf-2')!.d;
    expect(compPath.match(/M/g)).toHaveLength(1);
    expect(compPath).not.toContain('L105 ');
    // Fill covers the common half only: 2 high x 5 wide.
    expect(view.area).not.toBeNull();
    expect(view.area!.fill).toBeCloseTo(10, 9);
    expect(view.area!.cut).toBeCloseTo(0, 9);
    expect(view.fillD).not.toBe('');
    expect(view.cutD).toBe('');
  });
});

describe('18K section UI: inquiry + layout + snapshot', () => {
  it('answers inside coverage and stays honest on gaps/outside', () => {
    const project = baseProject();
    const cache = createCadSectionCache('draw-1');
    const link = project.sampleLineGroups![0]!.sampleLines[0]!;
    cache.set('line-1', 'surf-1', flatResult(project, 'grp-1', 'line-1', 'surf-1', link.rawStation, 5, [[-5, -1], [1, 5]]));
    const hit = querySectionElevationAtOffset(project, cache, 'grp-1', 'line-1', 'surf-1', 3);
    expect(hit?.elevation).toBe(5);
    // Gap between segments + outside coverage both answer null.
    expect(querySectionElevationAtOffset(project, cache, 'grp-1', 'line-1', 'surf-1', 0)).toBeNull();
    expect(querySectionElevationAtOffset(project, cache, 'grp-1', 'line-1', 'surf-1', 6)).toBeNull();
    expect(interpolateSectionElevation(
      flatResult(project, 'grp-1', 'line-1', 'surf-1', link.rawStation, 5, [[-5, 5]]),
      -2.5,
    )?.elevation).toBe(5);
    expect(formatSectionElevationAnswer('STA 2', 'STA 0+002.000', 6, null, true)).toContain('gap or outside');
  });

  it('batch layout stacks frames with no overlap', () => {
    const placements = layoutSectionViewStack(0, 1000, [
      { lineId: 'a', width: 10, height: 60 },
      { lineId: 'b', width: 10, height: 40 },
      { lineId: 'c', width: 10, height: 80 },
    ], 20);
    expect(placements.map((entry) => entry.insertionX)).toEqual([0, 0, 0]);
    const spans = placements.map((entry, index) => {
      const height = [60, 40, 80][index]!;
      return [entry.insertionY - height, entry.insertionY] as const;
    });
    for (let i = 0; i + 1 < spans.length; i += 1) {
      // 20-unit gap between consecutive frames.
      expect(spans[i]![0] - spans[i + 1]![1]).toBeCloseTo(20, 9);
    }
  });

  it('snapshot rows carry stations, statuses, and view validation', () => {
    const project = baseProject();
    const snapshot = buildCadSectionSnapshot(
      project,
      { sectionCache: createCadSectionCache('draw-1'), statusOf },
      null,
      null,
      null,
    );
    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0]!.lines[0]!.name).toBe('STA 0+02.000');
    expect(snapshot.groups[0]!.lines[0]!.sources[0]!.statusText).toBe('Current');
    // A view bound to another group's line is rejected, never rendered blind.
    const bad = validateSectionView(project, {
      id: 'view-x',
      name: 'Bad',
      sampleLineGroupId: 'grp-1',
      sampleLineId: 'nope',
      sourceSurfaceIds: ['surf-1'],
      insertionX: 0,
      insertionY: 0,
      horizontalScale: 1,
      verticalExaggeration: 1,
      datumMode: 'auto',
    });
    expect(bad).toContain('sample line');
  });
});
