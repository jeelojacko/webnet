# Study Module

## Scope
The study module is an isolated local-first application at `/study` for New Brunswick statute law and survey-law study workflows.

It does not use adjustment, parser, solver, network, or Survey CAD domain state.

## File Structure
- `src/study/studyTypes.ts` - record contracts for documents, units, prompts, concepts, progress, attempts, drafts, settings, and snapshots
- `src/study/studySeed.ts` - five initial New Brunswick statute document records plus sample units, concepts, prompts, and initial progress
- `src/study/studyScheduler.ts` - phase transition and session ordering rules
- `src/study/studyStorage.ts` - IndexedDB schema, seed loading, migrations, and CRUD/replace operations
- `src/study/studyOpfs.ts` - OPFS path generation and source-file text asset writes
- `src/study/studyExportImport.ts` - JSON export/import round trip helpers
- `src/study/useStudyApp.ts` - route-local state, autosave, reveal/rating flow, and persistence orchestration
- `src/study/StudyApp.tsx` and `src/study/components/*` - dashboard, library, document, session, and manage pages
- `tests/study/*` - focused storage, scheduler, OPFS, separation, autosave, and attempt-persistence coverage

## IndexedDB Schema
Database: `webnet.study.v1`

Version: `1`

Stores:
- `documents`, key `id`: source metadata such as title, kind, jurisdiction, category, priority, summary, and OPFS source-file asset records
- `units`, key `id`: learnable topics linked to document IDs and section references, with editable summaries and reference answers
- `prompts`, key `id`: guided recall, free recall, identification, scenario, or comparison prompts linked to units and concepts
- `concepts`, key `id`: required checklist concepts linked to units
- `progress`, key `unitId`: current phase, due date, successful separate-day counters, and review counts
- `attempts`, key `id`: immutable completed attempts with answer text, covered concepts, rating, and timestamps
- `drafts`, key `id`: autosaved in-progress typed answers
- `settings`, key `id`: configurable phase rules, priority limit, and schema version

Schema migration currently normalizes imported or partially missing snapshots to schema version `1` and fills default settings.

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

The manifest is versioned and lists only the five seeded Acts plus five key regulations. Each entry carries a stable internal document ID, manual-listed title, current title, source type, optional explicit laws.gnb corpus (`cs`, `cr`, or `ar`), official source identifier, parent Act ID for regulations, priority, categories, tags, expected citation, and enabled status.

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

The package includes document metadata, structured sections, Act-regulation relationships, source hashes, package creation date, and schema version. Raw HTML, normalized exact source text, and user-authored study content remain separate layers.

Current live pilot normalization yields:
- Surveys Act: 16 sections
- Boundaries Confirmation Act: 21 sections
- Community Planning Act: 164 sections
- Registry Act: 84 sections
- Land Titles Act: 106 sections
- N.B. Reg. 84-76: 8 sections
- N.B. Reg. 95-166: 11 sections
- N.B. Reg. 2019-29: 1 section
- N.B. Reg. 84-190: 4 sections
- N.B. Reg. 83-130: 40 sections

Known laws.gnb pilot findings:
- Some pages emit volatile generated anchor names in otherwise identical HTML responses, so the fetch command canonicalizes those anchor IDs only for hash comparison.
- New Brunswick Regulation 2019-29 is available through the annual regulation corpus path `/en/document/ar/2019-29`, not the consolidated regulation path `/en/document/cr/2019-29`.
- The laws.gnb site can return a missing-document message with HTTP 200; the fetcher treats that page as a failed required document.
- The annual 2019-29 page is an amendment regulation and currently normalizes as one operative section.

Parser fixtures live under:

```text
tests/fixtures/study/nb-law-pilot/html/
```

They are compact saved HTML fixtures for all ten pilot entries. The fixtures preserve the laws.gnb section/title/citation markup patterns used by the normalizer without embedding the full official corpus in tests.

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

## Manual Test Procedure
1. Run `npm run dev` and open `/study`.
2. Open `Library`, choose a seeded document, edit a document summary, and save it.
3. Edit a unit study summary and reference answer, save it, then mark reading complete.
4. Open `Session`, type a long answer, refresh the browser, and confirm the answer restores.
5. Click `Reveal`, compare the answer with the reference, check concepts, rate `Good`, and confirm the attempt count increments on the dashboard.
6. Open `Manage`, copy the export JSON, paste it into import, import it, and confirm counts are restored.

## Official Content Manual Procedure
1. Run `npm run study:fetch-nb-laws`.
2. Run it a second time and confirm it reports `Unchanged: 10`.
3. Run `npm run study:normalize-nb-laws` and confirm all ten documents normalize with non-zero sections.
4. Run `npm run study:build-content-pack`.
5. Inspect `study-content/packages/nb-law-pilot.content-package.json` and the Markdown files under `study-content/normalized/nb-law-pilot/`.
