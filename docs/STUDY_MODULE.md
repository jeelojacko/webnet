# Study Module

## Scope
The study module is an isolated local-first application at `/study` for New Brunswick statute law and survey-law study workflows.

It does not use adjustment, parser, solver, network, or Survey CAD domain state.

## File Structure
- `src/study/studyTypes.ts` - record contracts for documents, units, prompts, concepts, rubrics, progress, attempts, drafts, settings, and snapshots
- `src/study/studySeed.ts` - five initial New Brunswick statute document records plus sample units, concepts, prompts, and initial progress
- `src/study/studyScheduler.ts` - phase transition and session ordering rules
- `src/study/studyStorage.ts` - IndexedDB schema, seed loading, migrations, CRUD/replace operations, and atomic official-content package import
- `src/study/studyOfficialContent.ts` - official package parsing, browser import validation, preview, source-reference review flags, reference-only form detection, and source-selection study-unit creation
- `src/study/studyDraftGeneration.ts` - deterministic title, question, citation, reference-answer, and conservative concept drafting for source-linked study units
- `src/study/studyRubricGeneration.ts` - deterministic answer-rubric templates and legal-provision rubric generation
- `src/study/studyLibrarySearch.ts` - in-memory categorized Library search index and matching helpers
- `src/study/studyOpfs.ts` - OPFS path generation and source-file text asset writes
- `src/study/studyExportImport.ts` - JSON export/import round trip helpers
- `src/study/useStudyApp.ts` - route-local state, autosave, reveal/rating flow, and persistence orchestration
- `src/study/StudyApp.tsx` and `src/study/components/*` - dashboard, library, document, session, and manage pages
- `tests/study/*` - focused storage, scheduler, OPFS, separation, autosave, and attempt-persistence coverage

## IndexedDB Schema
Database: `webnet.study.v1`

Version: `4`

Stores:
- `documents`, key `id`: source metadata such as title, kind, jurisdiction, category, priority, summary, and OPFS source-file asset records
- `units`, key `id`: learnable topics with editable summaries and reference answers. Units now carry `sourceMode: "official" | "custom"`. Official units keep document IDs, section refs, and source references; custom units keep those source fields empty and may carry tags, notes/citation text, and an optional custom source URL.
- `prompts`, key `id`: guided recall, free recall, identification, scenario, or comparison prompts linked to units and concepts
- `concepts`, key `id`: required checklist concepts linked to units, including generated/manual origin and deterministic display order
- `rubrics`, key `id`: structured answer-rubric items linked to study units, including category, prompt, reference answer, required flag, generated/manual origin, display order, and optional source references
- `progress`, key `unitId`: current phase, due date, successful separate-day counters, and review counts
- `attempts`, key `id`: immutable completed attempts with answer text, covered concepts, rating, and timestamps
- `drafts`, key `id`: autosaved in-progress typed answers
- `settings`, key `id`: configurable phase rules, priority limit, and schema version
- `legalDocuments`, key `id`: imported authoritative legal document metadata, package IDs, official citation/title, source URL, fetch/import dates, content hash, parent Act and enabling Act metadata
- `legalComponents`, key `recordKey`: imported authoritative components keyed by `{documentId}::{sourceKey}`, including sections, schedules, forms, source text, source hash, subsections, and extraction status
- `importHistory`, key `id`: compact official-package import history with added/changed counts, reference-only form counts, and flagged-unit counts

Schema migration currently normalizes imported or partially missing snapshots to schema version `4`, fills default settings, defaults official-content stores to empty arrays, adds unit source mode, adds concept origin/order fields, adds the rubric store, and keeps existing Study data intact. Existing concepts without origin default to manual unless the linked unit already records generated concepts. Legacy snapshots without rubrics receive conservative supplemental `custom` rubric rows from existing concepts with empty reference answers, so migration does not invent legal answers or delete concept content.

## OPFS Layout
Source and backup assets use generated paths under:

