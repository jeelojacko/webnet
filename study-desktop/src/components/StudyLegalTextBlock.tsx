import type { CSSProperties, ReactNode } from 'react';
import { parseLegalDisplayBlocks, type LegalDisplayBlock } from './StudyLegalTextBlock.utils';

type StudyLegalTextBlockProps = {
  text: string;
  label?: string;
  heading?: string;
  query?: string;
  highlight: (_value: string, _query: string) => ReactNode;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const displayLabelPattern = (label: string): string =>
  [...label]
    .map((character) => {
      if (/\\d|[A-Za-z]/.test(character)) return character;
      if (character === '.') return '\\s*\\.\\s*';
      if (character === '(') return '\\s*\\(\\s*';
      if (character === ')') return '\\s*\\)';
      return escapeRegExp(character);
    })
    .join('');

const removeDisplayedHeading = (text: string, label?: string, heading?: string): string => {
  if (!label) return text;
  const headingPattern = heading ? `(?:\\s+${escapeRegExp(heading)})?` : '';
  return text.replace(new RegExp(`^\\s*${displayLabelPattern(label)}${headingPattern}\\s*`), '');
};

const HANGING_INDENT_STYLE: CSSProperties = { paddingLeft: '2rem', textIndent: '-2rem' };
const AND_INDENT_STYLE: CSSProperties = { paddingLeft: '2rem' };

const renderBlock = (
  block: LegalDisplayBlock,
  query: string,
  highlight: (_value: string, _query: string) => ReactNode,
  index: number,
): ReactNode => {
  if (block.kind === 'clause') {
    return (
      <div key={index} style={HANGING_INDENT_STYLE}>
        {highlight(block.text, query)}
      </div>
    );
  }
  if (block.kind === 'and') {
    return (
      <div key={index} style={AND_INDENT_STYLE}>
        {highlight(block.text, query)}
      </div>
    );
  }
  return <div key={index}>{highlight(block.text, query)}</div>;
};

export const StudyLegalTextBlock = ({ text, label, heading, query = '', highlight }: StudyLegalTextBlockProps) => {
  const displayText = removeDisplayedHeading(text, label, heading);
  const blocks = parseLegalDisplayBlocks(displayText);
  return (
    <div className="space-y-2 whitespace-normal text-sm leading-7 text-slate-200">
      {blocks.map((block, index) => renderBlock(block, query, highlight, index))}
    </div>
  );
};
