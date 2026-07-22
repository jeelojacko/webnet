import React from 'react';
import { blockCommentSelection, blockUncommentSelection } from './commentToggle';

type ContextMenuState = {
  x: number;
  y: number;
  hasSelection: boolean;
  canBlockComment: boolean;
  canBlockUncomment: boolean;
};

export const useInputPaneEditorActions = (
  textareaRef: React.RefObject<HTMLTextAreaElement | null>,
  editorWrapRef: React.RefObject<HTMLDivElement | null>,
) => {
  const [contextMenu, setContextMenu] = React.useState<ContextMenuState | null>(null);
  const dispatchTextareaInput = React.useCallback((textarea: HTMLTextAreaElement) => {
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }, []);

  const replaceTextareaRangeWithNativeEdit = React.useCallback(
    (
      textarea: HTMLTextAreaElement,
      replacement: string,
      start: number,
      end: number,
      selectionMode: 'select' | 'start' | 'end' | 'preserve' = 'end',
    ): boolean => {
      textarea.focus();
      textarea.setSelectionRange(start, end);
      const replaced = document.execCommand('insertText', false, replacement);
      if (!replaced) return false;
      if (selectionMode === 'select') {
        textarea.setSelectionRange(start, start + replacement.length);
      } else if (selectionMode === 'start') {
        textarea.setSelectionRange(start, start);
      } else if (selectionMode === 'preserve') {
        textarea.setSelectionRange(start, start + replacement.length);
      }
      return true;
    },
    [],
  );

  const replaceTextareaRange = React.useCallback(
    (
      textarea: HTMLTextAreaElement,
      replacement: string,
      start: number,
      end: number,
      selectionMode: 'select' | 'start' | 'end' | 'preserve' = 'end',
    ) => {
      if (replaceTextareaRangeWithNativeEdit(textarea, replacement, start, end, selectionMode)) {
        return;
      }
      textarea.focus();
      textarea.setRangeText(replacement, start, end, selectionMode);
      dispatchTextareaInput(textarea);
    },
    [dispatchTextareaInput, replaceTextareaRangeWithNativeEdit],
  );

  const applyBlockComment = React.useCallback(
    (textarea: HTMLTextAreaElement) => {
      const result = blockCommentSelection(
        textarea.value,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      );
      if (!result.changed) return;

      replaceTextareaRange(
        textarea,
        result.text.slice(result.replaceStart, result.selectionEnd),
        result.replaceStart,
        result.replaceEnd,
        'select',
      );
    },
    [replaceTextareaRange],
  );

  const applyBlockUncomment = React.useCallback(
    (textarea: HTMLTextAreaElement) => {
      const result = blockUncommentSelection(
        textarea.value,
        textarea.selectionStart ?? 0,
        textarea.selectionEnd ?? 0,
      );
      if (!result.changed) return;

      replaceTextareaRange(
        textarea,
        result.text.slice(result.replaceStart, result.selectionEnd),
        result.replaceStart,
        result.replaceEnd,
        'select',
      );
    },
    [replaceTextareaRange],
  );

  const execNativeEditorCommand = React.useCallback((command: 'undo' | 'redo' | 'copy' | 'cut') => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    document.execCommand(command);
  }, [textareaRef]);

  const handleCopy = React.useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selectedText = textarea.value.slice(start, end);
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
    } catch {
      execNativeEditorCommand('copy');
    }
  }, [execNativeEditorCommand, textareaRef]);

  const handleCut = React.useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    const selectedText = textarea.value.slice(start, end);
    if (!selectedText) return;
    try {
      await navigator.clipboard.writeText(selectedText);
      replaceTextareaRange(textarea, '', start, end, 'end');
    } catch {
      execNativeEditorCommand('cut');
    }
  }, [execNativeEditorCommand, replaceTextareaRange, textareaRef]);

  const handlePaste = React.useCallback(async () => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    try {
      const clipboardText = await navigator.clipboard.readText();
      replaceTextareaRange(textarea, clipboardText, start, end, 'end');
    } catch {
      return;
    }
  }, [replaceTextareaRange, textareaRef]);

  const handleDeleteSelection = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    if (start === end) return;
    replaceTextareaRange(textarea, '', start, end, 'end');
  }, [replaceTextareaRange, textareaRef]);

  const handleSelectAll = React.useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(0, textarea.value.length);
  }, [textareaRef]);

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const isModifier = event.metaKey || event.ctrlKey || event.altKey;
    const isHashShortcut = event.key === '#' || (event.shiftKey && event.code === 'Digit3');

    if (event.key === 'Tab' && !isModifier) {
      event.preventDefault();
      const start = textarea.selectionStart ?? 0;
      const end = textarea.selectionEnd ?? 0;
      replaceTextareaRange(textarea, '\t', start, end, 'end');
      return;
    }

    if (event.ctrlKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      execNativeEditorCommand('redo');
      return;
    }

    if (!isHashShortcut || isModifier) return;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    if (start === end) return;
    event.preventDefault();
    applyBlockComment(textarea);
  };

  const handleContextMenu = (event: React.MouseEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const start = textarea.selectionStart ?? 0;
    const end = textarea.selectionEnd ?? 0;
    event.preventDefault();
    const bounds = editorWrapRef.current?.getBoundingClientRect();
    const x = bounds ? event.clientX - bounds.left : event.clientX;
    const y = bounds ? event.clientY - bounds.top : event.clientY;
    const selected = textarea.value.slice(start, end);
    setContextMenu({
      x,
      y,
      hasSelection: start !== end,
      canBlockComment: selected.length > 0,
      canBlockUncomment:
        selected.length > 0 && selected.split('\n').some((line) => /^\s*#\s/.test(line)),
    });
  };

  const handleContextMenuAction = React.useCallback(
    async (
      action:
        | 'undo'
        | 'redo'
        | 'cut'
        | 'copy'
        | 'paste'
        | 'delete'
        | 'select-all'
        | 'block-comment'
        | 'block-uncomment',
    ) => {
      if (action === 'undo') execNativeEditorCommand('undo');
      if (action === 'redo') execNativeEditorCommand('redo');
      if (action === 'copy') await handleCopy();
      if (action === 'cut') await handleCut();
      if (action === 'paste') await handlePaste();
      if (action === 'delete') handleDeleteSelection();
      if (action === 'select-all') handleSelectAll();
      if (action === 'block-comment' && textareaRef.current) applyBlockComment(textareaRef.current);
      if (action === 'block-uncomment' && textareaRef.current)
        applyBlockUncomment(textareaRef.current);
      setContextMenu(null);
    },
    [
      applyBlockComment,
      applyBlockUncomment,
      execNativeEditorCommand,
      handleCopy,
      handleCut,
      handleDeleteSelection,
      handlePaste,
      handleSelectAll,
      textareaRef,
    ],
  );

  React.useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('pointerdown', close);
    window.addEventListener('resize', close);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('resize', close);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);



  return {
    closeContextMenu: () => setContextMenu(null),
    contextMenu,
    handleContextMenu,
    handleContextMenuAction,
    handleKeyDown,
  };
};