```text
study/documents/{document-id}/{role}/{file-name}
```

Roles are:
- `raw-html`
- `pdf`
- `imported-source`
- `normalized-markdown`
- `backup`

Authoritative source files are tracked by OPFS path in `StudyDocument.sourceFiles`. User-editable summaries and reference answers remain in `StudyUnit` or `StudyPrompt` records.

## Official NB Law Pilot Content
Phase 2A adds a development-side official-source pipeline for a small New Brunswick legislation pilot. The pilot manifest is:

```text
study-content/manifests/nb-law-pilot.json
```

The manifest is versioned and lists only the five seeded Acts plus five key regulations. Each entry carries a stable internal document ID, manual-listed title, current title, source type, optional explicit laws.gnb corpus (`cs`, `cr`, or `ar`), official source identifier, parent Act ID for regulations, priority, categories, tags, expected citation, and enabled status. The Community Planning pilot regulation is `reg-community-planning-80-159` (`80-159`, Provincial Subdivision), not annual regulation `2019-29`; `2019-29` is a Highway Act document and must not be packaged under the Community Planning Act.

The commands are:

```bash
npm run study:fetch-nb-laws
npm run study:normalize-nb-laws
npm run study:build-content-pack
```

`study:fetch-nb-laws` fetches only enabled manifest entries from `laws.gnb.ca`, one request at a time, with a delay between requests and a descriptive User-Agent. It writes untouched raw HTML plus per-document metadata under `study-content/raw/nb-law-pilot/`. Change detection uses a SHA-256 hash after removing volatile laws.gnb generated anchor IDs; the raw HTML file is still saved untouched when canonical source content changes.

`study:normalize-nb-laws` converts fetched HTML into exact-text structured JSON under `study-content/normalized/nb-law-pilot/` and writes matching Markdown inspection files. The normalizer strips script/style/form chrome, extracts title, citation, consolidated-to text, table of contents, ordered sections, subsections where reliable, section labels/headings, exact source text with safe whitespace normalization, content hashes, and parser notes.

`study:build-content-pack` combines normalized documents into:

```text
study-content/packages/nb-law-pilot.content-package.json
```

The package includes document metadata, ordered legal components, structured sections and subsections, schedules/forms as independent components, Act-regulation relationships, extracted enabling Acts, source hashes, package creation date, and schema version. Raw HTML, normalized exact source text, and user-authored study content remain separate layers.

Package construction also writes:

```text
study-content/reports/nb-law-pilot.integrity-report.json
study-content/reports/nb-law-pilot.integrity-report.md
```

The integrity report fails package construction on wrong enabling Act relationships, missing required documents, duplicate component source keys, table-of-contents references without components, known laws.gnb.ca interface contamination, zero extracted legal components, and missing title or citation. Warnings are reserved for non-destructive parser observations such as genuinely missing consolidation dates.

Stable source references are based on legal labels:

```text
section:3
section:3/subsection:1.1
schedule:schedule-a
form:form-1
```

Current live pilot normalization yields:
- Surveys Act: 16 sections
- Boundaries Confirmation Act: 21 sections
- Community Planning Act: 164 sections
- Registry Act: 84 sections
- Land Titles Act: 106 sections
- N.B. Reg. 84-76: 8 sections
- N.B. Reg. 95-166: 11 sections
- N.B. Reg. 80-159: 10 sections
- N.B. Reg. 84-190: 4 sections
- N.B. Reg. 83-130: 40 sections

