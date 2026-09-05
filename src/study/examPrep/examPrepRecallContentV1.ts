// Exam Prep — Recall Content V1 (learner-facing presentation layer).
//
// The frozen curriculum manifest defines WHAT must be recalled (task IDs,
// ordering, mustRecall source text). This module defines HOW each frozen
// recall proposition is presented to the learner: a specific authored
// question per card, plus a polished expected answer where needed.
//
// Rules:
// - Exactly one record per frozen recall task ID, in canonical recall order.
// - DO NOT edit the curriculum manifest or mustRecall strings to change
//   learner wording here; add an override or a new content version instead.
// - The frozen projection in examPrepRecallTasks.ts is intentionally
//   unchanged (generic prompt + verbatim mustRecall answer). Learner UI and
//   Mock resolution go through resolveExamPrepRecallLearnerContent below.

import { canonicalJson } from '../ai/studyAiResultContract';
import type { ExamPrepRecallTask } from './examPrepTypes';

export type ExamPrepRecallLearnerContent = {
  taskId: string;
  prompt: string;
  expectedAnswerOverride?: string;
};

/** Identity of this learner-content layer (not a curriculum/schema version). */
export const EXAM_PREP_RECALL_CONTENT_ID = 'nb-sit-recall-content-v1';

/**
 * All 57 human-authored learner prompts in canonical recall-task order.
 * Cards without an `expectedAnswerOverride` reuse the frozen mustRecall text.
 */
