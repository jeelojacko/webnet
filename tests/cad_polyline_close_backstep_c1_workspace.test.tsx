/** @vitest-environment jsdom */

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import {
  SurveyCadWorkspace,
  input,
  parseOptions,
  setTextInputValue,
  pressKey,
  clickButton,
  createPersistedStateCapture,
} from './surveyCadWorkspace/surveyCadWorkspaceTestSupport';
import type { CadPolylineEntity } from '../src/engine/cad/cadTypes';

interface Boot {
  container: HTMLElement;
  root: Root;
  capture: ReturnType<typeof createPersistedStateCapture>;
  commandInput: () => HTMLInputElement;
  status: () => string;
  entityCount: () => number;
  lastPolyline: () => CadPolylineEntity | undefined;
}

const boot = async (): Promise<Boot> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const capture = createPersistedStateCapture();
  await act(async () => {
    root.render(
      <SurveyCadWorkspace
        input={input}
        instrumentLibrary={{}}
        parseOptions={parseOptions}
        units="m"
        result={null}
        onPersistedStateChange={capture.onPersistedStateChange}
      />,
    );
  });
  return {
    container,
    root,
    capture,
    commandInput: () =>
      container.querySelector('[data-survey-cad-command-input]') as HTMLInputElement,
    status: () =>
      container.querySelector('[data-survey-cad-command-status]')?.textContent ?? '',
    entityCount: () =>
      Number.parseInt(
        container.querySelector('[data-survey-cad-entity-count]')?.textContent ?? '0',
        10,
      ),
    lastPolyline: () =>
      capture
        .read()
        ?.project.entities.filter(
          (entity): entity is CadPolylineEntity => entity.type === 'polyline',
        )
        .at(-1),
  };
};

const typePoint = async (ctx: Boot, value: string): Promise<void> => {
  await act(async () => {
    setTextInputValue(ctx.commandInput(), value);
    pressKey(ctx.commandInput(), 'Enter');
  });
};

const shutdown = async (ctx: Boot): Promise<void> => {
  await act(async () => {
    ctx.root.unmount();
  });
  ctx.container.remove();
};

describe('C1 workspace: PLINE close and session backstep', () => {
  it('A: empty Enter commits an open polyline with 3 vertices', async () => {
    const ctx = await boot();
    const before = ctx.entityCount();
    await act(async () => {
      clickButton(ctx.container, 'PLINE');
    });
    await typePoint(ctx, '0,0');
    await typePoint(ctx, '20,10');
    await typePoint(ctx, 'N45-00-00E,20');
    await typePoint(ctx, '');
    expect(ctx.status()).toContain('PLINE committed with 3 vertices.');
    expect(ctx.entityCount()).toBe(before + 1);
    const polyline = ctx.lastPolyline();
    expect(polyline?.closed).toBe(false);
    expect(polyline?.vertices).toHaveLength(3);
    await shutdown(ctx);
  });

  it('B: U drops the newest vertex with no entity/history change, then D completes A,B,D', async () => {
    const ctx = await boot();
    const before = ctx.entityCount();
    await act(async () => {
      clickButton(ctx.container, 'PLINE');
    });
    await typePoint(ctx, '0,0');
    await typePoint(ctx, '20,0');
    await typePoint(ctx, '20,20');
    await typePoint(ctx, 'U');
    expect(ctx.entityCount()).toBe(before);
    expect(ctx.lastPolyline()).toBeUndefined();
    expect(ctx.status()).toContain('2 vertices captured');
    await typePoint(ctx, '40,0');
    await typePoint(ctx, '');
    const polyline = ctx.lastPolyline();
    expect(polyline?.closed).toBe(false);
    expect(polyline?.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 40, y: 0 },
    ]);
    expect(ctx.entityCount()).toBe(before + 1);
    await shutdown(ctx);
  });

  it('C: C closes 3 vertices, closing segment is real, one grip per vertex', async () => {
    const ctx = await boot();
    const before = ctx.entityCount();
    await act(async () => {
      clickButton(ctx.container, 'PLINE');
    });
    await typePoint(ctx, '0,0');
    await typePoint(ctx, '20,0');
    await typePoint(ctx, '20,20');
    await typePoint(ctx, 'C');
    expect(ctx.status()).toContain('PLINE closed with 3 vertices.');
    const polyline = ctx.lastPolyline();
    expect(polyline?.closed).toBe(true);
    expect(polyline?.vertices).toHaveLength(3);
    expect(ctx.entityCount()).toBe(before + 1);
    await act(async () => {
      clickButton(ctx.container, 'CLEAR');
    });
    expect(
      ctx.container.querySelectorAll(`[data-survey-cad-segment-id="${polyline!.id}#2"]`).length,
    ).toBe(1);
    await shutdown(ctx);
  });

  it('D: guards — C<3 stays active, U@0 stays, U@1 empties, Escape leaves no entity', async () => {
    const ctx = await boot();
    const before = ctx.entityCount();
    await act(async () => {
      clickButton(ctx.container, 'PLINE');
    });
    await typePoint(ctx, '0,0');
    await typePoint(ctx, '20,0');
    await typePoint(ctx, 'C');
    expect(ctx.status()).toContain('needs at least 3 distinct vertices');
    expect(ctx.entityCount()).toBe(before);
    expect(ctx.lastPolyline()).toBeUndefined();
    await typePoint(ctx, 'U');
    expect(ctx.status()).toContain('1 vertex captured');
    await typePoint(ctx, 'U');
    expect(ctx.status()).toContain('first vertex');
    await typePoint(ctx, 'U');
    expect(ctx.status()).toContain('nothing to undo');
    await act(async () => {
      pressKey(ctx.commandInput(), 'Escape');
    });
    expect(ctx.entityCount()).toBe(before);
    expect(ctx.lastPolyline()).toBeUndefined();
    await shutdown(ctx);
  });

  it('E: typed relative input after a backstep derives from the new last vertex', async () => {
    const ctx = await boot();
    await act(async () => {
      clickButton(ctx.container, 'PLINE');
    });
    await typePoint(ctx, '0,0');
    await typePoint(ctx, '10,0');
    await typePoint(ctx, '10,10');
    await typePoint(ctx, 'U');
    // Base is now (10,0): azimuth 0 (north) distance 10 => (10,10).
    await typePoint(ctx, '@0,10');
    await typePoint(ctx, '');
    const polyline = ctx.lastPolyline();
    expect(polyline?.vertices).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
    await shutdown(ctx);
  });
});
