/** @vitest-environment jsdom */
/**
 * CAD Best Fit E1 (Worker C) — session tests.
 *
 * Covers the shared sample collector (viewport picks with survey-point
 * attribution, typed coordinates, duplicate rejection), U backstep, the
 * Enter minimum gate, failure-stays-active, Escape cancellation, prompt
 * count/minimum law, preseed law, preview gating, registry aliases, and
 * dock autocomplete suppression while a Best Fit session is active.
 */
import React, { useState } from 'react';
import { act } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

import { CadCommandDock } from '../src/cad-app/shell/CadCommandDock';
import { createCadShellLink } from '../src/cad-app/shell/cadShellLink';
import type { CadShellActions, CadWorkspaceSnapshot } from '../src/cad-app/shell/cadShellTypes';
import {
  CAD_SHELL_COMMANDS,
  resolveShellCommandText,
} from '../src/cad-app/shell/cadCommandRegistry';
import { createBlankCadDrawingDocument } from '../src/engine/cad/cadDrawingFile';
import type { CadEntity, CadProject, CadSurveyPointEntity } from '../src/engine/cad/cadTypes';
import {
  createCadHistoryState,
  type CadHistoryState,
} from '../src/engine/cad/cadUndoRedo';
import { buildSurveyCadCommandAvailability } from '../src/hooks/surveyCad/useSurveyCadCommandAvailability';
import { bestFitPreviewForSession } from '../src/hooks/surveyCad/useSurveyCadBestFitPreview';
import {
  appendBestFitSample,
  backstepBestFitSample,
  bestFitMinSamples,
  buildBestFitPreseedSamples,
  commitBestFitSession,
  handleBestFitPointPick,
  handleBestFitTypedSubmit,
  type BestFitCommandSession,
} from '../src/hooks/surveyCad/useSurveyCadBestFitSession';
import { handleSurveyCadConsumePoint } from '../src/hooks/surveyCad/useSurveyCadConsumePoint';
import { sessionExpectsPointPick } from '../src/hooks/surveyCad/useSurveyCadCommandSession';
import { promptForSession } from '../src/hooks/surveyCad/useSurveyCadCommandText';
import type { CommandPoint, CommandSession } from '../src/hooks/surveyCad/useSurveyCadCommandTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const point = (x: number, y: number, label = `${x},${y}`): CommandPoint => ({ x, y, label });

const surveyPoint = (id: string, stationId: string, x: number, y: number): CadSurveyPointEntity => ({
  id,
  type: 'survey-point',
  layerId: 'general',
  visible: true,
  locked: false,
  x,
  y,
  stationId,
  pointClass: 'free',
  source: 'parsed-input',
});

const projectWith = (entities: CadEntity[]): CadProject => {
  const drawing = createBlankCadDrawingDocument({ name: 'best fit sessions', units: 'm' });
  return { ...drawing.project, entities: [...drawing.project.entities, ...entities] };
};

const blankHistory = (project: CadProject): CadHistoryState => createCadHistoryState(project);

const lineSession = (over?: Partial<BestFitCommandSession>): BestFitCommandSession => ({
  key: 'BESTFITLINE',
  inputValue: '',
  samples: [],
  ...over,
});

const consumeBestFit = (
  history: CadHistoryState,
  session: BestFitCommandSession,
  next: CommandPoint,
): { history: CadHistoryState; current: BestFitCommandSession; updates: number } => {
  let current: CommandSession | null = session;
  let updates = 0;
  handleSurveyCadConsumePoint({
    applyHistoryUpdate: (updater) => {
      updates += 1;
      history = updater(history);
    },
    commitArcDefinition: () => false,
    current: session,
    history,
    point: next,
    projectStationIds: [],
    publishReport: () => undefined,
    replaceSession: (nextSession) => {
      current = nextSession;
    },
    reverseDirectionModifier: false,
  });
  if (current == null || current.key !== session.key) throw new Error('best-fit session lost');
  return { history, current: current as BestFitCommandSession, updates };
};

