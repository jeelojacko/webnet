export interface CommentToggleResult {
  text: string;
  selectionStart: number;
  selectionEnd: number;
  replaceStart: number;
  replaceEnd: number;
  changed: boolean;
}

const commentLine = (line: string): string => {
  if (!line.trim()) return line;
  return line.replace(/^(\s*)/, '$1# ');
};

const uncommentLine = (line: string): string => {
  if (!line.trim()) return line;
  return line.replace(/^(\s*)#\s/, '$1');
};

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const transformHashCommentsInSelection = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
  mode: 'comment' | 'uncomment',
): CommentToggleResult => {
  const length = text.length;
  let start = clamp(selectionStart, 0, length);
  let end = clamp(selectionEnd, 0, length);
  if (end < start) [start, end] = [end, start];

  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const endAnchor = end > start ? end - 1 : end;
  const nextBreak = text.indexOf('\n', endAnchor);
  const lineEnd = nextBreak >= 0 ? nextBreak : length;
  const block = text.slice(lineStart, lineEnd);
  if (!block.length) {
    return {
      text,
      selectionStart: start,
      selectionEnd: end,
      replaceStart: start,
      replaceEnd: end,
      changed: false,
    };
  }

  const lines = block.split('\n');
  const toggledLines = mode === 'uncomment' ? lines.map(uncommentLine) : lines.map(commentLine);
  const toggledBlock = toggledLines.join('\n');

  if (toggledBlock === block) {
    return {
      text,
      selectionStart: lineStart,
      selectionEnd: lineEnd,
      replaceStart: lineStart,
      replaceEnd: lineEnd,
      changed: false,
    };
  }

  const nextText = `${text.slice(0, lineStart)}${toggledBlock}${text.slice(lineEnd)}`;
  return {
    text: nextText,
    selectionStart: lineStart,
    selectionEnd: lineStart + toggledBlock.length,
    replaceStart: lineStart,
    replaceEnd: lineEnd,
    changed: true,
  };
};

export const blockCommentSelection = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): CommentToggleResult =>
  transformHashCommentsInSelection(text, selectionStart, selectionEnd, 'comment');

export const blockUncommentSelection = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): CommentToggleResult =>
  transformHashCommentsInSelection(text, selectionStart, selectionEnd, 'uncomment');

export const toggleHashCommentsInSelection = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): CommentToggleResult => {
  const length = text.length;
  let start = clamp(selectionStart, 0, length);
  let end = clamp(selectionEnd, 0, length);
  if (end < start) [start, end] = [end, start];
  const lineStart = text.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const endAnchor = end > start ? end - 1 : end;
  const nextBreak = text.indexOf('\n', endAnchor);
  const lineEnd = nextBreak >= 0 ? nextBreak : length;
  const block = text.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const hasContent = lines.some((line) => line.trim().length > 0);
  const shouldUncomment =
    hasContent && lines.every((line) => !line.trim() || /^\s*#\s/.test(line));
  return transformHashCommentsInSelection(
    text,
    selectionStart,
    selectionEnd,
    shouldUncomment ? 'uncomment' : 'comment',
  );
};
