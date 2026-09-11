import { createHash } from 'node:crypto';
import type { AiStudyMapJob } from '../study-desktop/src/ai/studyAiTypes';
import { authoringInputFingerprintPayload, canonicalJson } from '../study-desktop/src/ai/studyAiResultContract';

export const authoringInputFingerprint = (job: AiStudyMapJob): string =>
  createHash('sha256').update(canonicalJson(authoringInputFingerprintPayload(job))).digest('hex');