const submitTyped = (
  history: CadHistoryState,
  session: BestFitCommandSession,
  inputValue: string,
): { history: CadHistoryState; current: CommandSession | null; updates: number } => {
  let current: CommandSession | null = session;
  let updates = 0;
  const withInput = { ...session, inputValue };
  const consumed: CommandPoint[] = [];
  const handled = handleBestFitTypedSubmit({
    consumePoint: (parsed) => {
      consumed.push(parsed);
    },
    replaceSession: (next) => {
      current = next;
    },
    session: withInput,
  });
  expect(handled).toBe(true);
  for (const parsed of consumed) {
    const result = consumeBestFit(history, current as BestFitCommandSession, parsed);
    history = result.history;
    current = result.current;
    updates += result.updates;
  }
  return { history, current, updates };
};

describe('best-fit registry', () => {
  it('resolves the three keys as sessions with collision-free aliases', () => {
    expect(resolveShellCommandText('BESTFITLINE')?.kind).toBe('session');
    expect(resolveShellCommandText('BESTFITARC')?.kind).toBe('session');
    expect(resolveShellCommandText('BESTFITPARABOLA')?.kind).toBe('session');
    expect(resolveShellCommandText('BFL')?.key).toBe('BESTFITLINE');
    expect(resolveShellCommandText('BFA')?.key).toBe('BESTFITARC');
    expect(resolveShellCommandText('BFP')?.key).toBe('BESTFITPARABOLA');
    expect(resolveShellCommandText('bfl')?.key).toBe('BESTFITLINE');
    for (const alias of ['BFL', 'BFA', 'BFP']) {
      const claimants = CAD_SHELL_COMMANDS.filter((def) =>
        def.aliases.some((entry) => entry.toUpperCase() === alias),
      );
      expect(claimants).toHaveLength(1);
    }
  });

  it('pins the minimum gates (line 2, arc 3, parabola 5)', () => {
    expect(bestFitMinSamples('BESTFITLINE')).toBe(2);
    expect(bestFitMinSamples('BESTFITARC')).toBe(3);
    expect(bestFitMinSamples('BESTFITPARABOLA')).toBe(5);
  });

  it('all sessions expect a point pick', () => {
    for (const key of ['BESTFITLINE', 'BESTFITARC', 'BESTFITPARABOLA'] as const) {
      expect(sessionExpectsPointPick(lineSession({ key }))).toBe(true);
    }
  });
});

