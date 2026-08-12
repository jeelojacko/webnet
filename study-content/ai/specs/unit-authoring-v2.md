# WebNet Unit Authoring v2

Unit Authoring is educational authoring, not generic statute summarization.

Use only supplied legal source/context. Do not browse, use outside legal knowledge, rely on legal memory, add common-law principles, predict court interpretation, infer unstated consequences, supply outside definitions, or add current-law updates.

Use `operativeSourceText` for authoring. `exactSourceText` is for verification where needed. `sourceMetadata` is not operative law.

The `AUTHORING SOURCE GROUP` is the approved group. `CONTEXT FOR UNDERSTANDING ONLY` may help you understand the provision, but every substantive learning objective must ground to a sourceKey in the approved authoring group.

Honor Pass A. Use `approvedGroup`, `mapDisposition`, `mapReason`, and `approximateLearningGoal`. You may refine title, wording, objective breakdown, and main question. You must not silently expand or replace the approved source grouping. If the approved grouping appears wrong, add warning `MAP_GROUPING_RECONSIDERATION_RECOMMENDED`.

`proposal.sourceKeys` must equal the approved authoring group sourceKeys. Context-only source keys may appear only in explicit context/reference fields.

Authoring order:

1. Understand the approved learning goal.
2. Identify concepts worth recalling.
3. Write learning objectives.
4. Write natural guided questions.
5. Write concise source-faithful study answers.
6. Ground every substantive objective.

Main recall question should test the StudyUnit as a whole and identify the legal subject. Prefer forms such as `Explain...`, `How does... work?`, `What requirements govern...?`, `What authority and limitations apply...?`, `What process applies when...?`, or `What rules govern...?`.

Avoid generic prompts such as `What must a person do?`, `What does section 10 provide?`, `What rule applies?`, or `What power or duty exists?` unless the source truly warrants a simple question.

Each learning objective should test one coherent learnable idea. Do not write `Know section 10` or create an objective merely because a subsection exists. Do not omit substantive learning content merely to keep objective count small.

Guided questions should be natural, specific, and make sense without the source text immediately visible.

Study answers should be shorter and easier to recall than the source where feasible. Preserve statutory terminology, important qualifiers, actors, triggers, conditions, deadlines, quantities, amounts, percentages, required information, exceptions, filing destinations, legal effects, appeal rights, offences, penalties, and essential cross-references.

Preserve numeric and deadline fidelity. Do not introduce unsupported integers, decimals, currency amounts, percentages, dates, durations, section citations, subsection citations, or paragraph citations.

Never convert `may` into `must`, `shall` into `may`, or assign one actor's duty/power to another actor.

If a useful surveying/practice connection is an inference, place it only in `studyNotes` with `basis: "inference"`, never in a source-grounded study answer.

Every substantive objective must include the smallest useful exact or near-exact evidence excerpt. Evidence sourceKey must belong to the approved source group.

Include `sourceCoverage` when subsections or child labels are available. Mark child labels as `covered`, `context-only`, `intentionally-omitted`, or `not-assessed`; intentional omissions need a reason.

Return one JSON object per job line matching `AiStudyUnitProposal` schemaVersion 1. Preserve `jobId`, `runId`, `inputHash`, `corpusContentHash`, and `promptSpecVersion`.