Current live pilot component counts from the integrity report:
- Surveys Act: 16 sections, 19 subsections, 1 schedule, 0 forms
- Boundaries Confirmation Act: 21 sections, 51 subsections, 0 schedules, 0 forms
- Community Planning Act: 164 sections, 446 subsections, 1 schedule, 0 forms
- Registry Act: 84 sections, 115 subsections, 0 schedules, 0 forms
- Land Titles Act: 106 sections, 284 subsections, 0 schedules, 0 forms
- N.B. Reg. 84-76: 8 sections, 2 subsections, 0 schedules, 0 forms
- N.B. Reg. 95-166: 11 sections, 18 subsections, 0 schedules, 1 form
- N.B. Reg. 80-159: 10 sections, 18 subsections, 0 schedules, 0 forms
- N.B. Reg. 84-190: 4 sections, 5 subsections, 0 schedules, 0 forms
- N.B. Reg. 83-130: 40 sections, 66 subsections, 4 schedules, 63 forms

Known laws.gnb pilot findings:
- Some pages emit volatile generated anchor names in otherwise identical HTML responses, so the fetch command canonicalizes those anchor IDs only for hash comparison.
- New Brunswick Regulation 2019-29 is available through an annual regulation path but is a Highway Act regulation concerning the Route 11 Caraquet Bypass, so it was removed from the Community Planning pilot.
- The laws.gnb site can return a missing-document message with HTTP 200; the fetcher treats that page as a failed required document.
- Some laws.gnb pages include context-menu and search/navigation markup after the legal body; the normalizer cuts at the legal body boundary and package construction also scans for known interface markers.

Parser fixtures live under:

```text
tests/fixtures/study/nb-law-pilot/html/
```

They are compact saved HTML fixtures for all ten pilot entries. The fixtures preserve the laws.gnb section/title/citation markup patterns used by the normalizer without embedding the full official corpus in tests.

## Official Package Import
`/study/manage` supports importing the generated official content package from pasted JSON or a selected `.json` file. Browser import validation checks schema version, package and manifest IDs, unique document IDs, unique component `sourceKey`s per document, valid Act-regulation relationships, TOC source keys, required metadata, component hashes, document source-hash consistency, embedded integrity errors, forbidden laws.gnb.ca interface markers, and non-empty legal components.

The preview groups new, updated, unchanged, and absent existing documents; new, changed, removed, and unchanged components; reference-only forms; and units that will require source review. Import writes official records atomically across `documents`, `units`, `legalDocuments`, `legalComponents`, and `importHistory`. Official text is stored only in `legalComponents`; it is not copied into editable summaries, prompts, concepts, attempts, progress, or drafts.

For testing, Manage also exposes `Delete All Data`. After confirmation, it replaces the browser Study database with an empty valid snapshot: no documents, official legal records, units, prompts, concepts, rubrics, progress, attempts, drafts, or import history remain. Default Study settings are recreated so the app can immediately import a package or create new custom content. Because the settings record remains present, reloads do not auto-seed the original sample study records after a reset.

Study units linked to official source material store `documentId`, `sourceKey`, and `contentHashAtLinkTime`. Later package imports mark `sourceReviewRequired` or `sourceReferenceMissing` when linked components change or disappear. Acknowledging review updates link-time hashes for still-present components and records `sourceReviewAcknowledgedAt`.

## Reference-Only Forms
Some prescribed forms normalize only as a label. Import classifies a form as `reference-only` when its normalized text, after trimming whitespace and optional consolidation text, contains only its own label. These forms remain navigable, keep source keys and hashes, display an incomplete-body warning, and require explicit confirmation before selection for study-unit creation. Short statutory sections such as repealed provisions are not classified as form stubs.

## Navigation Shell
The Study sidebar is compact and collapsible on desktop. Expanded width is just wide enough for the full navigation labels and collapsed width is 2.875rem. The collapsed state is stored on `StudySettings.studySidebarCollapsed`, restored after reload, and changed through an accessible icon button. Expanded entries show icon plus text; collapsed entries keep icon-only visible chrome with accessible labels and title tooltips. The selected route continues to expose `aria-current="page"` and the main content immediately uses the released width.

## Legal Reader
`/study/document/:id` displays imported official metadata, Act-regulation navigation, source URL, content hash, consolidated-to date, fetch/import dates, package ID, and safe React-rendered normalized text. The user-authored document summary remains in a visually separate editor.

