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

describe('InputPane syntax coloring', () => {
  it('renders comment/directive/observation/fixed token classes in the editor overlay', () => {
    const html = renderToStaticMarkup(
      <InputPane
        input={`# COMMENT\n.UNITS M\nDB 9\nD 1-2 12.345 ! 0.005\nTE 1-2-3 000-00-00.0`}
        onChange={() => {}}
      />,
    );

    expect(html).toContain('<span class="text-slate-500"># COMMENT</span>');
    expect(html).toContain('<span class="text-blue-300">.UNITS</span>');
    expect(html).toContain('<span class="text-cyan-300">DB</span>');
    expect(html).toContain('<span class="text-cyan-300">D</span>');
    expect(html).toContain('<span class="text-red-400">!</span>');
    expect(html).toContain('<span class="text-slate-300">0.005</span>');
    expect(html).toContain('<span class="text-blue-400">TE</span>');
  });
});
