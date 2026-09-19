import { describe, expect, it } from 'vitest';

import {
  applyProfileExtractionFailure,
  applyProfileExtractionSuccess,
  createCadProfileCache,
} from '../src/engine/cad/profileCache';
import type { CadSurfaceProfileResult } from '../src/engine/cad/profiles/profileExtraction';

const resultFor = (revision: string): CadSurfaceProfileResult => ({
  profileId: 'prof-1',
  revision,
  rawStartStation: 0,
  rawEndStation: 10,
  segments: [
    {
      samples: [
        { rawChainage: 0, displayStation: 0, x: 0, y: 0, elevation: 5 },
        { rawChainage: 10, displayStation: 10, x: 10, y: 0, elevation: 5 },
      ],
    },
  ],
  minElevation: 5,
  maxElevation: 5,
  coveredLength: 10,
  gapLength: 0,
  diagnostics: [],
});

describe('profile cache', () => {
  it('keeps current plus at most one stale keeper', () => {
    const cache = createCadProfileCache('scope-a');
    cache.set('prof-1', resultFor('prev1:one'));
    cache.set('prof-1', resultFor('prev1:two'));
    cache.set('prof-1', resultFor('prev1:three'));
    expect(cache.get('prof-1', 'prev1:one')).toBeUndefined();
    expect(cache.get('prof-1', 'prev1:two')).toBeDefined();
    expect(cache.get('prof-1', 'prev1:three')).toBeDefined();
    expect(cache.retained('prof-1').map((entry) => entry.revision)).toEqual([
      'prev1:two',
      'prev1:three',
    ]);
  });

  it('rejects stale applications', () => {
    const cache = createCadProfileCache('scope-a');
    const applied = applyProfileExtractionSuccess(cache, 'prof-1', {
      currentRevision: 'prev1:new',
      result: resultFor('prev1:old'),
    });
    expect(applied).toBe(false);
    expect(cache.get('prof-1', 'prev1:old')).toBeUndefined();
    expect(
      applyProfileExtractionSuccess(cache, 'prof-1', {
        currentRevision: 'prev1:new',
        result: resultFor('prev1:new'),
      }),
    ).toBe(true);
    expect(cache.get('prof-1', 'prev1:new')).toBeDefined();
  });

  it('isolates scopes and invalidates cleanly', () => {
    const first = createCadProfileCache('scope-a');
    const second = createCadProfileCache('scope-b');
    first.set('prof-1', resultFor('prev1:x'));
    expect(second.get('prof-1', 'prev1:x')).toBeUndefined();
    first.invalidate('prof-1');
    expect(first.get('prof-1', 'prev1:x')).toBeUndefined();
    expect(first.retained('prof-1')).toEqual([]);
    first.set('prof-1', resultFor('prev1:y'));
    first.clear();
    expect(first.get('prof-1', 'prev1:y')).toBeUndefined();
  });

  it('failure application records nothing', () => {
    const cache = createCadProfileCache('scope-a');
    expect(applyProfileExtractionFailure(cache, 'prof-1', 'prev1:z')).toBe(false);
    expect(cache.retained('prof-1')).toEqual([]);
  });
});
