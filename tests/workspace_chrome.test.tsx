/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import WorkspaceChrome from '../src/components/WorkspaceChrome';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('WorkspaceChrome', () => {
  it('switches tabs through the shared chrome and exposes the show-input action when collapsed', async () => {
    const onActiveTabChange = vi.fn();
    const onShowInput = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspaceChrome
          activeTab="report"
          onActiveTabChange={onActiveTabChange}
          isSidebarOpen={false}
          onShowInput={onShowInput}
          hasResult
          renderReportContent={() => <div>Report body</div>}
          renderProcessingSummaryContent={() => <div>Processing body</div>}
          renderIndustryOutputContent={() => <div>Listing body</div>}
          renderMapContent={() => <div>Map body</div>}
        />,
      );
    });

    expect(container.textContent).toContain('Report body');

    await act(async () => {
      const processingButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Processing Summary'),
      );
      processingButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActiveTabChange).toHaveBeenCalledWith('processing-summary');

    await act(async () => {
      const showInputButton = Array.from(container.querySelectorAll('button')).find((button) =>
        button.textContent?.includes('Show Input'),
      );
      showInputButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onShowInput).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('shows the empty-state prompt when no result is available', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspaceChrome
          activeTab="report"
          onActiveTabChange={vi.fn()}
          isSidebarOpen
          onShowInput={vi.fn()}
          hasResult={false}
          renderReportContent={() => <div>Report body</div>}
          renderProcessingSummaryContent={() => <div>Processing body</div>}
          renderIndustryOutputContent={() => <div>Listing body</div>}
          renderMapContent={() => <div>Map body</div>}
        />,
      );
    });

    expect(container.textContent).toContain('Paste/edit data, then press "Adjust" to solve.');
    expect(container.textContent).not.toContain('Report body');

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it('only evaluates the active tab render callback', async () => {
    const renderReportContent = vi.fn(() => <div>Report body</div>);
    const renderProcessingSummaryContent = vi.fn(() => <div>Processing body</div>);
    const renderIndustryOutputContent = vi.fn(() => <div>Listing body</div>);
    const renderMapContent = vi.fn(() => <div>Map body</div>);
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspaceChrome
          activeTab="report"
          onActiveTabChange={vi.fn()}
          isSidebarOpen
          onShowInput={vi.fn()}
          hasResult
          renderReportContent={renderReportContent}
          renderProcessingSummaryContent={renderProcessingSummaryContent}
          renderIndustryOutputContent={renderIndustryOutputContent}
          renderMapContent={renderMapContent}
        />,
      );
    });

    expect(renderReportContent).toHaveBeenCalledTimes(1);
    expect(renderProcessingSummaryContent).not.toHaveBeenCalled();
    expect(renderIndustryOutputContent).not.toHaveBeenCalled();
    expect(renderMapContent).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
