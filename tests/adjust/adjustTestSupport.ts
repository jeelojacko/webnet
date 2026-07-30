import { readFileSync } from 'node:fs';

export { readFileSync };
export { LSAEngine } from '../../src/engine/adjust';
export { DEG_TO_RAD, RAD_TO_DEG, SEC_TO_RAD } from '../../src/engine/angles';
export { isPreanalysisWhatIfCandidate } from '../../src/engine/preanalysis';

export const fixture = readFileSync('tests/fixtures/simple.dat', 'utf-8');
