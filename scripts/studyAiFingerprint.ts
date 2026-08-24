import { createHash } from 'node:crypto';
import type { AiStudyMapJob } from '../src/study/ai/studyAiTypes';
import { authoringInputFingerprintPayload, canonicalJson } from '../src/study/ai/studyAiResultContract';

export const authoringInputFingerprint = (job: AiStudyMapJob): string =>
  createHash('sha256').update(canonicalJson(authoringInputFingerprintPayload(job))).digest('hex');
