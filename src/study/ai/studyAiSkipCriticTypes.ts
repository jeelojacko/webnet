// Skip Critic V1 workflow types. Separate contract from Study Map V3;
// the model-authored result carries no run/job/corpus identity.

export type SkipCriticDecision = 'skip-supported' | 'skip-not-supported' | 'uncertain';

export type SkipCriticConfidence = 'high' | 'medium' | 'low';

export type SkipCriticStudyValueCategory =
  | 'duty'
  | 'permission'
  | 'prohibition'
  | 'right'
  | 'official-power'
  | 'procedure'
  | 'prerequisite'
  | 'legal-effect'
  | 'consequence'
  | 'remedy'
  | 'payment-cost-liability'
  | 'review-appeal'
  | 'filing-registration-evidence'
  | 'offence-enforcement'
  | 'other';

export type SkipCriticDetectedStudyValue = {
  category: SkipCriticStudyValueCategory;
  sourceKey: string;
  childLabels: string[];
  summary: string;
};

export type SkipCriticResult = {
  schemaVersion: 1;
  decision: SkipCriticDecision;
  confidence: SkipCriticConfidence;
  detectedStudyValue: SkipCriticDetectedStudyValue[];
  reason: string;
  warnings: string[];
};

/**
 * Caller-provided permitted critic evidence, keyed by sourceKey with the
 * child labels that exist for that sourceKey. Source keys absent from this
 * map are not permitted as target evidence.
 */
export type SkipCriticPermittedEvidence = Record<string, readonly string[]>;

export type SkipCriticValidationContext = {
  permittedEvidence: SkipCriticPermittedEvidence;
};

export type SkipCriticValidationIssue = {
  code: string;
  message: string;
  sourceKey?: string;
};

export type SkipCriticValidationReport = {
  valid: boolean;
  issues: SkipCriticValidationIssue[];
};