export const EXAM_PREP_RECALL_CONTENT_V1: ExamPrepRecallLearnerContent[] = [
  { taskId: 'recall:A-NBLS-01:1', prompt: 'What kind of boundary determination is a core part of the statutory practice of land surveying?', expectedAnswerOverride: 'Determining legal boundaries is a core part of the practice of land surveying.' },
  { taskId: 'recall:A-NBLS-01:2', prompt: 'Can locating an object or feature relative to a boundary for certification purposes fall within the practice of land surveying?', expectedAnswerOverride: 'Yes. Determining the location of something relative to a boundary for the purpose of certifying its location can constitute the practice of land surveying.' },
  { taskId: 'recall:A-NBLS-01:3', prompt: 'What watercourse-related work falls within the statutory practice of land surveying?', expectedAnswerOverride: 'Surveying watercourses to establish or determine legal boundaries or rights or interests in them, and preparing related plans, documents, or advice, fall within the statutory practice of land surveying.' },
  { taskId: 'recall:A-NBLS-03:1', prompt: 'How does authorization to practise differ between an individual surveyor and a partnership, association, or corporation?' },
  { taskId: 'recall:A-NBLS-04:1', prompt: 'What signing/sealing responsibility applies to final professional survey plans, reports, opinions, or documents intended to be relied upon?', expectedAnswerOverride: "Final survey plans, reports, opinions, or other documents prepared by or under a land surveyor's direction, whose accuracy is intended to be relied upon, must be signed by the land surveyor and bear the required seal." },
  { taskId: 'recall:A-NBLS-04:2', prompt: 'Who generally owns original survey plans, records, and documents prepared by a surveyor, and what is the employee exception?', expectedAnswerOverride: "Original survey plans, records, and documents generally remain the surveyor's property. If they were prepared in the course of employment by another, they remain the employer's property and may not be removed from the employer's place of business without prior written consent." },
  { taskId: 'recall:A-BYL-06:1', prompt: 'When a survey results in monuments being placed, what Survey Plan obligation generally follows, and what is the key coordinated-plan exception?' },
  { taskId: 'recall:A-SURV-03:1', prompt: 'In an integrated survey area, which legal monuments established by a surveyor must be tied to coordinate monuments?', expectedAnswerOverride: 'In an integrated survey area, a surveyor must tie to the coordinate monuments all legal monuments the surveyor establishes that pertain to Crown Lands, subdivisions requiring a subdivision plan, or parcels whose owners request inclusion.' },
  { taskId: 'recall:A-SURV-03:2', prompt: 'When is subdivision work included in the integrated-survey-area coordinate-monument tie requirement?', expectedAnswerOverride: 'Subdivision work is included when a subdivision plan is required under the Community Planning Act.' },
  { taskId: 'recall:A-SURV-03:3', prompt: 'When may a surveyor certify the correctness of a subdivision or other plan prepared under s.7 in an integrated survey area?', expectedAnswerOverride: "For a subdivision or other plan prepared under section 7, the surveyor may certify its correctness only if it represents a survey carried out by the surveyor or under the surveyor's personal supervision or direction, and the survey standard complies with the regulations." },
  { taskId: 'recall:A-BCAR-01:1', prompt: "What four matters must a boundary-confirmation surveyor's report address?" },
  { taskId: 'recall:A-CPA-04:1', prompt: 'After tentative-plan approval, what are the main steps before a subdivision plan is filed or registered?' },
  { taskId: 'recall:A-CPA-05:1', prompt: 'What categories of technical survey information must a subdivision plan contain?' },
  { taskId: 'recall:A-REG-02:1', prompt: 'What legal effect does registration of a conveyance have under the Registry Act?', expectedAnswerOverride: 'A duly registered conveyance has statutory effect to transfer the land described according to the intent of the conveyance.' },
  { taskId: 'recall:A-REG-03:1', prompt: "Can one party to an instrument witness another party's execution?", expectedAnswerOverride: "No. A party to an instrument shall not witness another party's execution." },
  { taskId: 'recall:A-REG-03:2', prompt: "Can one party take the affidavit or acknowledgment of another party's execution?", expectedAnswerOverride: "No. A party shall not take the affidavit or acknowledgment of another party's execution." },
  { taskId: 'recall:A-LTA-01:1', prompt: 'What is the primary evidence of registered ownership under the Land Titles system?' },
  { taskId: 'recall:A-LTA-06:1', prompt: 'What general indemnity rule applies when Land Titles rectification or registration errors cause qualifying damage?' },
  { taskId: 'recall:B-AGRI-02:1', prompt: 'If agricultural land cannot be properly drained without a ditch or drain through adjacent land, what statutory route is available?' },
  { taskId: 'recall:B-AGRI-02:2', prompt: 'Who is responsible for maintaining a qualifying shared agricultural ditch or drain serving two or more adjacent owners?' },
  { taskId: 'recall:B-AIR-02:1', prompt: 'What certifications and approvals must an air-space plan carry before filing?', expectedAnswerOverride: "Before filing, an air-space plan must carry the surveyor's certificate and seal and the required development-officer and Director of Surveys approvals." },
  { taskId: 'recall:B-ASMT-01:1', prompt: 'What is the general valuation basis for real-property assessment in New Brunswick?' },
  { taskId: 'recall:B-ASMT-02:1', prompt: 'What is the basic review-and-appeal route for a real-property assessment challenge?' },
  { taskId: 'recall:B-CWA-02:1', prompt: 'Before a qualifying project alters a watercourse or wetland, or diverts water, what generally must be submitted and obtained?', expectedAnswerOverride: 'Before a qualifying alteration or diversion, the person must provide the required plans or information to the Minister and, unless exempted or waived, obtain the required permit.' },
  { taskId: 'recall:B-CONDO-01:1', prompt: 'What happens legally when a condominium declaration and description are registered?' },
  { taskId: 'recall:B-CONDO-02:1', prompt: 'What survey material must a condominium description include?' },
  { taskId: 'recall:B-CONDO-02:2', prompt: 'For a bare-land condominium, how are unit boundaries tied to survey control, and what must the surveyor certify?' },
  { taskId: 'recall:B-CE-01:1', prompt: 'When does a conservation easement acquire legal effect?' },
  { taskId: 'recall:B-CLF-02:1', prompt: 'What must a surveyor do when a surveyed parcel has a boundary or corner touching or bordering Crown Lands?' },
  { taskId: 'recall:B-EASE-02:1', prompt: 'What are the two key prescriptive periods for a general way, easement, or water-use claim, and what exception must be remembered?', expectedAnswerOverride: 'For a general way, easement, or water-use claim, 20 years protects qualifying enjoyment against the specified historical-origin objection; 40 years can make the right absolute and indefeasible, subject to the statutory written-consent exception.' },
  { taskId: 'recall:B-EVID-02:1', prompt: 'What evidentiary route does the Evidence Act provide for public records such as maps, plans, and records of survey?' },
  { taskId: 'recall:B-EXPR-02:1', prompt: 'What pre-expropriation survey/investigation entry does the Expropriation Act authorize, and what limits accompany it?', expectedAnswerOverride: 'The Act allows authorized entry to assess suitability for expropriation, including surveys, levels, borings, and other necessary tests, subject to its notice and authorization requirements and compensation for resulting damage.' },
  { taskId: 'recall:B-EXPR-03:1', prompt: 'What broad categories can expropriation compensation include?' },
  { taskId: 'recall:B-HWY-02:1', prompt: 'If a highway boundary is doubtful or disputed, how does the Highway Act deem the highway centre line?' },
  { taskId: 'recall:B-LIM-02:1', prompt: 'What are the general recovery-of-land limitation periods for a private claimant and for the Crown?' },
  { taskId: 'recall:B-LIM-02:2', prompt: "What happens to a claimant's right or title when the recovery-of-land limitation period expires?" },
  { taskId: 'recall:B-MIN-02:1', prompt: 'How is a mineral claim spatially described, and how do its boundaries extend vertically?' },
  { taskId: 'recall:B-MIN-03:1', prompt: 'Who may carry out a boundary survey under the Mining Act, and what survey law governs the work?' },
  { taskId: 'recall:B-MIN-03:2', prompt: 'What coordinate and vertical-datum framework applies to a Mining Act boundary survey?' },
  { taskId: 'recall:B-ONG-02:1', prompt: 'If an oil-and-gas rights holder cannot reach the required agreement with the owner, tenant, or occupant of private land, what statutory route is used for entry and use?' },
  { taskId: 'recall:B-PROP-01:1', prompt: 'Absent a contrary intention, what appurtenant rights can a conveyance of land carry with it?' },
  { taskId: 'recall:B-PW-02:1', prompt: 'What entry and investigative survey powers does the Public Works Act authorize for purposes connected with a public work?' },
  { taskId: 'recall:B-QS-02:1', prompt: 'What survey requirement applies to Crown Lands covered by a quarry lease?' },
  { taskId: 'recall:B-RPTT-01:1', prompt: 'When does Real Property Transfer Tax arise on a land transfer, and what values does the Act compare?' },
  { taskId: 'recall:B-TRSP-02:1', prompt: 'Does the Trespass Act apply to a person entering or remaining on land under statutory authority?' },
  { taskId: 'recall:C-CGR-01:1', prompt: 'What does the Crown Grants Act do with certain historical restrictions originating in Crown grants?' },
  { taskId: 'recall:C-ETA-01:1', prompt: 'Can information be denied legal effect solely because it is in electronic form?' },
  { taskId: 'recall:C-METRIC-01:1', prompt: 'What does the Metric Conversion Act do with designated Canadian-system measurements?' },
  { taskId: 'recall:C-OHS-01:1', prompt: 'When does an employee have a statutory right to refuse work on health or safety grounds?' },
  { taskId: 'recall:C-OMIN-01:1', prompt: 'Can ownership of minerals be separate from ownership of the soil?' },
  { taskId: 'recall:C-UGS-01:1', prompt: 'How does the Underground Storage Act treat a qualifying underground-storage site as property?' },
  { taskId: 'recall:NAV-01:1', prompt: 'Before applying registration rules to a parcel, what classification must you make first?' },
  { taskId: 'recall:NAV-02:1', prompt: "Is an ordinary surveyor's boundary investigation or determination the same as a statutory boundary confirmation?" },
  { taskId: 'recall:NAV-05:1', prompt: 'Can Easements Act prescriptive periods be applied mechanically to registered Land Titles land?' },
  { taskId: 'recall:NAV-07:1', prompt: 'Does a statutory right to enter land for surveying, inspection, or investigation amount to expropriation or acquisition of title?' },
  { taskId: 'recall:NAV-09:1', prompt: 'Are an air-space parcel and a condominium unit interchangeable legal concepts?' },
  { taskId: 'recall:NAV-11:1', prompt: 'Why must you distinguish finding or obtaining a record from proving or using that record as evidence?', expectedAnswerOverride: 'Access and registration statutes govern finding or obtaining records; the Evidence Act governs the evidentiary routes for using qualifying records or copies as evidence.' },
];

