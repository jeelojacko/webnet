import { describe, expect, it } from 'vitest';
import {
  blockCommentSelection,
  blockUncommentSelection,
  toggleHashCommentsInSelection,
} from '../src/components/commentToggle';

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

  it('toggle comment now comments every line in mixed selections so existing comments can be nested safely', () => {
    const input = ['# D\t1000-235\t17.43226789', 'M\t1000-235-1\t075-50-41.0\t4.72668215'].join(
      '\n',
    );
    const result = toggleHashCommentsInSelection(input, 0, input.length);
    expect(result.text).toBe(
      ['# # D\t1000-235\t17.43226789', '# M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n'),
    );
  });

  it('block comment always prefixes # even when the line is already a comment', () => {
    const input = ['# setup 1', 'M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n');
    const result = blockCommentSelection(input, 0, input.length);
    expect(result.text).toBe(
      ['# # setup 1', '# M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n'),
    );
  });

  it('block uncomment removes only one left-most # marker', () => {
    const input = ['# # setup 1', '# M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n');
    const result = blockUncommentSelection(input, 0, input.length);
    expect(result.text).toBe(
      ['# setup 1', 'M\t1000-235-1\t075-50-41.0\t4.72668215'].join('\n'),
    );
  });

  it('block uncomment leaves ## style comments unchanged because they are not # markers', () => {
    const input = ['## heading', '# regular comment'].join('\n');
    const result = blockUncommentSelection(input, 0, input.length);
    expect(result.text).toBe(['## heading', 'regular comment'].join('\n'));
  });
});
