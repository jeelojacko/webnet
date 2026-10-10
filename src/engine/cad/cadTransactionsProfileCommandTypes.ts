/**
 * STRUCT-195.5 CAD profile command payload type leaf.
 *
 * Type-only module. It owns the 11 profile command payload variants
 * (PROFILE_CREATE through PROFILE_STYLE_DELETE) and the shared
 * `CadProfileViewUpdatePatch` interface, extracted verbatim (key literals,
 * field names, optionality, ordering, unions, and comments unchanged) from
 * the `CadCommand` union in `cadTransactions.types.ts`. This shrinks the
 * hub while preserving its command contract; the extracted inline members
 * were not a separate dependency cycle, so no SCC reduction is claimed.
 *
 * Contract: type-only imports only. It imports the primitive identity alias
 * from the zero-import core leaf, the profile structure type from `cadTypes`,
 * and the profile style patch from `cadProfileTypes`; it must never import a
 * value, a command definition, a runtime service, `cadTransactions.ts`,
 * `cadTransactions.types.ts`, or any barrel that cycles back, and it declares
 * no runtime exports.
 */

import type { CadLayerId } from './cadCorePrimitiveTypes';
import type { CadProfileStyle } from './cadTypes';
import type { CadProfileStylePatch } from './cadProfileTypes';

/**
 * Phase 18J display-only view patch. Only presentation fields (scale,
 * datum, grid intervals, style, name) — never profileIds/alignment, so
 * applying it cannot alter any profile extraction revision.
 */
export interface CadProfileViewUpdatePatch {
  horizontalScale?: number;
  verticalExaggeration?: number;
  datumMode?: 'auto' | 'explicit';
  datumElevation?: number;
  datumStep?: number;
  majorStationInterval?: number;
  minorStationInterval?: number;
  elevationGridInterval?: number;
  styleId?: string | null;
  name?: string;
}

export type CadProfileCommandPayload =
  | {
      key: 'PROFILE_CREATE';
      name?: string;
      /** Accepted for forward compatibility; profiles carry no layer binding (ignored). */
      layerId?: CadLayerId;
      styleId?: string;
      alignmentEntityId: string;
      surfaceId: string;
      description?: string;
    }
  | {
      key: 'PROFILE_REBUILD';
      profileId: string;
      name?: string;
      /** Undefined = leave, null = clear, id = set (must exist). */
      styleId?: string | null;
      alignmentEntityId?: string;
      surfaceId?: string;
      /** Undefined = leave, null = clear, text = set. */
      description?: string | null;
    }
  | {
      key: 'PROFILE_DELETE';
      profileId: string;
    }
  | {
      key: 'PROFILE_VIEW_CREATE';
      name?: string;
      alignmentEntityId: string;
      profileIds?: string[];
      insertionX?: number;
      insertionY?: number;
      width?: number;
      height?: number;
      horizontalScale?: number;
      verticalExaggeration?: number;
      datumElevation?: number;
      datumMode?: 'auto' | 'explicit';
      datumStep?: number;
      majorStationInterval?: number;
      minorStationInterval?: number;
      elevationGridInterval?: number;
      styleId?: string;
    }
  | {
      key: 'PROFILE_VIEW_UPDATE';
      viewId: string;
      patch: CadProfileViewUpdatePatch;
    }
  | {
      key: 'PROFILE_VIEW_DELETE';
      viewId: string;
    }
  | {
      key: 'PROFILE_STYLE_CREATE';
      style: CadProfileStyle;
    }
  | {
      key: 'PROFILE_STYLE_DUPLICATE';
      styleId: string;
      newId: string;
      name: string;
    }
  | {
      key: 'PROFILE_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'PROFILE_STYLE_UPDATE';
      styleId: string;
      patch: CadProfileStylePatch;
    }
  | {
      key: 'PROFILE_STYLE_DELETE';
      styleId: string;
      /** Required when profiles or views reference the style; refs rewire to it. */
      replacementId?: string;
    };
