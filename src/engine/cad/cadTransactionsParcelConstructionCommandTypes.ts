/**
 * STRUCT-241.13 CAD parcel-construction command payload type leaf.
 *
 * Type-only module. It owns the nine parcel construction/split/course/layout
 * command payload variants, kept as a single publicly named union that mirrors
 * its contiguous position in the `CadCommand` union of
 * `cadTransactions.types.ts`:
 *
 * `CadParcelConstructionCommandPayload` sits immediately after the
 * ALIGNMENT_INTERVAL_POINTS member and immediately before the
 * `({ key: 'LINETABLE' } & CadSurveyTableCreatePayload)` intersection, in this
 * order: PARCEL_CREATE (1), PARCEL_SPLIT (2), PARCEL_SPLIT_BEARING (3),
 * PARCEL_SPLIT_AREA (4), PARCEL_SPLIT_SLIDE (5), PARCEL_SPLIT_SWING (6),
 * PARCELCOURSEARC (7), PARCELCOURSELINE (8), and PARCEL_LAYOUT_AUTO (9).
 *
 * The group is extracted verbatim (key literals, field names, optionality,
 * `| null` nullability, literal unions, property order, and whitespace
 * unchanged) from the `CadCommand` union in `cadTransactions.types.ts`. This
 * shrinks the hub without changing the command contract; these inline members
 * were not a separate dependency cycle, so no SCC reduction is claimed.
 *
 * The seven `ParcelDesignateCommand`/`ParcelNumberCommand`/`ParcelLinkCommand`/
 * `ParcelUnlinkCommand`/`ParcelSharedEditCommand`/`ParcelCheckCommand`/
 * `ParcelScheduleCommand` aliases, the table intersections, TABLESTYLE,
 * SURVEYTABLE_EDIT, TANGENT_CURVE, and MOVE all stay in the hub.
 *
 * Contract: type-only imports only, and only from `./cadCorePrimitiveTypes`
 * (`CadEntityId`) and `./cadParcelLayoutTypes` (`CadParcelLayoutSettings`).
 * It must never import a value, `cadTransactions.ts`, `cadTransactions.types.ts`,
 * the alignment leaf, or any barrel that cycles back, and it declares no
 * runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';
import type { CadParcelLayoutSettings } from './cadParcelLayoutTypes';

export type CadParcelConstructionCommandPayload =
  | {
      key: 'PARCEL_CREATE';
      sourceEntityIds: CadEntityId[];
    }
  | {
      key: 'PARCEL_SPLIT';
      parcelEntityId: CadEntityId;
      splitLineEntityId: CadEntityId;
    }
  | {
      key: 'PARCEL_SPLIT_BEARING';
      parcelEntityId: CadEntityId;
      throughPointX: number;
      throughPointY: number;
      throughPointLabel?: string;
      bearing: string;
    }
  | {
      key: 'PARCEL_SPLIT_AREA';
      parcelEntityId: CadEntityId;
      throughPointX: number;
      throughPointY: number;
      throughPointLabel?: string;
      targetAreaSquareMeters: number;
    }
  | {
      key: 'PARCEL_SPLIT_SLIDE';
      parcelEntityId: CadEntityId;
      frontageEntityId?: CadEntityId | null;
      frontageParcelSegmentIds?: string[] | null;
      targetAreaSquareMeters: number;
      minFrontageMeters: number;
      alternative: 'start' | 'end';
      settings: CadParcelLayoutSettings;
    }
  | {
      key: 'PARCEL_SPLIT_SWING';
      parcelEntityId: CadEntityId;
      frontageEntityId?: CadEntityId | null;
      frontageParcelSegmentIds?: string[] | null;
      targetAreaSquareMeters: number;
      minFrontageMeters: number;
      alternative: 'start' | 'end';
      settings: CadParcelLayoutSettings;
    }
  | {
      key: 'PARCELCOURSEARC';
      parcelEntityId: CadEntityId;
      courseId: string;
      arcEntityId: CadEntityId;
    }
  | {
      key: 'PARCELCOURSELINE';
      parcelEntityId: CadEntityId;
      courseId: string;
    }
  | {
      key: 'PARCEL_LAYOUT_AUTO';
      parcelEntityId: CadEntityId;
      frontageEntityId?: CadEntityId | null;
      frontageParcelSegmentIds?: string[] | null;
      tool: 'slide' | 'swing';
      settings: CadParcelLayoutSettings;
    };