The reader supports table-of-contents navigation, case-insensitive search, section/schedule/form filtering, expand/collapse, subsection display, copy reference/text, component selection, and creating a generated draft study unit from selected official components. TOC, hash, and Library search-result navigation opens the selected section, schedule, form, or subsection with one click, expands subsection parents before scrolling, updates the hash, waits for React to commit the expanded DOM, performs exactly one `scrollIntoView({ behavior: "auto", block: "start" })`, focuses the heading with `preventScroll: true`, and applies a short focus highlight without another scroll. Development builds log a compact timing diagnostic for this navigation path. Created units store source references with current component hashes, generate editable study content, and then open `/study/unit/:id/edit`.

## Library
The Library uses top-level `Documents` and `Study Units` tabs.

A unified search bar sits near those tabs with placeholder `Search documents, provisions and study units`. Search uses a prebuilt in-memory index refreshed whenever the Study snapshot changes. The index records document metadata, official provision labels/headings/source keys/subsection labels/exact text, study-unit titles/questions/reference answers/summaries/rubric prompts/rubric answers/concepts/tags, and custom citation notes.

Matching is case-insensitive and accent-insensitive. Short metadata fields use weighted substring, token, and fuzzy matching. Long official source text uses normalized substring matching only, so complete statutory bodies are not fuzzied on every keystroke. Highlighting maps normalized match offsets back to original text before rendering, so punctuation and whitespace normalization do not shift the marked word. The UI debounces input by 120 ms, groups results as `Documents`, `Official Provisions`, `Study Units`, and `Custom Units`, shows counts for each category, highlights matched snippets, and supports keyboard result navigation with Up/Down/Enter. Document results open the document, official-provision results open the document at the source-key hash, and unit/custom-unit results open the unit editor.

Documents can be filtered by all, Acts, regulations, or custom sources. Document rows show priority, category, parent Act where applicable, consolidation date, source review counts, study-unit count, and reference-only form count.

Study units can be filtered by source-linked, custom, needs-review, and learning phase. Unit rows show title, related Act/regulation or custom grouping, selected section references, priority, category, phase, concept count, prompt count, source-review state, last modified date, and attempt count. Sorting supports related source, unit title, priority, phase, last modified, and attempt count. Groups are collapsible and regulation-linked units include the parent Act in the group label so both records are discoverable.

## Automatic Study-Unit Drafting
Creating a unit from selected official source components now generates:
- a study-unit title from document title, selected labels, and headings
- one guided-recall question using deterministic heading/text templates
- a structured exact-wording reference-answer draft
- a read-only citation summary
- optional conservative concept suggestions

The content layers remain separate:
- exact official source text stays in `legalComponents` and is displayed read-only in the unit editor
- deterministic generated drafts live on `StudyUnit`, `StudyPrompt`, and `StudyConcept`
- user edits are saved back only to those study records

Reference-answer generation defaults to structured exact wording. It preserves selected source order, groups subsections under their section, strips repeated labels where safe, excludes amendment-history and consolidation-note text by default, includes repealed provisions as `Repealed.`, and avoids legal interpretation or broad paraphrase. The editor can switch the answer format to complete exact source text or empty.

Generated field state is tracked on `StudyUnit.generatedContentState` for title, question, reference answer, study summary, and concepts. Regeneration controls confirm before replacing a user-edited field. Existing source-linked units expose `Generate Missing Study Content`, which fills only empty generated fields and does not overwrite manual titles, prompts, reference answers, summaries, concepts, progress, attempts, or drafts.

## Answer Rubrics
Answer rubrics are now the primary study-session assessment structure. A rubric item has a category such as purpose, scope/trigger, actor, power/duty, required material, procedure, notice, deadline/number, limit/exception, legal effect, filing/record, survey relevance, related provision, or custom. Each item carries an editable prompt and reference answer plus generated/manual origin and source-reference metadata when generated from official text.

