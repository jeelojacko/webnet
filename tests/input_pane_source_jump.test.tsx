/** @vitest-environment jsdom */

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { describe, expect, it } from 'vitest';

import InputPane, { type InputPaneHandle } from '../src/components/InputPane';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('InputPane source-line jump handle', () => {
  it('focuses and selects the requested line', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    const inputRef = React.createRef<InputPaneHandle>();

    const Harness = () => {
      const [value, setValue] = React.useState('A\nB\nCCC\nD');
      return (
        <div>
          <button type="button" onClick={() => inputRef.current?.jumpToLine(3)}>
            Jump
          </button>
          <InputPane ref={inputRef} input={value} onChange={setValue} />
        </div>
      );
    };

    await act(async () => {
      root.render(<Harness />);
    });

    const jumpButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Jump',
    ) as HTMLButtonElement;
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;

    await act(async () => {
      jumpButton.click();
    });

    expect(document.activeElement).toBe(textarea);
    expect(textarea.selectionStart).toBe(4);
    expect(textarea.selectionEnd).toBe(7);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
