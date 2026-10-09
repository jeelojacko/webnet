/** @vitest-environment jsdom */
/**
 * STRUCT-194.8 — session-result retirement hooks.
 *
 * Real hooks mounted through tiny harnesses with fake services (no worker):
 *   - `useSurveyCadAnalysisVolumeRetirement`: analysis map / legend / volume
 *     retirement, selected-id clears, no double eviction, no spurious cancel
 *     on same-id edits or repeat renders, drawing-switch retirement.
 *   - `useSurveyCadProfileSectionRetirement`: profile + sample-line-group
 *     retirement and the paired group/line selection clear.
 *   - `useSurveyCadSurfaceRetirement`: functional session-mesh updater
 *     (invalidate + contour cancel only for retired revisions, previous
 *     reference when nothing was deleted).
 *
 * Fast + deterministic; agent tier.
 */
import React, { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  useSurveyCadAnalysisVolumeRetirement,
  type SurveyCadAnalysisVolumeRetirementArgs,
} from '../src/hooks/surveyCad/useSurveyCadAnalysisVolumeRetirement';
import {
  useSurveyCadProfileSectionRetirement,
  type SurveyCadProfileSectionRetirementArgs,
} from '../src/hooks/surveyCad/useSurveyCadProfileSectionRetirement';
import {
  useSurveyCadSurfaceRetirement,
  type SurveyCadSurfaceRetirementArgs,
} from '../src/hooks/surveyCad/useSurveyCadSurfaceRetirement';
import type { CadProject } from '../src/engine/cad/cadTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface IdRow {
  id: string;
  [key: string]: unknown;
}

const ids = (entries: IdRow[]): IdRow[] => entries;

interface Mounted {
  root: Root;
  container: HTMLElement;
  set: (_element: React.ReactElement) => Promise<void>;
}

const mounted: Mounted[] = [];

const mount = async (element: React.ReactElement): Promise<Mounted> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
  const view: Mounted = {
    root,
    container,
    set: async (next) => {
      await act(async () => {
        root.render(next);
      });
    },
  };
  mounted.push(view);
  return view;
};

afterEach(async () => {
  for (const view of mounted.splice(0)) {
    await act(async () => {
      view.root.unmount();
    });
    view.container.remove();
  }
});

/** Plain mutable holder (not a ref) populated from a hook-observing harness. */
const holder = <T,>(): { value: T | null } => ({ value: null });

// ---------------------------------------------------------------------------
// useSurveyCadAnalysisVolumeRetirement
// ---------------------------------------------------------------------------

const AnalysisVolumeHarness: React.FC<{ args: SurveyCadAnalysisVolumeRetirementArgs }> = ({ args }) => {
  useSurveyCadAnalysisVolumeRetirement(args);
  return null;
};

interface AnalysisVolumeSpies {
  analysis: ReturnType<typeof vi.fn>;
  volume: ReturnType<typeof vi.fn>;
  setAnalysisId: ReturnType<typeof vi.fn>;
  setLegendId: ReturnType<typeof vi.fn>;
  setVolumeId: ReturnType<typeof vi.fn>;
}

const analysisVolumeSpies = (): AnalysisVolumeSpies => ({
  analysis: vi.fn(),
  volume: vi.fn(),
  setAnalysisId: vi.fn(),
  setLegendId: vi.fn(),
  setVolumeId: vi.fn(),
});

const analysisVolumeArgs = (
  spies: AnalysisVolumeSpies,
  overrides: Partial<SurveyCadAnalysisVolumeRetirementArgs> = {},
): SurveyCadAnalysisVolumeRetirementArgs => ({
  analysisMaps: ids([{ id: 'a1' }, { id: 'a2' }]) as unknown as CadProject['analysisMaps'],
  analysisPlane: { handleAnalysisDeleted: spies.analysis } as never,
  selectedAnalysisId: 'a1',
  setSelectedAnalysisId: spies.setAnalysisId as never,
  analysisLegends: ids([{ id: 'l1' }]) as unknown as CadProject['analysisLegends'],
  selectedAnalysisLegendId: 'l1',
  setSelectedAnalysisLegendId: spies.setLegendId as never,
  volumeSurfaces: ids([{ id: 'v1' }, { id: 'v2' }]) as unknown as CadProject['volumeSurfaces'],
  volumeService: { handleVolumeDeleted: spies.volume } as never,
  selectedVolumeId: 'v1',
  setSelectedVolumeId: spies.setVolumeId as never,
  ...overrides,
});

