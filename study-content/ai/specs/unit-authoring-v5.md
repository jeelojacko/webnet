# WebNet Unit Authoring v5

Unit Authoring is grounded educational content authoring, not statute summarization and not deterministic generation.

Use only supplied legal source/context. Do not browse, use outside legal knowledge, rely on legal memory, add common-law principles, predict court interpretation, infer unstated consequences, supply outside definitions, or add current-law updates.

The approved Study Map group defines the AUTHORING SCOPE. The job may include full parent source, previous/next context, relevant definitions, and direct references for understanding, but authored StudyUnit content may test only approvedGroup.sourceKeys, approvedGroup.focusSelections, childLabels, and definedTerms unless another sourceKey is explicitly part of approvedGroup.sourceKeys.

Treat `operativeSourceText` under AUTHORING SOURCE as the source for authoring. `exactSourceText` is for verification. `sourceMetadata` is not operative law. CONTEXT FOR UNDERSTANDING ONLY may not become a study objective, study answer, source coverage item, or evidence source.

Preserve the distinction between legal answer support and evidence excerpt completeness. The complete approved focus may support the substantive studyAnswer even when the selected evidence excerpts are incomplete. Do not weaken grounding; improve evidence selection.

## Exact evidence discipline

Each objective's evidence must copy the approved source VERBATIM, character for character, from the supplied `exactSourceText`. Preserve every spacing anomaly, OCR artifact, hyphenation, punctuation mark, and capitalization exactly as supplied. Do not silently repair the authoritative corpus: do not join split words (`Registr ar` stays `Registr ar`), do not normalize spacing around hyphens or words (`by - laws` stays `by - laws`), do not fix letter case, and do not add or remove punctuation or whitespace. A "cleaned-up" quotation is a wrong quotation and will be rejected.

Each objective's evidence must support all substantive claims made in its studyAnswer. Multiple evidence excerpts are allowed and preferred when needed. Use the smallest reasonably complete set. Do not select one tiny introductory fragment merely because the rest of the answer occurs later in the same subsection.

## Questions

Write one main recall question for the unit as a coherent whole. The question must identify the legal subject and make sense without the source visible. Avoid `What does section X provide?`, `What must a person do?`, `What rule applies?`, and similarly generic prompts.

Do not use `What should a learner remember about <title>?` as a main-question template.

Question form should match the source. If a provision grants a power without a trigger, prefer `What may the Registrar General waive, and subject to what terms?` over `When may the Registrar General waive...?` unless the source actually states a triggering condition.

Concision targets (authoring targets, not automatic rejection thresholds): the main question should be one natural sentence, preferably within about 180 characters; each guided question should preferably be within about 160 characters when feasible. Never sacrifice a natural, specific, recallable question or legal precision to hit a target.

Every objective needs a natural, specific guided question and a concise study answer. Study answers should directly answer the question, usually be shorter than the statutory source, retain legally important terminology, and remain easy to compare against learner recall.

Do not use `What does <citation> require or allow for <title>?` or `What is the rule for <title>?` as guided-question templates. A guided question must test the actual legal proposition.

Do not create study answers by fixed-length clipping, blind source slicing, or appending `...` when a character limit is reached. An answer must not begin or end inside a word, clause, list, exception, qualifier, or statutory proposition. If a complete answer is too broad for one durable recall objective, split it across objectives.

Preserve legal fidelity: actor, shall/must, may/discretion, shall not/prohibition, entitlement, trigger, condition, deadline, quantity, fee, percentage, filing destination, required information, exception, limitation, legal consequence, priority/effect, and essential statutory references. Never convert `may` into `must`, `shall` into `may`, or assign one actor's duty or power to another actor.

Do not simplify away important conditions introduced by subject to, unless, except, notwithstanding, only if, if satisfied, or prescribed-condition wording. Preserve qualifier attachment: do not move a condition onto the wrong item. For Regulation 95-166 s.3(3)(b), the existing plans themselves are required; related field notes and surveyor reports are conditional on being reasonably available.

Preserve normal grammar, possessives, and English legal phrasing. Write `the supervisor's supervision`, not `the supervisor supervision`.

## Grounding and coverage

Ground every substantive objective in the approved authoring source/focus. Use the exact focus sourceKey, childLabels where available, definedTerms where applicable, and complete evidence passages. Context-only text cannot satisfy Unit Authoring grounding.

Do not pull in unselected siblings. If approved focus is only 10(3), do not create objectives about 10(1), 10(2), or other sibling labels. Use warning `OUTSIDE_APPROVED_FOCUS` if you believe the approved focus cannot stand alone.

`sourceCoverage` must declare every selected childLabel exactly once: either status `covered` with the objectiveIds that teach it, or status `intentionally-omitted` with a nonblank, source-grounded reason. Do not add unselected sibling labels or sourceKeys to `sourceCoverage`. For every approved `definedTerm`, the objectives must teach the actual term meaning. Coverage failures are authoring failures to fix inside the proposal; they are never a reason for `needs-map-revision`.

For definition-focused units, prefer useful recall prompts such as `What is a coordinate monument under the Surveys Act?`; do not ask `What definitions are provided?` unless that is genuinely the best unit.

For each `definedTerms` focus selection, the answer must teach the actual approved defined term. Do not answer a definition objective with the generic definitions-section preamble.

When a focus includes both regulation-making content and statutory rules about the regulation, distinguish them. Do not frame all statutory consequences, procedures, summaries, and filing duties as things the regulation may address. Community Planning Act s.125(10)-125(16) is a regression example.

Write a short studySummary that synthesizes the objectives without pasting giant raw source quotations. Official source remains separate from AI study content.

## Authoring status and map-revision contract

`generated` is the default and expected outcome. A unit is `generated` when the approved focus supports one coherent, durable StudyUnit. A long parent source, multiple related propositions, context material, or the mere existence of alternative possible finer splits do NOT make a group too broad. A `generated` proposal MUST NOT include `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT` in warnings and MUST NOT include `mapRevisionSuggestion`; combining them is invalid.

`needs-map-revision` is exceptional. Use it only when the approved FOCUS ITSELF (not the full parent source) cannot form one coherent, durable StudyUnit without (a) excessive objectives (well beyond a coherent 2-5 range), (b) requiring unrelated recall across disjoint legal propositions, or (c) losing legally important detail.

When `needs-map-revision` is used, all three of the following are mandatory together:

1. Warning `MAP_GROUP_TOO_BROAD_FOR_GOOD_UNIT` in warnings.
2. A `mapRevisionSuggestion` with a source-grounded `reason` and at least two finer proposed groups.
3. A non-contradictory explanation: the `reason` must state why the approved focus cannot stand as one coherent unit. It must never contain contradictory phrases such as `no revision needed`, `no further revision is required`, `no structural change required`, `appropriately scoped as a single unit`, or `current grouping is appropriate`.

A `mapRevisionSuggestion` is authored study-planning content constrained to the approved focus. It may only partition the approved focusSelections, their childLabels, and their definedTerms. It must not expand into unselected siblings, add sourceKeys outside approvedGroup.sourceKeys, or move approved focus content outside the approved selections. Ground each proposed finer group in the supplied source focus and do not invent concepts that are absent from the source, such as a "retroactive effect" rule where the source only addresses filing and coming into force.

## Output

Return one JSON object per job line matching `AiStudyUnitProposal` schemaVersion 1. Preserve `jobId` as `proposalId` or `generationMetadata.sourceJobId`, `runId`, `inputHash` in `generationMetadata.sourceJobInputHash`, `corpusContentHash`, and `promptSpecVersion`.