Creating a source-linked legal unit now generates structured rubric items in addition to the older concept suggestions. For legal provisions, `generateStudyRubric` classifies subsection wording deterministically using statutory signals such as `subject to`, `if`, `on receiving`, `may`, `shall`, `notice`, numeric deadlines, filing/registry language, legal-effect wording, and cross-references. Generated reference answers stay close to the source subsection wording and survey-relevance notes are explicitly labelled as study notes.

Section 16 of the Boundaries Confirmation Act has deterministic coverage for correction purpose, Registrar General authority and evidence threshold, discretionary notice, confirmed-boundary limitation, corrected-plan filing, superseded-plan notation, related subsection 15(2), and clear survey relevance.

The unit editor shows `Answer Rubric` above `Keywords / Concepts`. Users can add, edit, duplicate, reorder, delete, apply templates, add generated items, replace only generated items, and clear generated items. Manual rubric rows are not overwritten by generated replacement actions.

Every Library and document-reader study-unit row includes `Preview`. Preview opens `/study/unit/:id/preview`, renders the real session UI for that unit, allows typed guided/free/hybrid responses, allows reveal, shows reference answers, rubric self-assessment, and exact official source text when linked. Preview state is local to the preview page and does not create attempts, advance phase, change progress, alter statistics, save drafts, or persist temporary responses. Closing Preview returns to the Library Study Units tab.

## Keywords / Concepts
Required concepts are editable checklist rows. The unit editor supports `+ Add Concept`, Enter-to-save normalization, Escape cancellation for empty new rows, delete, and up/down reordering. Duplicate labels are rejected case-insensitively after punctuation and whitespace normalization. Empty concepts are dropped on save. Generated and manual concepts are both editable and removable.

Concept suggestions are generated by the pure deterministic `generateRequiredConcepts` function. It extracts defined terms, meaningful headings, subsection topics, actor/action/object requirements, deadlines and numerical requirements, legal effects, and conservative fallbacks for substantive non-repealed source text. It intentionally skips reference-only forms, repealed-only components, source URLs, consolidation-note-only text, and amendment-history noise.

The editor provides `Add Suggested Concepts`, `Replace Generated`, and `Replace All`. Adding suggestions preserves manual and generated concepts and adds only missing labels. Replacing generated concepts preserves manual concepts by default and requires confirmation; replacing all concepts is a separate confirmed action. Development builds may show a diagnostic panel with label, rule, confidence, and source key.

## Custom Study Units
`New Custom Study Unit` creates an unlinked unit with `sourceMode: "custom"`, empty official source references, editable title/category/priority/phase/tags, study summary, recall question, reference answer, required concepts, prompt type, optional notes/citation text, and optional custom source URL.

Custom units participate in sessions, attempts, drafts, import/export, editing, deletion with confirmation, duplication, and later scheduling work. They do not show missing-source warnings, official-text labels, or source-hash review flags.

## Session Rules
Initial phases:
- `unread`
- `guided-recall`
- `free-recall`
- `application`
- `maintenance`

Default transitions:
- completing reading moves `unread` to `guided-recall`
- two `Good` or `Easy` guided-recall attempts on separate days move to `free-recall`
- two `Good` or `Easy` free-recall attempts on separate days move to `application`
- one successful application attempt moves to `maintenance`

Due reviews sort before new units. New units are then selected by priority and deterministic title/id ordering.

Default response modes are phase-driven unless a unit override is set. Guided-recall uses guided mode with one answer textbox per rubric item. Free-recall, application, and maintenance use the large free-recall answer by default. Hybrid mode keeps the free-recall answer and guided rubric prompts available together. After reveal, the session shows the rubric reference answers and lets the learner mark each item as covered, partially covered, or missed. Attempts persist response mode, guided responses, and rubric coverage. Preview-specific mutation isolation is not part of this starter batch yet.

