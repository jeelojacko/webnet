/**
 * STRUCT-195.5 CAD section command payload type leaf.
 *
 * Type-only module. It owns the 17 pre-LANDXML sample-line and section
 * command payload variants (SAMPLE_GROUP_CREATE through SECTION_VIEW_UPDATE)
 * extracted verbatim (key literals, field names, optionality, ordering, and
 * comments unchanged) from the `CadCommand` union in
 * `cadTransactions.types.ts`, so the transaction hub can depend on this leaf
 * WITHOUT the command-family cycle that previously tied the section payloads
 * into the transaction SCC.
 *
 * `SECTION_VIEW_DELETE` is exported separately as `CadSectionViewDeleteCommand`
 * because it sits AFTER the inline `LANDXML_IMPORT` variant in the hub union;
 * the hub joins this leaf's union, then the inline LANDXML payload, then the
 * single delete payload in that original position. The LANDXML payload itself
 * stays in the hub and is intentionally not represented here.
 *
 * Contract: type-only imports only. It imports the primitive identity alias
 * from the zero-import core leaf, the sample-line/section patch types from
 * `cadSectionTypes`, and the section style structure type from `cadTypes`; it
 * must never import a value, a command definition, a runtime service,
 * `cadTransactions.ts`, `cadTransactions.types.ts`, or any barrel that cycles
 * back, and it declares no runtime exports.
 */

import type { CadLayerId } from './cadCorePrimitiveTypes';
import type { CadSectionStyle } from './cadTypes';
import type {
  CadSampleLinePatch,
  CadSectionStylePatch,
  CadSectionViewPatch,
} from './cadSectionTypes';

export type CadSectionCommandPayload =
  | {
      key: 'SAMPLE_GROUP_CREATE';
      name?: string;
      alignmentEntityId: string;
      layerId?: CadLayerId;
    }
  | {
      key: 'SAMPLE_GROUP_RENAME';
      groupId: string;
      name: string;
    }
  | {
      key: 'SAMPLE_GROUP_DELETE';
      groupId: string;
    }
  | {
      key: 'SAMPLE_LINE_ADD';
      groupId: string;
      /** Raw chainage; ignored when stationText is supplied. */
      rawStation?: number;
      /** Display station text (`1+234.500`) parsed then mapped to raw. */
      stationText?: string;
      leftWidth: number;
      rightWidth: number;
      skewDeg?: number;
      manualName?: string;
    }
  | {
      key: 'SAMPLE_LINE_ADD_INTERVAL';
      groupId: string;
      rawStart: number;
      rawEnd: number;
      interval: number;
      leftWidth: number;
      rightWidth: number;
      skewDeg?: number;
    }
  | {
      key: 'SAMPLE_LINE_UPDATE';
      groupId: string;
      lineId: string;
      patch: CadSampleLinePatch;
    }
  | {
      key: 'SAMPLE_LINE_DELETE';
      groupId: string;
      lineId: string;
    }
  | {
      key: 'SECTION_SOURCE_ADD';
      groupId: string;
      surfaceId: string;
      sectionStyleId?: string;
    }
  | {
      key: 'SECTION_SOURCE_REMOVE';
      groupId: string;
      surfaceId: string;
    }
  | {
      key: 'SECTION_SOURCE_SET_STYLE';
      groupId: string;
      surfaceId: string;
      /** Undefined is rejected; null clears. */
      sectionStyleId: string | null;
    }
  | {
      key: 'SECTION_AREA_COMPARISON';
      groupId: string;
      /** Both present = set pair; otherwise clear. */
      baseSurfaceId?: string;
      comparisonSurfaceId?: string;
    }
  | {
      key: 'SECTION_STYLE_CREATE';
      style: CadSectionStyle;
    }
  | {
      key: 'SECTION_STYLE_RENAME';
      styleId: string;
      name: string;
    }
  | {
      key: 'SECTION_STYLE_UPDATE';
      styleId: string;
      patch: CadSectionStylePatch;
    }
  | {
      key: 'SECTION_STYLE_DELETE';
      styleId: string;
      /** Required when groups or views reference the style; refs rewire to it. */
      replacementId?: string;
    }
  | {
      key: 'SECTION_VIEW_CREATE';
      sampleLineGroupId: string;
      sampleLineId: string;
      name?: string;
      sourceSurfaceIds?: string[];
      insertionX?: number;
      insertionY?: number;
      horizontalScale?: number;
      verticalExaggeration?: number;
      datumMode?: 'auto' | 'explicit';
      datumElevation?: number;
      offsetGridInterval?: number;
      elevationGridInterval?: number;
      showCutFill?: boolean;
      styleId?: string;
      layerId?: CadLayerId;
    }
  | {
      key: 'SECTION_VIEW_UPDATE';
      viewId: string;
      patch: CadSectionViewPatch;
    };

export interface CadSectionViewDeleteCommand {
  key: 'SECTION_VIEW_DELETE';
  viewId: string;
}