describe('best-fit sample collection', () => {
  it('attributes survey-point snaps to the station id', () => {
    const project = projectWith([surveyPoint('pt-a', 'A1', 10, 20)]);
    const history = blankHistory(project);
    const picked: CommandPoint = {
      x: 10,
      y: 20,
      label: 'A1',
      snapSourceEntityId: 'pt-a',
      snapKind: 'point-node',
    };
    const result = consumeBestFit(history, lineSession(), picked);
    expect(result.current.samples).toHaveLength(1);
    expect(result.current.samples[0]).toMatchObject({
      x: 10,
      y: 20,
      label: 'A1',
      labelIsStationId: true,
      snapSourceEntityId: 'pt-a',
    });
    // Collecting never writes to the model.
    expect(result.updates).toBe(0);
    expect(result.history.present.project.entities).toHaveLength(1);
  });

  it('labels free clicks P<n> and never fabricates station ids', () => {
    const project = projectWith([]);
    const history = blankHistory(project);
    let current = lineSession();
    for (const [x, y] of [[0, 0], [10, 5], [20, 3]] as const) {
      const result = consumeBestFit(history, current, point(x, y));
      current = result.current;
    }
    expect(current.samples.map((sample) => sample.label)).toEqual(['P1', 'P2', 'P3']);
    expect(current.samples.every((sample) => sample.labelIsStationId !== true)).toBe(true);
  });

  it('keeps typed LABEL= while auto-numbering bare coordinates', () => {
    const project = projectWith([]);
    const history = blankHistory(project);
    const first = submitTyped(history, lineSession(), 'HOME=5,5');
    expect((first.current as BestFitCommandSession).samples[0]?.label).toBe('HOME');
    const second = submitTyped(first.history, first.current as BestFitCommandSession, '15,7');
    expect((second.current as BestFitCommandSession).samples.map((sample) => sample.label)).toEqual([
      'HOME',
      'P1',
    ]);
  });

  it('accepts @azimuth,distance relative to the last sample', () => {
    const project = projectWith([]);
    const history = blankHistory(project);
    const first = submitTyped(history, lineSession(), '0,0');
    const second = submitTyped(first.history, first.current as BestFitCommandSession, '@90,10');
    const samples = (second.current as BestFitCommandSession).samples;
    expect(samples).toHaveLength(2);
    expect(samples[1]!.x).toBeCloseTo(10, 6);
    expect(samples[1]!.y).toBeCloseTo(0, 6);
  });

  it('rejects duplicate sources and near-XY repeats without consuming', () => {
    const project = projectWith([surveyPoint('pt-a', 'A1', 10, 20)]);
    const history = blankHistory(project);
    const seeded = consumeBestFit(history, lineSession(), {
      x: 10,
      y: 20,
      label: 'A1',
      snapSourceEntityId: 'pt-a',
      snapKind: 'point-node',
    });
    const repeated = consumeBestFit(seeded.history, seeded.current, {
      x: 10.5,
      y: 20.5,
      label: 'nearby',
      snapSourceEntityId: 'pt-a',
      snapKind: 'point-node',
    });
    expect(repeated.current.samples).toHaveLength(1);
    expect(repeated.current.resultText).toContain('same source');
    const duplicateXy = consumeBestFit(repeated.history, repeated.current, point(10, 20));
    expect(duplicateXy.current.samples).toHaveLength(1);
    expect(duplicateXy.current.resultText).toContain('same location');
  });

  it('rejects invalid typed input and stays active', () => {
    const project = projectWith([]);
    const history = blankHistory(project);
    const result = submitTyped(history, lineSession(), 'not-a-point');
    const current = result.current as BestFitCommandSession;
    expect(current.samples).toHaveLength(0);
    expect(current.resultText).toContain('sample invalid');
  });

  it('backsteps with U without touching model history', () => {
    const project = projectWith([]);
    const history = blankHistory(project);
    let current = lineSession();
    for (const [x, y] of [[0, 0], [10, 0]] as const) {
      current = consumeBestFit(history, current, point(x, y)).current;
    }
    const stepped = backstepBestFitSample(current);
    expect(stepped.samples.map((sample) => sample.label)).toEqual(['P1']);
    const empty = backstepBestFitSample(backstepBestFitSample(stepped));
    expect(empty.samples).toHaveLength(0);
    expect(empty.resultText).toContain('nothing to undo');
  });

  it('U via typed input removes the newest sample', () => {
    const project = projectWith([]);
    const history = blankHistory(project);
    const seeded = consumeBestFit(history, lineSession(), point(0, 0)).current;
    const result = submitTyped(history, seeded, 'U');
    expect((result.current as BestFitCommandSession).samples).toHaveLength(0);
  });
});

