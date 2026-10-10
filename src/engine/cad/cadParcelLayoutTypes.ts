/**
 * STRUCT-241.7 CAD parcel layout type leaf.
 *
 * Type-only module. It owns the five parcel-layout contracts extracted
 * verbatim from `cadTypes.ts`:
 *
 * - `CadParcelLayoutSolutionPreference` — solver preferred-solution ranking.
 * - `CadParcelLayoutAutomaticMode` — automatic layout trigger mode union.
 * - `CadParcelLayoutRemainderDistribution` — remainder placement strategy.
 * - `CadParcelLayoutSettings` — parcel-layout solver settings.
 * - `CadParcelLayoutUiState` — parcel-layout panel UI state.
 *
 * Bodies, comments, property order, discriminants, unions, optionality, and
 * whitespace are copied verbatim from `cadTypes.ts`; the only change is that
 * `CadEntityId` now comes from its leaf instead of the `cadTypes` hub.
 *
 * Contract: type-only imports only, and only from
 * `./cadCorePrimitiveTypes` (`CadEntityId`). It must never import `cadTypes`,
 * any barrel, an engine runtime module, or another leaf, and declares no
 * runtime exports.
 */

import type { CadEntityId } from './cadCorePrimitiveTypes';

export type CadParcelLayoutSolutionPreference =
  | 'shortest_frontage'
  | 'smallest_area'
  | 'largest_area'
  | 'most_rectangular'
  | 'closest_to_target_area';

export type CadParcelLayoutAutomaticMode = 'off' | 'single_preview' | 'fill_parent';

export type CadParcelLayoutRemainderDistribution =
  | 'place_remainder_in_last_parcel'
  | 'create_parcel_from_remainder'
  | 'redistribute_remainder';

export interface CadParcelLayoutSettings {
  minAreaSquareMeters: number;
  minFrontageMeters: number;
  useFrontageAtOffset: boolean;
  frontageOffsetMeters: number;
  minWidthMeters: number;
  minDepthMeters: number;
  useMaxDepth: boolean;
  maxDepthMeters: number;
  solutionPreference: CadParcelLayoutSolutionPreference;
  automaticMode: CadParcelLayoutAutomaticMode;
  remainderDistribution: CadParcelLayoutRemainderDistribution;
}

export interface CadParcelLayoutUiState {
  open: boolean;
  collapsed: boolean;
  dock: 'floating' | 'left' | 'right';
  floatingLeftPx: number;
  floatingTopPx: number;
  floatingWidthPx: number;
  floatingHeightPx: number;
  activeParentParcelId: CadEntityId | null;
  activeFrontageEntityId: CadEntityId | null;
  activeFrontageParcelSegmentIds?: string[] | null;
  settings: CadParcelLayoutSettings;
}
