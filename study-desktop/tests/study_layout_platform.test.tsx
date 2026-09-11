/** @vitest-environment jsdom */

// StudyLayout platform seam: "Back To Adjustment" stays in browser hosts
// but is hidden in the Tauri desktop runtime (which has no adjustment app
// to return to). Uses the centralized resolveStudyStoragePlatform seam.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import StudyLayout from '../src/components/StudyLayout';
import { resolveStudyStoragePlatform } from '../src/studyStoragePlatform';

const layoutProps = {
  activePath: '/study',
  sidebarCollapsed: false,
  onSidebarCollapsedChange: vi.fn(),
  onNavigate: vi.fn(),
};

const backButton = (): Element | undefined =>
  Array.from(document.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Back To Adjustment'),
  );

describe('StudyLayout platform back navigation', () => {
  let root: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    root?.unmount();
    container?.remove();
    root = null;
    container = null;
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    delete (window as unknown as Record<string, unknown>).__TAURI__;
    vi.restoreAllMocks();
  });

  it('shows Back To Adjustment on browser hosts', async () => {
    expect(resolveStudyStoragePlatform()).toBe('browser');
    await act(async () => {
      root?.render(
        <StudyLayout {...layoutProps}>
          <div>Content</div>
        </StudyLayout>,
      );
    });
    expect(backButton()?.textContent).toContain('Back To Adjustment');
  });

  it('hides Back To Adjustment in the Tauri desktop runtime', async () => {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
    try {
      expect(resolveStudyStoragePlatform()).toBe('tauri');
      await act(async () => {
        root?.render(
          <StudyLayout {...layoutProps}>
            <div>Content</div>
          </StudyLayout>,
        );
      });
      expect(backButton()).toBeUndefined();
      // Study navigation itself is unaffected.
      expect(document.body.textContent).toContain('Dashboard');
    } finally {
      delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    }
  });
});