describe('best-fit commit gates', () => {
  it('refuses Enter below the minimum and stays active', () => {
    const project = projectWith([]);
    let history = blankHistory(project);
    const session = lineSession({ samples: [point(0, 0, 'P1')] });
    let current: CommandSession | null = session;
    let updates = 0;
    const committed = commitBestFitSession({
      applyHistoryUpdate: (updater) => {
        updates += 1;
        history = updater(history);
      },
      replaceSession: (next) => {
        current = next;
      },
      session,
    });
    expect(committed).toBe(false);
    expect(current).not.toBeNull();
    expect((current as BestFitCommandSession).resultText).toContain('at least 2 samples');
    // The minimum gate refuses before the history is even touched.
    expect(updates).toBe(0);
    expect(history.present.project.entities).toHaveLength(0);
    expect(history.undoStack).toHaveLength(0);
  });

  it('commits at the minimum and closes the session', () => {
    const project = projectWith([]);
    let history = blankHistory(project);
    const session = lineSession({
      samples: [point(0, 0, 'P1'), point(10, 10, 'P2'), point(20, 19, 'P3')],
    });
    let current: CommandSession | null = session;
    const reported: string[] = [];
    const committed = commitBestFitSession({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      replaceSession: (next) => {
        current = next;
      },
      reportComputation: (computation) => {
        reported.push(computation.toolKey);
      },
      session,
    });
    expect(committed).toBe(true);
    expect(current).toBeNull();
    expect(history.present.project.entities).toHaveLength(1);
    expect(history.undoStack).toHaveLength(1);
    // The stored residual computation (not a synthetic second) is forwarded.
    expect(reported).toEqual(['BEST_FIT_LINE']);
  });

  it('a failed solve stays active with the reason and zero mutation', () => {
    const project = projectWith([]);
    let history = blankHistory(project);
    const session: BestFitCommandSession = {
      key: 'BESTFITARC',
      inputValue: '',
      samples: [point(0, 0, 'P1'), point(10, 0, 'P2'), point(20, 0, 'P3')],
    };
    let current: CommandSession | null = session;
    const committed = commitBestFitSession({
      applyHistoryUpdate: (updater) => {
        history = updater(history);
      },
      replaceSession: (next) => {
        current = next;
      },
      session,
    });
    expect(committed).toBe(false);
    expect(current).not.toBeNull();
    expect((current as BestFitCommandSession).resultText).toContain('could not fit');
    expect(history.present.project.entities).toHaveLength(0);
    expect(history.undoStack).toHaveLength(0);
  });

  it('canFinishCommand follows the minimum gate', () => {
    const below = lineSession({ samples: [point(0, 0, 'P1')] });
    expect(
      buildSurveyCadCommandAvailability({ activeSnap: null, commandExpectsPointPick: true, session: below }).canFinishCommand,
    ).toBe(false);
    const ready = lineSession({ samples: [point(0, 0, 'P1'), point(1, 1, 'P2')] });
    expect(
      buildSurveyCadCommandAvailability({ activeSnap: null, commandExpectsPointPick: true, session: ready }).canFinishCommand,
    ).toBe(true);
  });
});

describe('best-fit prompt and preseed', () => {
  it('always shows count and minimum', () => {
    expect(promptForSession(lineSession(), '')).toContain('minimum 2');
    const partial = lineSession({ samples: [point(0, 0, 'P1')] });
    expect(promptForSession(partial, '')).toContain('1 sample');
    expect(promptForSession(partial, '')).toContain('minimum 2');
    const arc: BestFitCommandSession = { key: 'BESTFITARC', inputValue: '', samples: [] };
    expect(promptForSession(arc, '')).toContain('minimum 3');
    const parabola: BestFitCommandSession = { key: 'BESTFITPARABOLA', inputValue: '', samples: [] };
    expect(promptForSession(parabola, '')).toContain('minimum 5');
  });

  it('preseeds only when every selected entity is a survey point', () => {
    const project = projectWith([
      surveyPoint('pt-a', 'A1', 0, 0),
      surveyPoint('pt-b', 'A2', 10, 10),
    ]);
    const full = buildBestFitPreseedSamples(project, ['pt-a', 'pt-b']);
    expect(full.skippedNonPointSelection).toBe(false);
    expect(full.samples.map((sample) => sample.label)).toEqual(['A1', 'A2']);
    expect(full.samples.every((sample) => sample.labelIsStationId === true)).toBe(true);
    const mixed = buildBestFitPreseedSamples(
      {
        ...project,
        entities: [
          ...project.entities,
          {
            id: 'line-1',
            type: 'line',
            layerId: 'general',
            visible: true,
            locked: false,
            fromStationId: 'A1',
            toStationId: 'A2',
          } as unknown as CadEntity,
        ],
      },
      ['pt-a', 'line-1'],
    );
    expect(mixed.samples).toHaveLength(0);
    expect(mixed.skippedNonPointSelection).toBe(true);
    expect(buildBestFitPreseedSamples(project, []).samples).toHaveLength(0);
  });

  it('direct append keeps station attribution and rejects repeats', () => {
    const project = projectWith([surveyPoint('pt-a', 'A1', 4, 5)]);
    const appended = appendBestFitSample(lineSession(), {
      x: 4,
      y: 5,
      label: 'A1',
      snapSourceEntityId: 'pt-a',
      snapKind: 'point-node',
    }, project);
    expect(appended.samples[0]).toMatchObject({ label: 'A1', labelIsStationId: true });
    const repicked = handleBestFitPointPick({
      current: appended,
      point: { x: 4.1, y: 5.1, label: 'x', snapSourceEntityId: 'pt-a', snapKind: 'point-node' },
      project,
      replaceSession: () => undefined,
    });
    expect(repicked).toBe(true);
  });
});

