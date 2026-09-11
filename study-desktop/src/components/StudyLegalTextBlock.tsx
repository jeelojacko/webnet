import type { ReactNode } from 'react';

type StudyLegalTextBlockProps = {
  text: string;
  label?: string;
  heading?: string;
  query?: string;
  highlight: (_value: string, _query: string) => ReactNode;
};

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const removeDisplayedHeading = (text: string, label?: string, heading?: string): string => {
  if (!label) return text;
  const headingPattern = heading ? `(?:\\s+${escapeRegExp(heading)})?` : '';
  return text.replace(new RegExp(`^\\s*${escapeRegExp(label)}${headingPattern}\\s*`), '');
};

const renderLine = (
  line: string,
  query: string,
  highlight: (_value: string, _query: string) => ReactNode,
  index: number,
): ReactNode => {
  const clause = line.match(/^(\s*)(\([a-z0-9]+(?:\.[a-z0-9]+)?\))\s*(.*)$/i);
  if (!clause) return <div key={index}>{highlight(line, query)}</div>;
  return (
    <div key={index} className="flex gap-3">
      <span className="w-8 shrink-0 font-semibold text-emerald-300">{clause[2]}</span>
      <span className="min-w-0 flex-1">{highlight(clause[3], query)}</span>
    </div>
  );
};

export const StudyLegalTextBlock = ({ text, label, heading, query = '', highlight }: StudyLegalTextBlockProps) => {
  const displayText = removeDisplayedHeading(text, label, heading);
  const paragraphs = displayText.split(/\n{2,}/);
  return (
    <div className="space-y-2 whitespace-pre-wrap text-sm leading-7 text-slate-200">
      {paragraphs.flatMap((paragraph, paragraphIndex) => [
        <div key={`paragraph-${paragraphIndex}`} className="space-y-1">
          {paragraph.split('\n').map((line, lineIndex) => renderLine(line, query, highlight, lineIndex))}
        </div>,
        paragraphIndex < paragraphs.length - 1 ? <div key={`space-${paragraphIndex}`} aria-hidden="true" /> : null,
      ])}
    </div>
  );
};
