/**
 * Phase 18P — derived CAD project lookup maps.
 *
 * A `CadProjectLookup` turns the repeated linear `.find` scans the renderer,
 * spatial-bounds and export passes perform per entity/item into O(1) `Map`
 * reads. It is:
 *
 *  - **derived** — built on demand from a project and never persisted;
 *  - **read-only** — only referenced maps, never mutated by consumers;
 *  - **side-effect free** — building it never dirties the drawing, bumps a
 *    revision, or changes the project signature.
 *
 * LIFECYCLE: build once per render / bounds / export pass and thread the
 * object through. Only the hot paths actually consumed carry a map (add one
 * when a new per-entity lookup appears — do not add speculative tables).
 *
 * MEMOIZATION: this module deliberately does NOT cache by project identity.
 * The project is treated as immutable by the workspace (history replaces it
 * wholesale), but some call sites (tests, in-place preview assembly) mutate
 * arrays on the same object, so a WeakMap keyed by identity would risk stale
 * reads. Build per pass, or hoist the lookup yourself when you know the
 * project is frozen for the duration.
 */
import type {
  CadBearingLabelStyle,
  CadBlockDefinition,
  CadCurveLabelStyle,
  CadDimensionStyle,
  CadEntity,
  CadLayer,
  CadLeaderStyle,
  CadLineType,
  CadPointLabelStyle,
  CadPointStyle,
  CadPointSymbol,
  CadProject,
  CadStyle,
  CadTextStyle,
} from './cadTypes';

export interface CadProjectLookup {
  readonly entityById: ReadonlyMap<string, CadEntity>;
  readonly layerById: ReadonlyMap<string, CadLayer>;
  readonly lineTypeById: ReadonlyMap<string, CadLineType>;
  readonly styleById: ReadonlyMap<string, CadStyle>;
  readonly textStyleById: ReadonlyMap<string, CadTextStyle>;
  readonly pointStyleById: ReadonlyMap<string, CadPointStyle>;
  readonly pointLabelStyleById: ReadonlyMap<string, CadPointLabelStyle>;
  readonly pointSymbolById: ReadonlyMap<string, CadPointSymbol>;
  readonly dimensionStyleById: ReadonlyMap<string, CadDimensionStyle>;
  readonly leaderStyleById: ReadonlyMap<string, CadLeaderStyle>;
  readonly bearingLabelStyleById: ReadonlyMap<string, CadBearingLabelStyle>;
  readonly curveLabelStyleById: ReadonlyMap<string, CadCurveLabelStyle>;
  readonly blockDefinitionById: ReadonlyMap<string, CadBlockDefinition>;
}

/** Last-wins on duplicate ids, matching the renderer's existing Map behavior. */
const byId = <T extends { id: string }>(
  entries: readonly T[] | undefined,
): ReadonlyMap<string, T> => new Map((entries ?? []).map((entry) => [entry.id, entry]));

export const buildCadProjectLookup = (project: CadProject): CadProjectLookup => ({
  entityById: byId(project.entities),
  layerById: byId(project.layers),
  lineTypeById: byId(project.styleLibrary.lineTypes),
  styleById: byId(project.styleLibrary.styles),
  textStyleById: byId(project.styleLibrary.textStyles),
  pointStyleById: byId(project.pointStyles),
  pointLabelStyleById: byId(project.labelStyles),
  pointSymbolById: byId(project.styleLibrary.pointSymbols),
  dimensionStyleById: byId(project.dimensionStyles),
  leaderStyleById: byId(project.leaderStyles),
  bearingLabelStyleById: byId(project.bearingLabelStyles),
  curveLabelStyleById: byId(project.curveLabelStyles),
  blockDefinitionById: byId(project.blockDefinitions),
});
