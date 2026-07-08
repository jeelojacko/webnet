import { getCadEntityEditableName } from './cadEntityNames';
import type { CadEntity, CadProject, CadSurveyPointEntity, CadTextEntity } from './cadTypes';

export const nextManualStationId = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'survey-point') return;
    const match = /^CAD(\d+)$/i.exec(entity.stationId);
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `CAD${maxSequence + 1}`;
};

export const nextParcelName = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'parcel') return;
    const match = /^Parcel\s+(\d+)$/i.exec(entity.parcelName.trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `Parcel ${maxSequence + 1}`;
};

export const nextAlignmentName = (project: CadProject): string => {
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    if (entity.type !== 'alignment') return;
    const match = /^ALIGN(\d+)$/i.exec(entity.name.trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `ALIGN${maxSequence + 1}`;
};

export const nextEntityName = (project: CadProject, prefix: string): string => {
  const matcher = new RegExp(`^${prefix}(\\d+)$`, 'i');
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    const match = matcher.exec(getCadEntityEditableName(entity).trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return `${prefix}${maxSequence + 1}`;
};

export const nextCurveSequence = (project: CadProject): number => {
  const matcher = /^(?:CURVE|BC|MP|EC|R)(\d+)$/i;
  let maxSequence = 0;
  project.entities.forEach((entity) => {
    const match = matcher.exec(getCadEntityEditableName(entity).trim());
    if (!match) return;
    maxSequence = Math.max(maxSequence, Number(match[1]));
  });
  return maxSequence + 1;
};

export const buildCurveLabels = (sequence: number) => ({
  curveName: `CURVE${sequence}`,
  beginLabel: `BC${sequence}`,
  midLabel: `MP${sequence}`,
  endLabel: `EC${sequence}`,
  radiusLabel: `R${sequence}`,
});

export const stationIdExists = (project: CadProject, stationId: string): boolean =>
  project.entities.some(
    (entity) =>
      (entity.type === 'survey-point' && entity.stationId === stationId) ||
      entity.id === `pt:${stationId}` ||
      entity.id === `label:${stationId}`,
  );

export const isUserFacingStationId = (stationId: string): boolean =>
  /^[A-Za-z][A-Za-z0-9_-]*$/.test(stationId);

export const buildAlignmentStakeoutLabelText = (
  stationId: string,
  formattedStation: string,
  offset?: number | null,
): string => {
  const lines = [stationId, `STA ${formattedStation}`];
  if (offset != null && Math.abs(offset) > 1e-9) {
    lines.push(`OFF ${offset.toFixed(3)} m`);
  }
  return lines.join('\n');
};

export const buildAnchoredPointLabelEntityName = (stationId: string): string => `${stationId} label`;

export const createManualPointEntities = (
  project: CadProject,
  x: number,
  y: number,
  requestedLabel?: string,
  options?: { includeTextLabel?: boolean; createdBy?: string },
): { point: CadSurveyPointEntity; label: CadTextEntity | null } => {
  const requestedStationId = requestedLabel?.trim();
  const stationId =
    requestedStationId &&
    isUserFacingStationId(requestedStationId) &&
    !stationIdExists(project, requestedStationId)
      ? requestedStationId
      : nextManualStationId(project);
  const createdBy = options?.createdBy ?? 'POINT';
  const point: CadSurveyPointEntity = {
    id: `pt:${stationId}`,
    type: 'survey-point',
    layerId: 'points',
    styleId: 'style-point',
    visible: true,
    locked: false,
    stationId,
    x,
    y,
    pointClass: 'free',
    source: project.metadata.source,
    metadata: {
      createdBy,
      manual: true,
    },
  };
  if (options?.includeTextLabel === false) {
    return {
      point,
      label: null,
    };
  }
  return {
    point,
    label: {
      id: `label:${stationId}`,
      type: 'text',
      layerId: 'labels',
      styleId: 'style-label',
      visible: true,
      locked: false,
      x,
      y,
      text: stationId,
      anchorEntityId: `pt:${stationId}`,
      metadata: {
        createdBy,
        manual: true,
        entityName: buildAnchoredPointLabelEntityName(stationId),
        stationId,
      },
    },
  };
};

export const compactManualPointEntities = (
  entities: Array<CadSurveyPointEntity | CadTextEntity | null>,
): Array<CadSurveyPointEntity | CadTextEntity> =>
  entities.filter((entity): entity is CadSurveyPointEntity | CadTextEntity => entity != null);
