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
