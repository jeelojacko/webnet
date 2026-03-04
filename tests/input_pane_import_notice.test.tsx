import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import InputPane from '../src/components/InputPane';
import { INPUT_PANE_CONTEXT_MENU_ORDER } from '../src/components/inputPaneContextMenu';

describe('InputPane import notice', () => {
  it('renders a generic external-import banner when imported input is loaded', () => {
    const html = renderToStaticMarkup(
      <InputPane
        input={'P TEST 1 2 3'}
        onChange={() => {}}
        importNotice={{
          title: 'Imported JobXML dataset',
          detailLines: [
            'Imported 42 records from sample.jobxml into normalized WebNet input.',
            'Warnings: 1 unsupported code left in comment form for traceability.',
          ],
        }}
        onClearImportNotice={() => {}}
      />,
    );

    expect(html).toContain('Imported JobXML dataset');
    expect(html).toContain('Imported 42 records from sample.jobxml into normalized WebNet input.');
    expect(html).toContain('Warnings: 1 unsupported code left in comment form for traceability.');
    expect(html).toContain('Dismiss');
  });
});

describe('InputPane context menu', () => {
  it('keeps standard edit actions ahead of block comment toggling', () => {
    expect(INPUT_PANE_CONTEXT_MENU_ORDER).toEqual([
      'Undo',
      'Redo',
      'Cut',
      'Copy',
      'Paste',
      'Delete',
      'Select All',
      'Block Comment',
      'Block Uncomment',
    ]);
  });
});