## Manual Test Procedure
1. Run `npm run dev` and open `/study`.
2. Open `Library`, choose a seeded document, edit a document summary, and save it.
3. Edit a unit study summary and reference answer, save it, then mark reading complete.
4. Open `Session`, type a long answer, refresh the browser, and confirm the answer restores.
5. Click `Reveal`, compare the answer with the reference, check concepts, rate `Good`, and confirm the attempt count increments on the dashboard.
6. Open `Manage`, copy the export JSON, paste it into import, import it, and confirm counts are restored.
7. In `Manage`, paste or choose `study-content/packages/nb-law-pilot.content-package.json`, validate preview, and confirm import.
8. Open `Library`, filter Acts/regulations, and confirm official metadata and review counts appear.
9. Switch between the `Documents` and `Study Units` tabs, filter source-linked/custom/needs-review units, and confirm grouped unit rows show concept, prompt, phase, source-review, modified-date, and attempt metadata.
10. Open `Surveys Act`, search for `Director of Surveys`, click a TOC/search result, and confirm the target opens, scrolls, highlights, focuses, and updates the hash without a second click.
11. Select section `3` or Schedule A, and create a study unit from the selection.
12. Confirm the unit editor opens with read-only official source text on the left and editable generated title/question/reference answer on the right.
13. Add, edit, delete, reorder, add suggested, and replace generated concepts; confirm manual concepts are preserved unless `Replace All` is explicitly confirmed.
14. Add, edit, duplicate, reorder, delete, apply template, add suggested rubric items, replace generated rubric items, and clear generated rubric items; confirm manual rubric items are preserved by replacement actions.
15. Create a custom study unit from Library, edit custom fields, save, duplicate it, delete the duplicate, and confirm the original appears in Session.
16. Edit the generated question, click `Regenerate question`, and confirm overwrite confirmation appears.
17. Save or cancel and confirm the app returns to the source document.
18. Open Session for a guided-recall unit and confirm rubric prompts each have their own answer box, reveal shows rubric reference answers, and coverage choices persist with the completed attempt.
19. Collapse and expand the desktop Study sidebar, refresh, and confirm the state is restored and the active route remains indicated.
20. In Library, search by document citation, fuzzy title, section number, exact official source text, study question, rubric prompt, and custom citation note. Confirm categorized counts and keyboard Up/Down/Enter navigation.
21. From Library search, open an official provision result and confirm its parent component expands, the target scrolls once, focus lands on the heading, and the highlight clears.
22. Preview a source-linked unit, type and reveal responses, mark rubric coverage, close preview, and confirm attempts, drafts, progress, and review counts did not change.
23. In Manage, click `Delete All Data`, cancel once, then confirm once; verify counts return to zero and the app can import the official package again.

## Official Content Manual Procedure
1. Run `npm run study:fetch-nb-laws`.
2. Run it a second time and confirm it reports `Unchanged: 10`.
3. Run `npm run study:normalize-nb-laws` and confirm all ten documents normalize with non-zero sections.
4. Run `npm run study:build-content-pack`.
5. Inspect `study-content/packages/nb-law-pilot.content-package.json`, `study-content/reports/nb-law-pilot.integrity-report.md`, and the Markdown files under `study-content/normalized/nb-law-pilot/`.
6. Confirm `reg-community-planning-80-159` is related to `doc-community-planning-act`, Registry Act has consolidation date `December 13, 2024`, Surveys Act section `3` exposes subsections `3(1)`, `3(1.1)`, `3(1.2)`, and `3(2)`, and Surveys Act `SCHEDULE A` is separate from section `15`.

## Phase 3 FSRS Boundary
Phase 2B intentionally keeps the existing deterministic phase scheduler. Phase 3 should add FSRS fields beside `StudyProgress`, preserve current phase/progress import compatibility, and use official-source review flags as a scheduling input rather than replacing legal-source integrity checks.
