export type LegalDisplayBlockKind = 'body' | 'clause' | 'and';

export type LegalDisplayBlock = {
  kind: LegalDisplayBlockKind;
  text: string;
};

const CLAUSE_MARKER_PATTERN = /^\s*(?:\([A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?\)|[A-Za-z0-9]+\))\s?/;
const STANDALONE_AND_PATTERN = /^\s*and\s*$/i;

/**
 * Splits reader text into logical display blocks: body paragraphs, clause
 * blocks (a `(a)`/`e)` marker plus its continuation lines), a standalone
 * `and` connector, and any trailing closing paragraph. Blank lines are
 * paragraph boundaries, except a marker-only line absorbs the paragraph(s)
 * that follow it (marker and body split across paragraphs). Block text is
 * never reworded so copy/highlight semantics stay exact.
 */
export const parseLegalDisplayBlocks = (text: string): LegalDisplayBlock[] => {
  const blocks: LegalDisplayBlock[] = [];
  let pending: LegalDisplayBlock | null = null;
  const flush = () => {
    if (pending) blocks.push(pending);
    pending = null;
  };
  const appendContinuation = (line: string) => {
    if (pending) pending.text += `\n${line}`;
    else pending = { kind: 'body', text: line };
  };

  for (const line of text.split('\n')) {
    if (!line.trim()) {
      // Paragraph boundary — unless the pending block is a bare marker
      // waiting for its body on the following line(s).
      const awaitingBody = pending?.kind === 'clause' && !pending.text.includes('\n');
      if (!awaitingBody) flush();
      continue;
    }
    if (STANDALONE_AND_PATTERN.test(line)) {
      flush();
      blocks.push({ kind: 'and', text: line.trim() });
      continue;
    }
    if (CLAUSE_MARKER_PATTERN.test(line)) {
      flush();
      pending = { kind: 'clause', text: line };
      continue;
    }
    appendContinuation(line);
  }
  flush();
  return blocks.filter((block) => block.text.trim());
};
