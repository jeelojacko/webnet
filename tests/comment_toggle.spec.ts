import { describe, expect, it } from 'vitest';
import { toggleHashCommentsInSelection } from '../src/components/commentToggle';

describe('input comment toggle helper', () => {
  it('comments a selected block line-by-line', () => {
    const input = ['D\t1000-235\t17.43226789', 'M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n');
    const result = toggleHashCommentsInSelection(input, 0, input.length);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(
      ['# D\t1000-235\t17.43226789', '# M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n'),
    );
  });

  it('uncomments a fully commented block line-by-line', () => {
    const input = ['# D\t1000-235\t17.43226789', '# M\t1000-235-1\t075-50-41.0\t4.72668215'].join(
      '\n',
    );
    const result = toggleHashCommentsInSelection(input, 0, input.length);
    expect(result.changed).toBe(true);
    expect(result.text).toBe(
      ['D\t1000-235\t17.43226789', 'M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n'),
    );
  });

  it('expands to whole lines when selection is partial', () => {
    const input = ['D\t1000-235\t17.43226789', 'D\t1000-235\t17.43226465'].join('\n');
    const start = input.indexOf('1000');
    const end = input.lastIndexOf('26465');
    const result = toggleHashCommentsInSelection(input, start, end);
    expect(result.text).toBe(
      ['# D\t1000-235\t17.43226789', '# D\t1000-235\t17.43226465'].join('\n'),
    );
  });

  it('comments only uncommented lines in mixed selections', () => {
    const input = ['# D\t1000-235\t17.43226789', 'M\t1000-235-1\t075-50-41.0\t4.72668215'].join(
      '\n',
    );
    const result = toggleHashCommentsInSelection(input, 0, input.length);
    expect(result.text).toBe(
      ['# D\t1000-235\t17.43226789', '# M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n'),
    );
  });
});
