import type { CoordMode } from '../types';

const hasExplicitFixedOrFloatTokens = (tokens: string[]): boolean =>
  tokens.some((token) => token === '!' || token === '*');

const isHiHtToken = (token: string | undefined): boolean => Boolean(token && token.includes('/'));

const fixedTokenCountForRecordLine = (line: string, coordMode: CoordMode): number => {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || hasExplicitFixedOrFloatTokens(tokens)) return 0;
  const code = tokens[0]?.toUpperCase();
  if (!code || code.startsWith('#') || code.startsWith('.')) return 0;

  if (code === 'C' || code === 'P' || code === 'PH' || code === 'CH') {
    return coordMode === '2D' ? 2 : 3;
  }

  if (
    code === 'D' ||
    code === 'A' ||
    code === 'B' ||
    code === 'V' ||
    code === 'DN' ||
    code === 'L'
  ) {
    return 1;
  }

  if (code === 'DV') {
    return 2;
  }

  if (code === 'G') {
    return tokens.length >= 11 ? 3 : 2;
  }

  if (code === 'M' || code === 'DM') {
    const verticalToken = tokens[4];
    return isHiHtToken(verticalToken) || verticalToken == null ? 2 : 3;
  }

  if (code === 'BM') {
    const verticalToken = tokens[5];
    return isHiHtToken(verticalToken) || verticalToken == null ? 2 : 3;
  }

  return 1;
};

export const appendFixedTokensToLine = (line: string, coordMode: CoordMode): string => {
  const count = fixedTokenCountForRecordLine(line, coordMode);
  if (count <= 0) return line;
  return `${line} ${Array.from({ length: count }, () => '!').join(' ')}`;
};

export const applyFixedTokensToLines = (
  lines: string[],
  fixed: boolean,
  coordMode: CoordMode,
): string[] => {
  if (!fixed) return lines;
  let applied = false;
  return lines.map((line) => {
    if (applied || line.startsWith('.')) return line;
    const nextLine = appendFixedTokensToLine(line, coordMode);
    if (nextLine !== line) applied = true;
    return nextLine;
  });
};
