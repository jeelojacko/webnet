// PERF-186.1 — test-only viewport measurement helpers.
//
// Production viewport code (`cadViewportAppearance`, `cadViewportVisibilityIndex`)
// carries ZERO diagnostic overhead: no counters, no telemetry in hot loops.
// These helpers live in `tests/` (never imported by `src/`) and measure the
// real shipped functions externally:
//
//   - `createViewportFilterSpies` wraps the exported filters and counts
//     invocations (single full traversal + derived-only stages).
//   - `withCountedFinds` proxies a project's lookup arrays and counts `.find`
//     property reads, proving the indexed path issues no per-primitive linear
//     layer/legend/map scans while the legacy replica does.
//   - Index reuse is proven by object identity (`getCadViewportVisibilityIndex`
//     returns the cached index for the same project object).
import {
  filterCadDerivedLayersForViewport,
  filterCadDisplaySceneForViewport,
} from '../src/engine/cad/cadViewportAppearance';
import type {
  CadDisplayScene,
  CadProject,
} from '../src/engine/cad/cadTypes';
import type { CadViewportDerivedLayerPatch } from '../src/engine/cad/cadViewportAppearance';

export interface ViewportFilterSpyCounts {
  full: number;
  derived: number;
}

export const createViewportFilterSpies = (): {
  counts: ViewportFilterSpyCounts;
  fullFilter: (_project: CadProject, _scene: CadDisplayScene) => CadDisplayScene;
  derivedFilter: (
    _project: CadProject,
    _base: CadDisplayScene,
    _patch: CadViewportDerivedLayerPatch,
  ) => CadDisplayScene;
} => {
  const counts: ViewportFilterSpyCounts = { full: 0, derived: 0 };
  return {
    counts,
    fullFilter: (project, scene) => {
      counts.full += 1;
      return filterCadDisplaySceneForViewport(project, scene);
    },
    derivedFilter: (project, base, patch) => {
      counts.derived += 1;
      return filterCadDerivedLayersForViewport(project, base, patch);
    },
  };
};

export interface CountedFinds {
  finds: number;
}

/**
 * Proxy a readonly row array so every `.find` use is counted. All other
 * access (iteration, length, index) forwards untouched, so indexed Map-based
 * code paths behave identically.
 */
export const withCountedFinds = <T>(
  rows: readonly T[] | undefined,
  counter: CountedFinds,
): readonly T[] | undefined => {
  if (rows === undefined) return undefined;
  const list = rows as T[];
  return new Proxy(list, {
    get(target, property, receiver) {
      if (property === 'find') counter.finds += 1;
      return Reflect.get(target, property, receiver);
    },
  });
};

export interface CountedProject {
  project: CadProject;
  counter: CountedFinds;
}

/** Wrap a project's lookup arrays so legacy `.find` scans become countable. */
export const withCountedProjectFinds = (project: CadProject): CountedProject => {
  const counter: CountedFinds = { finds: 0 };
  return {
    project: {
      ...project,
      layers: withCountedFinds(project.layers, counter) as CadProject['layers'],
      entities: withCountedFinds(project.entities, counter) as CadProject['entities'],
      analysisLegends: withCountedFinds(project.analysisLegends, counter) as CadProject['analysisLegends'],
      analysisMaps: withCountedFinds(project.analysisMaps, counter) as CadProject['analysisMaps'],
    },
    counter,
  };
};
