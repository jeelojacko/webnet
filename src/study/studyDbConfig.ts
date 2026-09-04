// Study — shared IndexedDB configuration.
//
// Single source of truth for the Study database identity and the storage
// schema version. Both the Study storage layer (`studyStorage.ts`) and the
// derived-search worker persistence (`search/studySearchPersistence.ts`) must
// open the SAME database name at the SAME version so the search worker's
// readonly opens never trigger an upgrade/migration and never drift apart
// from the authoritative store set. Schema version 10 is the Exam Prep mock
// phase: the store set is exactly the legacy Study/AI stores plus five Exam
// Prep stores (`examPrepUnitProgress`, `examPrepRecallProgress`,
// `examPrepAttempts`, `examPrepSettings`, `examPrepMockSessions`).

export const STUDY_DB_NAME = 'webnet.study.v1';

/** IndexedDB open version — bump only with a real store/index migration. */
export const STUDY_DB_VERSION = 10;

/** Schema version stamped on every snapshot / settings record. */
export const STUDY_SCHEMA_VERSION = 10;
