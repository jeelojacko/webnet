import { resolveCurrentCadLayerId } from './cadLayers';
import { validateImportedTinPayload } from './cadImportedTin';
import { resolveSurfaceLayerId } from './cadSurfaceTypes';
import { appendCadProjectEntities } from './cadProjectState';
import { createCadSelectionState } from './cadSelection';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import type { CadCommandDefinition } from './cadTransactions.types';
import type {
  CadAlignmentElement,
  CadEntity,
  CadStationEquation,
  CadSurface,
  ImportedTinPayload,
} from './cadTypes';

/**
 * Phase 18L — atomic LandXML import commit (ONE undoable transaction).
 *
 * The preview step never mutates geometry; this command applies a validated
 * payload all-or-nothing: any invalid entry (non-finite coords, bad TIN
 * payload, name that cannot be deconflicted) rejects the whole command and
 * the drawing is unchanged. Names deconflict as "Name (2)"; byte-identical
 * objects already in the drawing are skipped and REPORTED (never silently
 * replaced). Generated IDs are stable (content-derived), so a repeated
 * import of the same file detects exact duplicates instead of doubling.
 */

export interface LandXmlImportCommandPoint {
  stationId: string;
  x: number;
  y: number;
  z: number;
  description?: string;
  featureCode?: string;
}

export interface LandXmlImportCommandAlignment {
  name: string;
  elements: CadAlignmentElement[];
  startStation: number;
  stationEquations: CadStationEquation[];
}

export interface LandXmlImportCommandSurface {
  name: string;
  payload: ImportedTinPayload;
}

export type LandXmlImportCommand = {
  key: 'LANDXML_IMPORT';
  fileName: string;
  inputHash: string;
  points: LandXmlImportCommandPoint[];
  alignments: LandXmlImportCommandAlignment[];
  surfaces: LandXmlImportCommandSurface[];
};

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const canonicalElements = (elements: CadAlignmentElement[]): string =>
  JSON.stringify(elements);

const canonicalEquations = (equations: CadStationEquation[]): string =>
  JSON.stringify(equations);

/** Duplicate-safe display name: "Existing Ground" → "Existing Ground (2)". */
export const deconflictLandXmlName = (taken: Set<string>, name: string): string => {
  if (!taken.has(name)) return name;
  let index = 2;
  while (taken.has(`${name} (${index})`)) index += 1;
  return `${name} (${index})`;
};

