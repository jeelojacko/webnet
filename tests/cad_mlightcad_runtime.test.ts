import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { buildSurveyCadSpikeProject } from '../src/engine/cad/cadModel';
import type { CadEntity, CadProject } from '../src/engine/cad/cadTypes';
import type { ParseOptions } from '../src/types';

const runtimeModuleUrl = new URL('../node_modules/@mlightcad/data-model/dist/data-model.cjs', import.meta.url);
const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'survey_cad');

const parseOptions: ParseOptions = {
  units: 'm',
  coordMode: '2D',
  coordSystemMode: 'local',
  localDatumScheme: 'average-scale',
  averageScaleFactor: 1,
  commonElevation: 0,
  averageGeoidHeight: 0,
  observationMode: {
    bearing: 'grid',
    distance: 'measured',
    angle: 'measured',
    direction: 'measured',
  },
  gridBearingMode: 'grid',
  gridDistanceMode: 'measured',
  gridAngleMode: 'measured',
  gridDirectionMode: 'measured',
  runMode: 'adjustment',
  preanalysisMode: false,
  order: 'EN',
  angleStationOrder: 'atfromto',
  deltaMode: 'slope',
  mapMode: 'off',
  normalize: true,
  faceNormalizationMode: 'on',
  lonSign: 'west-negative',
};

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const pointOnArc = (center: { x: number; y: number }, radius: number, angleDeg: number) => ({
  x: center.x + Math.cos(toRadians(angleDeg)) * radius,
  y: center.y + Math.sin(toRadians(angleDeg)) * radius,
});

const loadRuntime = async () => import(runtimeModuleUrl.href);

const appendRuntimeEntity = (
  runtime: Awaited<ReturnType<typeof loadRuntime>>,
  db: {
    tables: {
      blockTable: {
        modelSpace: {
          appendEntity: (_entity: unknown) => void;
        };
      };
    };
  },
  entity: CadEntity,
) => {
  let runtimeEntity: {
    objectId?: string;
    layer?: string;
  };

  switch (entity.type) {
    case 'survey-point': {
      const point = new runtime.AcDbPoint();
      point.position = { x: entity.x, y: entity.y, z: entity.z ?? 0 };
      runtimeEntity = point;
      break;
    }
    case 'line':
      runtimeEntity = new runtime.AcDbLine(
        { x: entity.fromX, y: entity.fromY, z: 0 },
        { x: entity.toX, y: entity.toY, z: 0 },
      );
      break;
    case 'polyline':
    case 'polygon':
    case 'parcel': {
      const polyline = new runtime.AcDbPolyline();
      entity.vertices.forEach((vertex, index) => {
        polyline.addVertexAt(index, { x: vertex.x, y: vertex.y });
      });
      polyline.closed = entity.type === 'polyline' ? entity.closed : true;
      runtimeEntity = polyline;
      break;
    }
    case 'alignment': {
      const polyline = new runtime.AcDbPolyline();
      let vertexIndex = 0;
      entity.elements.forEach((element) => {
        if (element.kind === 'line') {
          polyline.addVertexAt(vertexIndex, { x: element.start.x, y: element.start.y });
          vertexIndex += 1;
          polyline.addVertexAt(vertexIndex, { x: element.end.x, y: element.end.y });
          vertexIndex += 1;
          return;
        }
        const start = pointOnArc(element.center, element.radius, element.startAngleDeg);
        const end = pointOnArc(element.center, element.radius, element.endAngleDeg);
        polyline.addVertexAt(vertexIndex, start);
        vertexIndex += 1;
        polyline.addVertexAt(vertexIndex, end);
        vertexIndex += 1;
      });
      polyline.closed = false;
      runtimeEntity = polyline;
      break;
    }
    case 'arc':
      runtimeEntity = new runtime.AcDbArc(
        { x: entity.centerX, y: entity.centerY, z: 0 },
        entity.radius,
        toRadians(entity.startAngleDeg),
        toRadians(entity.endAngleDeg),
      );
      break;
    case 'text': {
      const text = new runtime.AcDbText();
      text.textString = entity.text;
      text.position = { x: entity.x, y: entity.y, z: 0 };
      text.height = 1;
      runtimeEntity = text;
      break;
    }
    case 'error-ellipse':
      runtimeEntity = new runtime.AcDbEllipse(
        { x: entity.centerX, y: entity.centerY, z: 0 },
        { x: 0, y: 0, z: 1 },
        { x: Math.cos(toRadians(entity.thetaDeg)), y: Math.sin(toRadians(entity.thetaDeg)), z: 0 },
        entity.semiMajor,
        entity.semiMinor,
        0,
        Math.PI * 2,
      );
      break;
  }

  runtimeEntity.objectId = entity.id;
  runtimeEntity.layer = entity.layerId;
  db.tables.blockTable.modelSpace.appendEntity(runtimeEntity as never);
};