/**
 * Deterministic SHA-256 over the canonical JSON of the V1 records array.
 * Stored as a literal so the browser bundle never imports `node:crypto`;
 * `exam_prep_recall_content_v1.test.ts` recomputes it with Node crypto and
 * fails closed on any drift.
 */
export const examPrepRecallContentV1Hash =
  '1876b36d029c3e67cb9030b7154c1de15cfb4326da5c265ba3d55ba47fb91b4d';

/** Canonical JSON the pinned hash above is computed over (Node-side check). */
export const examPrepRecallContentV1CanonicalJson = (): string =>
  canonicalJson(EXAM_PREP_RECALL_CONTENT_V1);

const contentByTaskId = new Map<string, ExamPrepRecallLearnerContent>(
  EXAM_PREP_RECALL_CONTENT_V1.map((record) => [record.taskId, record]),
);

/**
 * Resolve the learner-facing prompt + expected answer for a frozen recall
 * task. FAIL CLOSED: throws naming the missing taskId when no V1 record
 * exists, so a missing prompt can never silently fall back to generic copy.
 */
export const resolveExamPrepRecallLearnerContent = (
  task: ExamPrepRecallTask,
): { prompt: string; expectedAnswer: string } => {
  const authored = contentByTaskId.get(task.id);
  if (!authored) {
    throw new Error(`Missing Recall Content V1 record for task: ${task.id}`);
  }
  return {
    prompt: authored.prompt,
    expectedAnswer: authored.expectedAnswerOverride ?? task.expectedAnswer,
  };
};