describe('STRUCT-194.8 useSurveyCadAnalysisVolumeRetirement', () => {
  it('retires exactly the removed analysis map / legend / volume and clears the deleted selection', async () => {
    const spies = analysisVolumeSpies();
    const args = analysisVolumeArgs(spies);
    const view = await mount(<AnalysisVolumeHarness args={args} />);
    // First render only seeds the known set.
    expect(spies.analysis).not.toHaveBeenCalled();

    await view.set(<AnalysisVolumeHarness args={analysisVolumeArgs(spies, {
      analysisMaps: ids([{ id: 'a1' }]) as unknown as CadProject['analysisMaps'],
    })} />);
    expect(spies.analysis).toHaveBeenCalledTimes(1);
    expect(spies.analysis).toHaveBeenCalledWith('a2');

    await view.set(<AnalysisVolumeHarness args={analysisVolumeArgs(spies, {
      analysisMaps: ids([{ id: 'a1' }]) as unknown as CadProject['analysisMaps'],
      analysisLegends: [] as unknown as CadProject['analysisLegends'],
    })} />);
    expect(spies.setLegendId).toHaveBeenCalledWith(null);
    expect(spies.volume).not.toHaveBeenCalled();

    // No-op repeat render must not evict again.
    await view.set(<AnalysisVolumeHarness args={analysisVolumeArgs(spies, {
      analysisMaps: ids([{ id: 'a1' }]) as unknown as CadProject['analysisMaps'],
      analysisLegends: [] as unknown as CadProject['analysisLegends'],
    })} />);
    expect(spies.analysis).toHaveBeenCalledTimes(1);
  });

  it('does not cancel on a same-id edit or repeated renders', async () => {
    const spies = analysisVolumeSpies();
    const view = await mount(<AnalysisVolumeHarness args={analysisVolumeArgs(spies)} />);
    await view.set(<AnalysisVolumeHarness args={analysisVolumeArgs(spies, {
      analysisMaps: ids([{ id: 'a1', name: 'edited' }, { id: 'a2' }]) as unknown as CadProject['analysisMaps'],
    })} />);
    await view.set(<AnalysisVolumeHarness args={analysisVolumeArgs(spies)} />);
    expect(spies.analysis).not.toHaveBeenCalled();
  });

  it('retires every previously-known id once on a drawing switch', async () => {
    const spies = analysisVolumeSpies();
    const view = await mount(<AnalysisVolumeHarness args={analysisVolumeArgs(spies)} />);
    await view.set(<AnalysisVolumeHarness args={analysisVolumeArgs(spies, {
      analysisMaps: ids([{ id: 'b1' }]) as unknown as CadProject['analysisMaps'],
      selectedAnalysisId: 'b1',
      analysisLegends: [] as unknown as CadProject['analysisLegends'],
      selectedAnalysisLegendId: null,
      volumeSurfaces: ids([{ id: 'w1' }]) as unknown as CadProject['volumeSurfaces'],
      selectedVolumeId: 'w1',
    })} />);
    expect(spies.analysis.mock.calls.map((call) => call[0]).sort()).toEqual(['a1', 'a2']);
    expect(spies.volume.mock.calls.map((call) => call[0]).sort()).toEqual(['v1', 'v2']);
  });
});

// ---------------------------------------------------------------------------
// useSurveyCadProfileSectionRetirement
// ---------------------------------------------------------------------------

const ProfileSectionHarness: React.FC<{ args: SurveyCadProfileSectionRetirementArgs }> = ({ args }) => {
  useSurveyCadProfileSectionRetirement(args);
  return null;
};

