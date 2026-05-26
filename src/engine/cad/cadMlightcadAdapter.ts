import type { CadEntity, CadProject, MlightcadSpikeEntity, MlightcadSpikeScene } from './cadTypes';

const toMlightcadEntity = (entity: CadEntity): MlightcadSpikeEntity => {
  switch (entity.type) {
    case 'survey-point':
      return {
        objectId: entity.id,
        type: 'AcDbPoint',
        layer: entity.layerId,
        visible: entity.visible,
        geometry: {
          x: entity.x,
          y: entity.y,
          z: entity.z ?? 0,
        },
        metadata: {
          nativeEntityId: entity.id,
          nativeType: entity.type,
        },
      };
    case 'line':
      return {
        objectId: entity.id,
        type: 'AcDbLine',
        layer: entity.layerId,
        visible: entity.visible,
        geometry: {
          startPoint: { x: entity.fromX, y: entity.fromY, z: 0 },
          endPoint: { x: entity.toX, y: entity.toY, z: 0 },
          sourceObservationIds: entity.sourceObservationIds,
        },
        metadata: {
          nativeEntityId: entity.id,
          nativeType: entity.type,
        },
      };
    case 'polyline':
      return {
        objectId: entity.id,
        type: 'AcDbPolyline',
        layer: entity.layerId,
        visible: entity.visible,
        geometry: {
          vertices: entity.vertices.map((vertex) => ({ x: vertex.x, y: vertex.y, z: 0 })),
          closed: entity.closed,
          vertexLabels: entity.vertexLabels,
        },
        metadata: {
          nativeEntityId: entity.id,
          nativeType: entity.type,
        },
      };
    case 'text':
      return {
        objectId: entity.id,
        type: 'AcDbText',
        layer: entity.layerId,
        visible: entity.visible,
        geometry: {
          position: { x: entity.x, y: entity.y, z: 0 },
          text: entity.text,
        },
        metadata: {
          nativeEntityId: entity.id,
          nativeType: entity.type,
        },
      };
    case 'error-ellipse':
      return {
        objectId: entity.id,
        type: 'AcDbEllipse',
        layer: entity.layerId,
        visible: entity.visible,
        geometry: {
          center: { x: entity.centerX, y: entity.centerY, z: 0 },
          semiMajor: entity.semiMajor,
          semiMinor: entity.semiMinor,
          thetaDeg: entity.thetaDeg,
        },
        metadata: {
          nativeEntityId: entity.id,
          nativeType: entity.type,
        },
      };
  }
};

export const buildMlightcadSpikeScene = (project: CadProject): MlightcadSpikeScene => ({
  layers: project.layers.map((layer) => ({
    id: layer.id,
    name: layer.name,
    visible: layer.visible,
    locked: layer.locked,
    color: layer.color,
  })),
  entities: project.entities.map((entity) => toMlightcadEntity(entity)),
  extents: project.bounds,
});
