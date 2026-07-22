import React from 'react';

const INPUT_EDITOR_BASE_TOKEN_CLASS = 'text-slate-300';
const INPUT_EDITOR_COMMENT_CLASS = 'text-slate-500';
const INPUT_EDITOR_DIRECTIVE_CLASS = 'text-blue-300';
const INPUT_EDITOR_FIXED_CLASS = 'text-red-400';

export const INPUT_EDITOR_LINE_HEIGHT_PX = 19.5;
export const INPUT_EDITOR_WINDOW_BUFFER_LINES = 48;

const INPUT_EDITOR_OBS_TOKEN_CLASS: Record<string, string> = {
  C: 'text-amber-100',
  P: 'text-amber-100',
  PH: 'text-amber-100',
  CH: 'text-amber-100',
  EH: 'text-amber-100',
  E: 'text-amber-100',
  D: 'text-cyan-300',
  DV: 'text-cyan-200',
  A: 'text-blue-300',
  B: 'text-rose-300',
  V: 'text-green-400',
  G: 'text-amber-300',
  L: 'text-emerald-400',
  M: 'text-amber-200',
  BM: 'text-emerald-400',
  SS: 'text-rose-200',
  DB: 'text-cyan-300',
  DN: 'text-cyan-300',
  DM: 'text-cyan-300',
  DE: 'text-cyan-300',
  TB: 'text-blue-400',
  T: 'text-blue-400',
  TE: 'text-blue-400',
  ET: 'text-blue-400',
};

const isWhitespaceToken = (token: string): boolean => /^\s+$/.test(token);

const tokenizeWithWhitespace = (value: string): string[] => value.match(/(\s+|[^\s]+)/g) ?? [];

const findUnquotedHashIndex = (line: string): number => {
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '#') return i;
  }
  return -1;
};

export const renderHighlightedLine = (line: string, lineIndex: number): React.ReactNode => {
  if (line.length === 0) return null;
  const trimmed = line.trimStart();
  if (trimmed.startsWith('#') || trimmed.startsWith("'")) {
    return (
      <span key={`input-comment-${lineIndex}`} className={INPUT_EDITOR_COMMENT_CLASS}>
        {line}
      </span>
    );
  }

  const hashIndex = findUnquotedHashIndex(line);
  const codePart = hashIndex >= 0 ? line.slice(0, hashIndex) : line;
  const commentPart = hashIndex >= 0 ? line.slice(hashIndex) : '';
  const tokens = tokenizeWithWhitespace(codePart);
  const firstNonWhitespaceIndex = tokens.findIndex((token) => !isWhitespaceToken(token));
  const firstTokenUpper =
    firstNonWhitespaceIndex >= 0 ? tokens[firstNonWhitespaceIndex].toUpperCase() : '';
  const directiveLine = firstTokenUpper.startsWith('.') || firstTokenUpper.startsWith('/');
  const rendered: React.ReactNode[] = [];

  tokens.forEach((token, tokenIndex) => {
    if (isWhitespaceToken(token)) {
      rendered.push(
        <React.Fragment key={`input-ws-${lineIndex}-${tokenIndex}`}>{token}</React.Fragment>,
      );
      return;
    }
    let className = directiveLine ? INPUT_EDITOR_DIRECTIVE_CLASS : INPUT_EDITOR_BASE_TOKEN_CLASS;
    if (!directiveLine && tokenIndex === firstNonWhitespaceIndex) {
      className = INPUT_EDITOR_OBS_TOKEN_CLASS[firstTokenUpper] ?? INPUT_EDITOR_BASE_TOKEN_CLASS;
    }
    if (/^[!&]+$/.test(token)) {
      className = INPUT_EDITOR_FIXED_CLASS;
    }
    rendered.push(
      <span key={`input-token-${lineIndex}-${tokenIndex}`} className={className}>
        {token}
      </span>,
    );
  });

  if (commentPart) {
    rendered.push(
      <span key={`input-inline-comment-${lineIndex}`} className={INPUT_EDITOR_COMMENT_CLASS}>
        {commentPart}
      </span>,
    );
  }

  return <>{rendered}</>;
};