interface ProfileSectionSpies {
  profile: ReturnType<typeof vi.fn>;
  section: ReturnType<typeof vi.fn>;
  setProfileId: ReturnType<typeof vi.fn>;
  setGroupId: ReturnType<typeof vi.fn>;
  setLineId: ReturnType<typeof vi.fn>;
}

const profileSectionSpies = (): ProfileSectionSpies => ({
  profile: vi.fn(),
  section: vi.fn(),
  setProfileId: vi.fn(),
  setGroupId: vi.fn(),
  setLineId: vi.fn(),
});

const profileSectionArgs = (
  spies: ProfileSectionSpies,
  overrides: Partial<SurveyCadProfileSectionRetirementArgs> = {},
): SurveyCadProfileSectionRetirementArgs => ({
  surfaceProfiles: ids([{ id: 'p1' }, { id: 'p2' }]) as unknown as CadProject['surfaceProfiles'],
  profileService: { handleProfileDeleted: spies.profile } as never,
  selectedProfileId: 'p1',
  setSelectedProfileId: spies.setProfileId as never,
  sampleLineGroups: ids([{ id: 'g1' }]) as unknown as CadProject['sampleLineGroups'],
  sectionService: { handleGroupDeleted: spies.section } as never,
  selectedSampleLineGroupId: 'g1',
  setSelectedSampleLineGroupId: spies.setGroupId as never,
  setSelectedSampleLineId: spies.setLineId as never,
  ...overrides,
});