export const landxmlImportCommand: CadCommandDefinition<LandXmlImportCommand> = {
  key: 'LANDXML_IMPORT',
  execute: (snapshot, command) => {
    // --- validate everything BEFORE touching the drawing (all-or-nothing) ---
    for (const point of command.points) {
      if (!point.stationId.trim() || !finite(point.x) || !finite(point.y) || !finite(point.z)) {
        return null;
      }
    }
    for (const alignment of command.alignments) {
      if (!alignment.name.trim() || alignment.elements.length === 0 || !finite(alignment.startStation)) {
        return null;
      }
      for (const equation of alignment.stationEquations) {
        if (!finite(equation.backStation) || !finite(equation.aheadStation)) return null;
      }
    }
    for (const surface of command.surfaces) {
      if (!surface.name.trim() || validateImportedTinPayload(surface.payload) != null) return null;
    }
    if (
      command.points.length === 0 &&
      command.alignments.length === 0 &&
      command.surfaces.length === 0
    ) {
      return null;
    }

    const shortHash = command.inputHash.replace(/^fnv1a-/, '').slice(0, 8) || 'import';
    const stableId = (kind: string, index: number): string =>
      `landxml-${kind}-${shortHash}-${index}`;
    const existingIds = new Set(snapshot.project.entities.map((entity) => entity.id));
    const existingSurfaceIds = new Set((snapshot.project.surfaces ?? []).map((entry) => entry.id));
    const claimId = (candidate: string): string => {
      let id = candidate;
      let index = 2;
      while (existingIds.has(id) || existingSurfaceIds.has(id)) {
        id = `${candidate}-r${index}`;
        index += 1;
      }
      existingIds.add(id);
      existingSurfaceIds.add(id);
      return id;
    };

    // Exact-duplicate detection (reported skips, never silent replace).
    const pointKey = (x: number, y: number, z: number): string => `${x},${y},${z}`;
    const existingPoints = new Map(
      snapshot.project.entities
        .filter((entity): entity is Extract<CadEntity, { type: 'survey-point' }> => entity.type === 'survey-point')
        .map((entity) => [`${entity.stationId}${pointKey(entity.x, entity.y, entity.z ?? Number.NaN)}`, entity]),
    );
    const existingAlignments = new Map(
      snapshot.project.entities
        .filter((entity): entity is Extract<CadEntity, { type: 'alignment' }> => entity.type === 'alignment')
        .map((entity) => [
          `${entity.name}${canonicalElements([...entity.elements])}${entity.startStation}${canonicalEquations([...(entity.stationEquations ?? [])])}`,
          entity,
        ]),
    );
    const tinKey = (payload: ImportedTinPayload): string =>
      `${payload.vertices.join(',')}#${payload.faces.join(',')}#${payload.provenance.surfaceName}`;
    const existingSurfaces = new Map(
      (snapshot.project.surfaces ?? [])
        .filter((entry) => entry.definition.sourceKind === 'imported-tin' && entry.definition.importedTin)
        .map((entry) => [tinKey(entry.definition.importedTin as ImportedTinPayload), entry]),
    );

    const takenStationIds = new Set(
      snapshot.project.entities
        .filter((entity) => entity.type === 'survey-point')
        .map((entity) => (entity as Extract<CadEntity, { type: 'survey-point' }>).stationId),
    );
    const takenNames = new Set([
      ...snapshot.project.entities
        .filter((entity) => entity.type === 'alignment')
        .map((entity) => (entity as Extract<CadEntity, { type: 'alignment' }>).name),
      ...(snapshot.project.surfaces ?? []).map((entry) => entry.name),
    ]);

    let pointsAdded = 0;
    let pointsSkipped = 0;
    let alignmentsAdded = 0;
    let alignmentsSkipped = 0;
    let surfacesAdded = 0;
    let surfacesSkipped = 0;
    const addedEntityIds: string[] = [];
    const newEntities: CadEntity[] = [];
    const newSurfaces: CadSurface[] = [];

    command.points.forEach((point, index) => {
      if (existingPoints.has(`${point.stationId}${pointKey(point.x, point.y, point.z)}`)) {
        pointsSkipped += 1;
        return;
      }
      let stationId = point.stationId;
      if (takenStationIds.has(stationId)) {
        let suffix = 2;
        while (takenStationIds.has(`${point.stationId}_${suffix}`)) suffix += 1;
        stationId = `${point.stationId}_${suffix}`;
      }
      takenStationIds.add(stationId);
      newEntities.push({
        id: claimId(stableId('pt', index)),
        type: 'survey-point',
        layerId: resolveCurrentCadLayerId(snapshot.project),
        visible: true,
        locked: false,
        stationId,
        x: point.x,
        y: point.y,
        z: point.z,
        pointClass: 'free',
        source: 'parsed-input',
        ...(point.description != null ? { description: point.description } : {}),
        ...(point.featureCode != null ? { featureCode: point.featureCode } : {}),
        metadata: { createdBy: 'LANDXML_IMPORT', sourceFile: command.fileName },
      });
      addedEntityIds.push(newEntities[newEntities.length - 1]!.id);
      pointsAdded += 1;
    });

    command.alignments.forEach((alignment, index) => {
      const key =
        `${alignment.name}${canonicalElements(alignment.elements)}${alignment.startStation}` +
        `${canonicalEquations(alignment.stationEquations)}`;
      if (existingAlignments.has(key)) {
        alignmentsSkipped += 1;
        return;
      }
      const name = deconflictLandXmlName(takenNames, alignment.name);
      takenNames.add(name);
      const id = claimId(stableId('al', index));
      newEntities.push({
        id,
        type: 'alignment',
        layerId: 'planning',
        styleId: 'style-observation-line',
        visible: true,
        locked: false,
        name,
        elements: alignment.elements.map((element) =>
          element.kind === 'line'
            ? { kind: 'line' as const, start: { ...element.start }, end: { ...element.end } }
            : {
                kind: 'arc' as const,
                center: { ...element.center },
                radius: element.radius,
                startAngleDeg: element.startAngleDeg,
                endAngleDeg: element.endAngleDeg,
              },
        ),
        startStation: alignment.startStation,
        ...(alignment.stationEquations.length > 0
          ? { stationEquations: alignment.stationEquations.map((equation) => ({ ...equation })) }
          : {}),
        metadata: { createdBy: 'LANDXML_IMPORT', sourceFile: command.fileName },
      });
      addedEntityIds.push(id);
      alignmentsAdded += 1;
    });

    command.surfaces.forEach((surface, index) => {
      if (existingSurfaces.has(tinKey(surface.payload))) {
        surfacesSkipped += 1;
        return;
      }
      const name = deconflictLandXmlName(takenNames, surface.name);
      takenNames.add(name);
      newSurfaces.push({
        id: claimId(stableId('surf', index)),
        name,
        definition: {
          sourceKind: 'imported-tin',
          pointSource: { kind: 'points', pointEntityIds: [] },
          importedTin: {
            vertices: [...surface.payload.vertices],
            faces: [...surface.payload.faces],
            provenance: { ...surface.payload.provenance },
          },
        },
        layerId: resolveSurfaceLayerId(snapshot.project),
        cachedRevision: null,
      });
      surfacesAdded += 1;
    });

    if (pointsAdded === 0 && alignmentsAdded === 0 && surfacesAdded === 0) return null;

    const summary =
      `Imported ${pointsAdded} point(s), ${alignmentsAdded} alignment(s), ${surfacesAdded} surface(s) from ${command.fileName}` +
      (pointsSkipped + alignmentsSkipped + surfacesSkipped > 0
        ? ` (${pointsSkipped + alignmentsSkipped + surfacesSkipped} exact duplicate(s) skipped)`
        : '');
    const provenance = createCogoProvenance({
      toolKey: 'LANDXML_IMPORT',
      summary,
      sourceEntityIds: [],
      inputs: { fileName: command.fileName, inputHash: command.inputHash },
      parameters: { fileName: command.fileName },
    });
    const withEntities = appendCadProjectEntities(snapshot.project, newEntities);
    const withSurfaces: typeof withEntities = {
      ...withEntities,
      surfaces: [...(withEntities.surfaces ?? []), ...newSurfaces],
    };
    const nextProject = appendCogoComputation({
      project: withSurfaces,
      provenance,
      title: 'LandXML Import',
      summary,
      rows: [
        { label: 'File', value: command.fileName },
        { label: 'Points added', value: String(pointsAdded) },
        { label: 'Alignments added', value: String(alignmentsAdded) },
        { label: 'Surfaces added', value: String(surfacesAdded) },
        { label: 'Exact duplicates skipped', value: String(pointsSkipped + alignmentsSkipped + surfacesSkipped) },
      ],
      createdEntities: newEntities,
    });

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, addedEntityIds),
      },
      commandState: {
        key: 'LANDXML_IMPORT',
        phase: 'committed',
        prompt: `LANDXML_IMPORT committed: ${summary}.`,
      },
      transactionLabel: `LANDXML_IMPORT (${command.fileName})`,
      addedEntityIds,
      removedEntityIds: [],
    };
  },
};
