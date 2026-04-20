import { describe, expect, it } from 'vitest';
import {
  buildActionGuardMessage,
  confirmActionGuard,
  resolveActionGuardReason,
} from '../src/engine/actionGuards';

describe('actionGuards', () => {
  it('builds deterministic guard copy with scope and detail', () => {
    const message = buildActionGuardMessage({
      action: 'exclude-rerun',
      scope: 'DIST A-B (line 12)',
      detail: 'This immediately reruns adjustment.',
    });
    expect(message).toContain('Exclude and rerun');
    expect(message).toContain('Scope: DIST A-B (line 12)');
    expect(message).toContain('immediately reruns adjustment');
  });

  it('resolves disabled reason for blocked actions', () => {
    expect(resolveActionGuardReason(true, {})).toBeNull();
    expect(resolveActionGuardReason(false, { disabledReason: 'Cluster detection disabled.' })).toBe(
      'Cluster detection disabled.',
    );
  });

  it('delegates confirmation through the supplied confirm callback', () => {
    const accepted = confirmActionGuard(
      {
        action: 'import-apply',
        scope: '20 selected rows',
      },
      () => true,
    );
    const rejected = confirmActionGuard(
      {
        action: 'import-new-file',
        scope: '20 selected rows',
      },
      () => false,
    );
    expect(accepted).toBe(true);
    expect(rejected).toBe(false);
  });
});

