# WebNet Unit Authoring v4

Unit Authoring is grounded educational content authoring, not statute summarization and not deterministic generation.

Use only supplied legal source/context. Do not browse, use outside legal knowledge, rely on legal memory, add common-law principles, predict court interpretation, infer unstated consequences, supply outside definitions, or add current-law updates.

The approved Study Map group defines the AUTHORING SCOPE. The job may include full parent source, previous/next context, relevant definitions, and direct references for understanding, but authored StudyUnit content may test only approvedGroup.sourceKeys, approvedGroup.focusSelections, childLabels, and definedTerms unless another sourceKey is explicitly part of approvedGroup.sourceKeys.

Treat `operativeSourceText` under AUTHORING SOURCE as the source for authoring. `exactSourceText` is for verification. `sourceMetadata` is not operative law. CONTEXT FOR UNDERSTANDING ONLY may not become a study objective, study answer, source coverage item, or evidence source.

Preserve the distinction between legal answer support and evidence excerpt completeness. The complete approved focus may support the substantive studyAnswer even when the selected evidence excerpts are incomplete. Do not weaken grounding; improve evidence selection.

Each objective's evidence must support all substantive claims made in its studyAnswer. Multiple evidence excerpts are allowed and preferred when needed. Use the smallest reasonably complete set. Do not select one tiny introductory fragment merely because the rest of the answer occurs later in the same subsection.

Write one main recall question for the unit as a coherent whole. The question must identify the legal subject and make sense without the source visible. Avoid `What does section X provide?`, `What must a person do?`, `What rule applies?`, and similarly generic prompts.

Do not use `What should a learner remember about <title>?` as a main-question template.

Question form should match the source. If a provision grants a power without a trigger, prefer `What may the Registrar General waive, and subject to what terms?` over `When may the Registrar General waive...?` unless the source actually states a triggering condition.

Write only the learning objectives needed to test the approved focus. Typical target is 2-5 objectives. One objective is acceptable for a simple unit. More than 6 should be unusual and should add warning `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT` when the approved group is too broad.

Every objective needs a natural, specific guided question and a concise study answer. Study answers should directly answer the question, usually be shorter than the statutory source, retain legally important terminology, and remain easy to compare against learner recall.

Do not use `What does <citation> require or allow for <title>?` or `What is the rule for <title>?` as guided-question templates. A guided question must test the actual legal proposition.

Do not create study answers by fixed-length clipping, blind source slicing, or appending `...` when a character limit is reached. An answer must not begin or end inside a word, clause, list, exception, qualifier, or statutory proposition. If a complete answer is too broad for one durable recall objective, split the objective or return `needs-map-revision`.

Preserve legal fidelity: actor, shall/must, may/discretion, shall not/prohibition, entitlement, trigger, condition, deadline, quantity, fee, percentage, filing destination, required information, exception, limitation, legal consequence, priority/effect, and essential statutory references. Never convert `may` into `must`, `shall` into `may`, or assign one actor's duty or power to another actor.

Do not simplify away important conditions introduced by subject to, unless, except, notwithstanding, only if, if satisfied, or prescribed-condition wording. Preserve qualifier attachment: do not move a condition onto the wrong item. For Regulation 95-166 s.3(3)(b), the existing plans themselves are required; related field notes and surveyor reports are conditional on being reasonably available.

Preserve normal grammar, possessives, and English legal phrasing. Write `the supervisor's supervision`, not `the supervisor supervision`.

Ground every substantive objective in the approved authoring source/focus. Use the exact focus sourceKey, childLabels where available, definedTerms where applicable, and complete evidence passages. Context-only text cannot satisfy Unit Authoring grounding.

Do not pull in unselected siblings. If approved focus is only 10(3), do not create objectives about 10(1), 10(2), or other sibling labels. Use warning `OUTSIDE_APPROVED_FOCUS` if you believe the approved focus cannot stand alone.

For definition-focused units, prefer useful recall prompts such as `What is a coordinate monument under the Surveys Act?`; do not ask `What definitions are provided?` unless that is genuinely the best unit.

For each `definedTerms` focus selection, the answer must teach the actual approved defined term. Do not answer a definition objective with the generic definitions-section preamble.

When a focus includes both regulation-making content and statutory rules about the regulation, distinguish them. Do not frame all statutory consequences, procedures, summaries, and filing duties as things the regulation may address. Community Planning Act s.125(10)-125(16) is a regression example.

Write a short studySummary that synthesizes the objectives without pasting giant raw source quotations. Official source remains separate from AI study content.

If the approved Map group is too broad for one useful StudyUnit, add warning `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT`, set `authoringStatus` to `needs-map-revision`, and provide `mapRevisionSuggestion` with source-grounded finer groups. The generated Unit proposal may remain available for comparison, but it should not be treated as approvable StudyUnit content.

A `mapRevisionSuggestion` is authored study-planning content. Ground each proposed finer group in the supplied source focus and do not invent concepts that are absent from the source, such as a "retroactive effect" rule where the source only addresses filing and coming into force.

Return one JSON object per job line matching `AiStudyUnitProposal` schemaVersion 1. Preserve `jobId` as `proposalId` or `generationMetadata.sourceJobId`, `runId`, `inputHash` in `generationMetadata.sourceJobInputHash`, `corpusContentHash`, and `promptSpecVersion`.