describe('STRUCT-194.8 useSurveyCadProfileSectionRetirement', () => {
  it('retires removed profiles and sample-line groups and clears their selections', async () => {
    const spies = profileSectionSpies();
    const view = await mount(<ProfileSectionHarness args={profileSectionArgs(spies)} />);
    await view.set(<ProfileSectionHarness args={profileSectionArgs(spies, {
      surfaceProfiles: ids([{ id: 'p1' }]) as unknown as CadProject['surfaceProfiles'],
      selectedProfileId: 'p2',
      sampleLineGroups: [] as unknown as CadProject['sampleLineGroups'],
    })} />);
    expect(spies.profile).toHaveBeenCalledTimes(1);
    expect(spies.profile).toHaveBeenCalledWith('p2');
    expect(spies.setProfileId).toHaveBeenCalledWith(null);
    expect(spies.section).toHaveBeenCalledTimes(1);
    expect(spies.section).toHaveBeenCalledWith('g1');
    expect(spies.setGroupId).toHaveBeenCalledWith(null);
    expect(spies.setLineId).toHaveBeenCalledWith(null);
  });

  it('does not evict on a same-id edit or repeated renders', async () => {
    const spies = profileSectionSpies();
    const view = await mount(<ProfileSectionHarness args={profileSectionArgs(spies)} />);
    await view.set(<ProfileSectionHarness args={profileSectionArgs(spies, {
      surfaceProfiles: ids([{ id: 'p1', name: 'edited' }, { id: 'p2' }]) as unknown as CadProject['surfaceProfiles'],
      sampleLineGroups: ids([{ id: 'g1', name: 'edited' }]) as unknown as CadProject['sampleLineGroups'],
    })} />);
    expect(spies.profile).not.toHaveBeenCalled();
    expect(spies.section).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// useSurveyCadSurfaceRetirement
// ---------------------------------------------------------------------------

const SurfaceHarness: React.FC<{
  surfaces: CadProject['surfaces'];
  surfaceCache: { invalidate: (_id: string) => void };
  contourService: { handleSurfaceDeleted: (_id: string) => void };
  onSessions: (_sessions: Record<string, string[]>) => void;
  initial: Record<string, string[]>;
}> = ({ surfaces, surfaceCache, contourService, onSessions, initial }) => {
  const [sessions, setSessions] = useState(initial);
  useEffect(() => {
    onSessions(sessions);
  }, [sessions, onSessions]);
  const args: SurveyCadSurfaceRetirementArgs = {
    surfaces,
    setSurfaceMeshSessions: setSessions,
    surfaceCache: surfaceCache as never,
    contourService: contourService as never,
  };
  useSurveyCadSurfaceRetirement(args);
  return null;
};

const surfacesOf = (entries: IdRow[]): CadProject['surfaces'] =>
  entries as unknown as CadProject['surfaces'];

describe('STRUCT-194.8 useSurveyCadSurfaceRetirement', () => {
  it('invalidates + cancels only retired revisions and returns the previous record otherwise', async () => {
    const surfaceCache = { invalidate: vi.fn() };
    const contourService = { handleSurfaceDeleted: vi.fn() };
    const initial = { s1: ['r1'], s2: ['r2'] };
    const box = holder<Record<string, string[]>>();
    const onSessions = (sessions: Record<string, string[]>): void => {
      box.value = sessions;
    };
    const view = await mount(
      <SurfaceHarness
        surfaces={surfacesOf([{ id: 's1' }, { id: 's2' }])}
        surfaceCache={surfaceCache}
        contourService={contourService}
        onSessions={onSessions}
        initial={initial}
      />,
    );
    // Nothing retired yet: the updater returns the SAME reference.
    expect(box.value).toBe(initial);

    await view.set(
      <SurfaceHarness
        surfaces={surfacesOf([{ id: 's1' }])}
        surfaceCache={surfaceCache}
        contourService={contourService}
        onSessions={onSessions}
        initial={initial}
      />,
    );
    expect(box.value).toEqual({ s1: ['r1'] });
    expect(surfaceCache.invalidate).toHaveBeenCalledTimes(1);
    expect(surfaceCache.invalidate).toHaveBeenCalledWith('s2');
    expect(contourService.handleSurfaceDeleted).toHaveBeenCalledTimes(1);
    expect(contourService.handleSurfaceDeleted).toHaveBeenCalledWith('s2');

    // Repeat render with the same live set: no double eviction, previous ref kept.
    const steady = box.value;
    await view.set(
      <SurfaceHarness
        surfaces={surfacesOf([{ id: 's1' }])}
        surfaceCache={surfaceCache}
        contourService={contourService}
        onSessions={onSessions}
        initial={initial}
      />,
    );
    expect(box.value).toBe(steady);
    expect(surfaceCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contourService.handleSurfaceDeleted).toHaveBeenCalledTimes(1);
  });

  it('retires on delete and does not re-add or mis-cancel on undo restoration', async () => {
    const surfaceCache = { invalidate: vi.fn() };
    const contourService = { handleSurfaceDeleted: vi.fn() };
    const box = holder<Record<string, string[]>>();
    const onSessions = (sessions: Record<string, string[]>): void => {
      box.value = sessions;
    };
    const view = await mount(
      <SurfaceHarness
        surfaces={surfacesOf([{ id: 's1' }])}
        surfaceCache={surfaceCache}
        contourService={contourService}
        onSessions={onSessions}
        initial={{ s1: ['r1'] }}
      />,
    );
    await view.set(
      <SurfaceHarness
        surfaces={surfacesOf([])}
        surfaceCache={surfaceCache}
        contourService={contourService}
        onSessions={onSessions}
        initial={{ s1: ['r1'] }}
      />,
    );
    expect(box.value).toEqual({});
    expect(surfaceCache.invalidate).toHaveBeenCalledWith('s1');
    expect(contourService.handleSurfaceDeleted).toHaveBeenCalledWith('s1');

    // Undo restores the definition but the session mesh stays retired (no re-add,
    // no new cancel for the unrelated surface).
    await view.set(
      <SurfaceHarness
        surfaces={surfacesOf([{ id: 's1' }])}
        surfaceCache={surfaceCache}
        contourService={contourService}
        onSessions={onSessions}
        initial={{ s1: ['r1'] }}
      />,
    );
    expect(box.value).toEqual({});
    expect(surfaceCache.invalidate).toHaveBeenCalledTimes(1);
    expect(contourService.handleSurfaceDeleted).toHaveBeenCalledTimes(1);
  });
});
