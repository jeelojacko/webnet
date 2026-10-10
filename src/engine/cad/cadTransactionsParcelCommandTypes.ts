/**
 * STRUCT-195.4 CAD parcel command payload type leaf.
 *
 * Type-only module. It owns the seven parcel command payload interfaces
 * (designate, number, link, unlink, shared edit, check, schedule) plus the
 * shared-edit edit union, extracted verbatim (key literals, field names,
 * optionality, ordering, and comments unchanged) from their execution
 * modules so the transaction hub can depend on this leaf WITHOUT the
 * command-family cycle that previously tied the parcel payloads into the
 * transaction SCC.
 *
 * Contract: type-only imports only. It imports the primitive identity alias
 * from the zero-import core leaf, the parcel structure types from `cadTypes`,
 * and the numbering options type from `cadParcelPlanDesignation`; it must
 * never import a value, a command definition, a runtime service,
 * `cadTransactions.ts`, `cadTransactions.types.ts`, `cadParcelSharedEdit.ts`,
 * or any parcel execution module, and it declares no runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';
import type {
  CadParcelCourseGeometry,
  CadParcelPlanRole,
  CadParcelSharedBoundaryEnd,
} from './cadTypes';
import type { ParcelNumberingOptions } from './cadParcelPlanDesignation';

export interface ParcelDesignateCommand {
  key: 'PARCELDESIGNATE';
  parcelEntityIds: CadEntityId[];
  designation?: string;
  role?: CadParcelPlanRole;
  description?: string;
  allowLotDuplicates?: boolean;
}

export interface ParcelNumberCommand {
  key: 'PARCELNUMBER';
  parcelEntityIds: CadEntityId[];
  numbering?: ParcelNumberingOptions;
  role?: CadParcelPlanRole;
  allowLotDuplicates?: boolean;
}

export interface ParcelLinkCommand {
  key: 'PARCELLINK';
  first: CadParcelSharedBoundaryEnd;
  second: CadParcelSharedBoundaryEnd;
}

export interface ParcelUnlinkCommand {
  key: 'PARCELUNLINK';
  boundaryId: string;
}

export type ParcelSharedEditEdit =
  | { kind: 'move-endpoint'; end: 'from' | 'to'; x: number; y: number }
  | { kind: 'course-geometry'; geometry: CadParcelCourseGeometry };

export interface ParcelSharedEditCommand {
  key: 'PARCELSHAREDEDIT';
  linkId: string;
  edit: ParcelSharedEditEdit;
}

export interface ParcelCheckCommand {
  key: 'PARCELCHECK';
  parcelEntityIds?: CadEntityId[];
}

export interface ParcelScheduleCommand {
  key: 'PARCELSCHEDULE';
  parcelEntityIds?: CadEntityId[];
}
