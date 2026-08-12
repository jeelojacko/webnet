# WebNet Unit Authoring v3

Unit Authoring is grounded educational content authoring, not statute summarization and not deterministic generation.

Use only supplied legal source/context. Do not browse, use outside legal knowledge, rely on legal memory, add common-law principles, predict court interpretation, infer unstated consequences, supply outside definitions, or add current-law updates.

The approved Study Map group defines the AUTHORING SCOPE. The job may include full parent source, previous/next context, relevant definitions, and direct references for understanding, but authored StudyUnit content may test only approvedGroup.sourceKeys, approvedGroup.focusSelections, childLabels, and definedTerms unless another sourceKey is explicitly part of approvedGroup.sourceKeys.

Treat `operativeSourceText` under AUTHORING SOURCE as the source for authoring. `exactSourceText` is for verification. `sourceMetadata` is not operative law. CONTEXT FOR UNDERSTANDING ONLY may not become a study objective, study answer, source coverage item, or evidence source.

Write one main recall question for the unit as a coherent whole. The question must identify the legal subject and make sense without the source visible. Avoid `What does section X provide?`, `What must a person do?`, `What rule applies?`, and similarly generic prompts.

Write only the learning objectives needed to test the approved focus. Typical target is 2-5 objectives. One objective is acceptable for a simple unit. More than 6 should be unusual and should add warning `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT` when the approved group is too broad.

Every objective needs a natural, specific guided question and a concise study answer. Study answers should directly answer the question, usually be shorter than the statutory source, retain legally important terminology, and remain easy to compare against learner recall.

Preserve legal fidelity: actor, shall/must, may/discretion, shall not/prohibition, entitlement, trigger, condition, deadline, quantity, fee, percentage, filing destination, required information, exception, limitation, legal consequence, priority/effect, and essential statutory references. Never convert `may` into `must`, `shall` into `may`, or assign one actor's duty or power to another actor.

Do not simplify away important conditions introduced by subject to, unless, except, notwithstanding, only if, if satisfied, or prescribed-condition wording.

Ground every substantive objective in the approved authoring source/focus. Use the exact focus sourceKey, childLabels where available, definedTerms where applicable, and the smallest useful evidence passages. Context-only text cannot satisfy Unit Authoring grounding.

Do not pull in unselected siblings. If approved focus is only 10(3), do not create objectives about 10(1), 10(2), or other sibling labels. Use warning `OUTSIDE_APPROVED_FOCUS` if you believe the approved focus cannot stand alone.

For definition-focused units, prefer useful recall prompts such as `What is a coordinate monument under the Surveys Act?`; do not ask `What definitions are provided?` unless that is genuinely the best unit.

Write a short studySummary that synthesizes the objectives without pasting giant raw source quotations. Official source remains separate from AI study content.

If the approved Map group is too broad for one useful StudyUnit, add warning `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT`, explain why in studyNotes or summary, and still produce the best proposal you reasonably can. If not possible, use low confidence and warning `NEEDS_HUMAN_REVIEW`.

Return one JSON object per job line matching `AiStudyUnitProposal` schemaVersion 1. Preserve `jobId` as `proposalId` or `generationMetadata.sourceJobId`, `runId`, `inputHash` in `generationMetadata.sourceJobInputHash`, `corpusContentHash`, and `promptSpecVersion`.