describe('best-fit preview', () => {
  it('stays null below the minimum and draws fit plus residuals at/above it', () => {
    const below = lineSession({ samples: [point(0, 0, 'P1')] });
    expect(bestFitPreviewForSession(below)).toBeNull();
    const ready = lineSession({
      samples: [point(0, 0, 'P1'), point(10, 10, 'P2'), point(20, 19, 'P3')],
    });
    const preview = bestFitPreviewForSession(ready);
    expect(preview?.kind).toBe('primitives');
    if (preview?.kind !== 'primitives') throw new Error('expected primitives');
    // 1 fitted line + 3 residual vectors, none persisted to any layer.
    expect(preview.primitives).toHaveLength(4);
    expect(preview.primitives.every((primitive) => primitive.layerId === 'preview')).toBe(true);
  });

  it('previews arcs and parabolas with residuals', () => {
    const arc: BestFitCommandSession = {
      key: 'BESTFITARC',
      inputValue: '',
      samples: [point(10, 0, 'P1'), point(0, 10, 'P2'), point(-10, 0, 'P3')],
    };
    const arcPreview = bestFitPreviewForSession(arc);
    expect(arcPreview?.kind).toBe('primitives');
    if (arcPreview?.kind !== 'primitives') throw new Error('expected primitives');
    expect(arcPreview.primitives[0]?.kind).toBe('arc');
    expect(arcPreview.primitives).toHaveLength(4);
    const parabola: BestFitCommandSession = {
      key: 'BESTFITPARABOLA',
      inputValue: '',
      samples: [0, 1, 2, 3, 4].map((index) => point(index, index * index, `P${index + 1}`)),
    };
    const parabolaPreview = bestFitPreviewForSession(parabola);
    expect(parabolaPreview?.kind).toBe('primitives');
    if (parabolaPreview?.kind !== 'primitives') throw new Error('expected primitives');
    expect(parabolaPreview.primitives.length).toBeGreaterThan(5);
  });
});

describe('best-fit dock behavior', () => {
  const snapshot = (over: Partial<CadWorkspaceSnapshot> = {}): CadWorkspaceSnapshot =>
    ({
      availableCommands: ['BESTFITLINE', 'BESTFITARC', 'BESTFITPARABOLA', 'LINE'],
      activeCommandKey: null,
      commandPrompt: 'Idle.',
      commandInputValue: '',
      ...over,
    }) as CadWorkspaceSnapshot;

  const shellActions = (): CadShellActions =>
    ({
      startCommand: vi.fn(() => true),
      submitSessionText: vi.fn(),
      confirmCommandInput: vi.fn(),
      cancelCommand: vi.fn(),
    }) as unknown as CadShellActions;

  const render = async (node: ReactNode): Promise<{ container: HTMLElement; root: Root }> => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(node);
    });
    return { container, root };
  };

  const DockHarness: React.FC<{ over?: Partial<CadWorkspaceSnapshot> }> = ({ over }) => {
    const [sessionValue, setSessionValue] = useState((over?.commandInputValue as string) ?? '');
    const link = React.useMemo(() => createCadShellLink(), []);
    const wired = React.useMemo(
      () => ({ ...shellActions(), setSessionInputValue: setSessionValue }),
      [],
    );
    return (
      <CadCommandDock
        link={link}
        actionsOverride={wired}
        snapshot={snapshot({ ...over, commandInputValue: sessionValue })}
        heightPx={200}
        onResize={() => {}}
      />
    );
  };

  const setInputValue = (element: HTMLInputElement, value: string): void => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  };

  it('suppresses autocomplete while a Best Fit session is active', async () => {
    const { container, root } = await render(
      <DockHarness over={{ activeCommandKey: 'BESTFITLINE', commandInputValue: '12,34' }} />,
    );
    const field = container.querySelector('[data-cad-command-input]') as HTMLInputElement;
    await act(async () => {
      setInputValue(field, 'BFA');
    });
    expect(container.querySelector('[role="listbox"]')).toBeNull();
    expect(container.querySelectorAll('[data-cad-command-suggestion]')).toHaveLength(0);
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
