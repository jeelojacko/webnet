import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import InputPane from '../src/components/InputPane';
import type { ProjectWorkspaceFileView } from '../src/hooks/useProjectFileWorkflow';

type InputPaneRenderProps = Omit<React.ComponentProps<typeof InputPane>, 'input' | 'onChange'> & {
  input?: string;
  onChange?: (_value: string) => void;
};

type RenderedInputPane = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => Promise<void>;
};

export const renderInputPane = async ({
  input = 'C A 0 0 0 ! !',
  onChange = () => undefined,
  ...props
}: InputPaneRenderProps = {}): Promise<RenderedInputPane> => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(<InputPane input={input} onChange={onChange} {...props} />);
  });

  return {
    container,
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

export const makeProjectFile = (
  overrides: Partial<ProjectWorkspaceFileView> & Pick<ProjectWorkspaceFileView, 'id' | 'name'>,
): ProjectWorkspaceFileView => {
  const { id, name, ...rest } = overrides;
  return {
  id,
  name,
  kind: 'dat',
  order: 0,
  tabOrder: null,
  isCheckedForRun: true,
  isOpenInTab: false,
  isFocusedTab: false,
  enabled: true,
  isActive: false,
  isMain: false,
  ...rest,
  };
};

export const findButtonByText = (container: HTMLElement, text: string): HTMLButtonElement | undefined =>
  Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;

export const clickProjectFilesButton = async (container: HTMLElement): Promise<void> => {
  const button = findButtonByText(container, 'Project Files');
  await act(async () => {
    button?.click();
  });
};