const buildRuntimeDatabaseFromProject = async (project: CadProject) => {
  const runtime = await loadRuntime();
  const db = new runtime.AcDbDatabase();
  runtime.acdbHostApplicationServices().workingDatabase = db;
  db.createDefaultData({ layer: true, lineType: true, textStyle: true, dimStyle: true, layout: true });

  project.layers.forEach((layer) => {
    if (db.tables.layerTable.has(layer.id)) return;
    const record = new runtime.AcDbLayerTableRecord({
      name: layer.id,
      description: layer.name,
      isOff: !layer.visible,
    });
    record.isLocked = layer.locked;
    db.tables.layerTable.add(record);
  });

  project.entities.forEach((entity) => {
    appendRuntimeEntity(runtime, db, entity);
  });

  return { runtime, db };
};

describe('mlightcad runtime seam', () => {
  it('loads the simple DXF fixture through the actual data-model runtime', async () => {
    const runtime = await loadRuntime();
    const dxfFixture = fs.readFileSync(path.join(fixtureDir, 'simple_runtime_probe.dxf'), 'utf8');
    const db = new runtime.AcDbDatabase();
    runtime.acdbHostApplicationServices().workingDatabase = db;

    await db.read(new TextEncoder().encode(dxfFixture).buffer, { readOnly: true }, runtime.AcDbFileType.DXF);

    const entities = db.tables.blockTable.modelSpace.newIterator().toArray();
    expect(entities).toHaveLength(2);
    expect(entities.map((entity: { type: string }) => entity.type)).toEqual(['Point', 'Line']);
    expect(db.tables.layerTable.getAt('POINTS')?.name).toBe('POINTS');
    expect(db.tables.layerTable.getAt('LINES')?.name).toBe('LINES');
  });

  it('preserves native WebNet ids and drives layer visibility through the runtime layer table', async () => {
    const input = fs.readFileSync(path.join(fixtureDir, 'triangle_network.dat'), 'utf8');
    const project = buildSurveyCadSpikeProject({
      input,
      instrumentLibrary: {},
      parseOptions,
      units: 'm',
      result: null,
    });

    const { db } = await buildRuntimeDatabaseFromProject(project);
    const runtimeEntities = db.tables.blockTable.modelSpace.newIterator().toArray();
    const runtimeIds = runtimeEntities.map((entity: { objectId: string }) => entity.objectId).sort();

    expect(runtimeIds).toEqual(project.entities.map((entity) => entity.id).sort());

    const selectedRuntimeEntity = db.tables.blockTable.modelSpace.getIdAt(project.entities[0]!.id);
    expect(selectedRuntimeEntity?.objectId).toBe(project.entities[0]!.id);
    expect(project.entities.some((entity) => entity.id === selectedRuntimeEntity?.objectId)).toBe(true);

    const pointsLayer = db.tables.layerTable.getAt('points');
    expect(pointsLayer?.isOff).toBe(false);
    pointsLayer!.isOff = true;
    pointsLayer!.isFrozen = true;
    expect(pointsLayer?.isOff).toBe(true);
    expect(pointsLayer?.isFrozen).toBe(true);
  });
});
