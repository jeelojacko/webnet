import {
  cadAlignmentDisplayStationToRawStation,
  cadAlignmentEndStation,
  cadBuildAlignmentStationPoints,
  cadPointAtAlignmentStationOffset,
  cadProjectPointToAlignment,
  formatCadStation,
} from './cadAlignment';
import { buildCadCogoComputation, buildCadCogoEntityMetadata } from './cadCogoTypes';
import { createCadSelectionState } from './cadSelection';
import {
  buildAlignmentStakeoutLabelText,
  compactManualPointEntities,
  createManualPointEntities,
} from './cadTransactionsEntityFactories';
import {
  appendCogoComputation,
  createCogoProvenance,
} from './cadTransactionsCogoReports';
import {
  appendCadProjectCogoComputation,
  appendCadProjectEntities,
  replaceCadProjectEntities,
} from './cadProjectState';
import type { CadCommandDefinition } from './cadTransactions.types';
import type {
  CadEntity,
  CadEntityId,
  CadSurveyPointEntity,
} from './cadTypes';
export const alignmentStationReportCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_STATION_REPORT';
  alignmentEntityId: CadEntityId;
  pointEntityId: CadEntityId;
}> = {
  key: 'ALIGNMENT_STATION_REPORT',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    const pointEntity = snapshot.project.entities.find(
      (entity): entity is CadSurveyPointEntity =>
        entity.type === 'survey-point' && entity.id === command.pointEntityId,
    );
    if (!alignmentEntity || !pointEntity) return null;
    const projection = cadProjectPointToAlignment(alignmentEntity, {
      x: pointEntity.x,
      y: pointEntity.y,
    });
    if (!projection) return null;

    const formattedStation = formatCadStation(projection.station);
    const summary = `Projected ${pointEntity.stationId} onto ${alignmentEntity.name} at station ${formattedStation}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_STATION',
      summary,
      sourceEntityIds: [alignmentEntity.id, pointEntity.id],
      sourcePointIds: [pointEntity.stationId],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        pointEntityId: pointEntity.id,
      },
      parameters: {
        station: projection.station,
        offset: projection.offset,
      },
    });
    const nextProject = appendCogoComputation({
      project: snapshot.project,
      provenance,
      title: 'Alignment Station',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentEntity.name },
        { label: 'Point', value: pointEntity.stationId },
        { label: 'Station', value: formattedStation, unit: 'm' },
        { label: 'Offset', value: projection.offset.toFixed(3), unit: 'm' },
        { label: 'Projected Northing', value: projection.point.y.toFixed(3), unit: 'm' },
        { label: 'Projected Easting', value: projection.point.x.toFixed(3), unit: 'm' },
        { label: 'Element', value: `${projection.elementKind} ${projection.elementIndex + 1}` },
      ],
      createdEntities: [],
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: snapshot.selection,
      },
      commandState: {
        key: 'ALIGNMENT_STATION_REPORT',
        phase: 'committed',
        prompt: `STA committed for ${pointEntity.stationId} on ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_STATION (${pointEntity.stationId})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

export const alignmentStationEquationCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_STATION_EQUATION';
  alignmentEntityId: CadEntityId;
  backStation: number;
  aheadStation: number;
}> = {
  key: 'ALIGNMENT_STATION_EQUATION',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!alignmentEntity) return null;
    if (
      !Number.isFinite(command.backStation) ||
      !Number.isFinite(command.aheadStation) ||
      command.aheadStation < command.backStation - 1e-9
    ) {
      return null;
    }

    const rawStation = cadAlignmentDisplayStationToRawStation(alignmentEntity, command.backStation);
    if (rawStation == null) return null;
    if (
      (alignmentEntity.stationEquations ?? []).some((equation) =>
        Math.abs((equation.rawStation ?? Number.NaN) - rawStation) <= 1e-9,
      )
    ) {
      return null;
    }

    const updatedAlignment: Extract<CadEntity, { type: 'alignment' }> = {
      ...alignmentEntity,
      stationEquations: [
        ...(alignmentEntity.stationEquations ?? []),
        {
          backStation: command.backStation,
          aheadStation: command.aheadStation,
          rawStation,
        },
      ].sort((left, right) => {
        const leftRaw = left.rawStation ?? left.backStation;
        const rightRaw = right.rawStation ?? right.backStation;
        return leftRaw - rightRaw;
      }),
    };

    const summary = `Added station equation ${command.backStation.toFixed(3)} ahead ${command.aheadStation.toFixed(3)} on ${alignmentEntity.name}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_STATION_EQUATION',
      sourceEntityIds: [alignmentEntity.id],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
      },
      parameters: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
        backStation: command.backStation,
        aheadStation: command.aheadStation,
        rawStation,
      },
      summary,
    });
    updatedAlignment.metadata = buildCadCogoEntityMetadata(updatedAlignment.metadata, provenance);

    const nextProjectWithAlignment = replaceCadProjectEntities(
      snapshot.project,
      snapshot.project.entities.map((entity) => (entity.id === updatedAlignment.id ? updatedAlignment : entity)),
    );
    const nextProject = appendCadProjectCogoComputation(
      nextProjectWithAlignment,
      buildCadCogoComputation({
        createdEntities: [],
        updatedEntities: [updatedAlignment],
        removedEntityIds: [],
        report: {
          title: 'Alignment Station Equation',
          summary,
          rows: [
            { label: 'Alignment', value: alignmentEntity.name },
            { label: 'Back station', value: formatCadStation(command.backStation) },
            { label: 'Ahead station', value: formatCadStation(command.aheadStation) },
            { label: 'Raw station', value: formatCadStation(rawStation) },
            { label: 'Equation count', value: String(updatedAlignment.stationEquations?.length ?? 0) },
          ],
        },
        warnings: [],
        provenance,
      }),
    );

    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [updatedAlignment.id]),
      },
      commandState: {
        key: 'ALIGNMENT_STATION_EQUATION',
        phase: 'committed',
        prompt: `STA EQ committed for ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_STATION_EQUATION (${alignmentEntity.name})`,
      addedEntityIds: [],
      removedEntityIds: [],
    };
  },
};

export const alignmentOffsetPointCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_OFFSET_POINT';
  alignmentEntityId: CadEntityId;
  station: number;
  offset: number;
  label?: string;
}> = {
  key: 'ALIGNMENT_OFFSET_POINT',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!alignmentEntity) return null;
    const stationPoint = cadPointAtAlignmentStationOffset(alignmentEntity, command.station, command.offset);
    if (!stationPoint) return null;

    const formattedStation = formatCadStation(command.station);
    const summary = `Created station-offset point on ${alignmentEntity.name} at station ${formattedStation}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_POINT',
      summary,
      sourceEntityIds: [alignmentEntity.id],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
      },
      parameters: {
        station: command.station,
        offset: command.offset,
      },
    });
    const entities = createManualPointEntities(
      snapshot.project,
      stationPoint.point.x,
      stationPoint.point.y,
      command.label,
      {
        createdBy: 'ALIGNMENT_OFFSET_POINT',
      },
    );
    const pointEntity: CadSurveyPointEntity = {
      ...entities.point,
      metadata: {
        ...buildCadCogoEntityMetadata(entities.point.metadata, provenance),
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
        alignmentStation: formattedStation,
        alignmentOffset: command.offset,
        alignmentPointKind: 'station-offset',
      },
    };
    const labelEntity = entities.label
      ? {
          ...entities.label,
          text: buildAlignmentStakeoutLabelText(pointEntity.stationId, formattedStation, command.offset),
          metadata: {
            ...buildCadCogoEntityMetadata(entities.label.metadata, provenance),
            alignmentEntityId: alignmentEntity.id,
            alignmentName: alignmentEntity.name,
            alignmentStation: formattedStation,
            alignmentOffset: command.offset,
            alignmentPointKind: 'station-offset',
          },
        }
      : null;
    const createdEntities = compactManualPointEntities([pointEntity, labelEntity]);
    const nextProjectWithEntities = appendCadProjectEntities(snapshot.project, createdEntities);
    const nextProject = appendCogoComputation({
      project: nextProjectWithEntities,
      provenance,
      title: 'Alignment Station Offset Point',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentEntity.name },
        { label: 'Point', value: pointEntity.stationId },
        { label: 'Station', value: formattedStation, unit: 'm' },
        { label: 'Offset', value: command.offset.toFixed(3), unit: 'm' },
        { label: 'Northing', value: stationPoint.point.y.toFixed(3), unit: 'm' },
        { label: 'Easting', value: stationPoint.point.x.toFixed(3), unit: 'm' },
        { label: 'Element', value: `${stationPoint.elementKind} ${stationPoint.elementIndex + 1}` },
      ],
      createdEntities,
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, [pointEntity.id]),
      },
      commandState: {
        key: 'ALIGNMENT_OFFSET_POINT',
        phase: 'committed',
        prompt: `STA PT committed for ${pointEntity.stationId} on ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_OFFSET_POINT (${pointEntity.stationId})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

export const alignmentIntervalPointsCommand: CadCommandDefinition<{
  key: 'ALIGNMENT_INTERVAL_POINTS';
  alignmentEntityId: CadEntityId;
  interval: number;
  startStation?: number;
  endStation?: number;
  labelPrefix?: string;
}> = {
  key: 'ALIGNMENT_INTERVAL_POINTS',
  execute: (snapshot, command) => {
    const alignmentEntity = snapshot.project.entities.find(
      (entity): entity is Extract<CadEntity, { type: 'alignment' }> =>
        entity.type === 'alignment' && entity.id === command.alignmentEntityId,
    );
    if (!alignmentEntity) return null;
    const stationPoints = cadBuildAlignmentStationPoints(alignmentEntity, {
      startStation: command.startStation,
      endStation: command.endStation,
      interval: command.interval,
      includeStart: true,
      includeEnd: true,
    });
    if (stationPoints.length === 0) return null;

    const prefix = command.labelPrefix?.trim();
    const summary = `Created ${stationPoints.length} alignment interval point${stationPoints.length === 1 ? '' : 's'} on ${alignmentEntity.name}`;
    const provenance = createCogoProvenance({
      toolKey: 'ALIGNMENT_INTERVALS',
      summary,
      sourceEntityIds: [alignmentEntity.id],
      inputs: {
        alignmentEntityId: alignmentEntity.id,
        alignmentName: alignmentEntity.name,
        labelPrefix: prefix ?? null,
      },
      parameters: {
        interval: command.interval,
        startStation: command.startStation ?? alignmentEntity.startStation,
        endStation: command.endStation ?? cadAlignmentEndStation(alignmentEntity) ?? alignmentEntity.startStation,
      },
    });
    let workingProject = snapshot.project;
    const createdEntities: CadEntity[] = [];
    const selectedPointIds: CadEntityId[] = [];
    stationPoints.forEach((stationPoint, index) => {
      const label = prefix ? `${prefix}${index + 1}` : undefined;
      const formattedStation = formatCadStation(stationPoint.station);
      const pointBundle = createManualPointEntities(
        workingProject,
        stationPoint.point.x,
        stationPoint.point.y,
        label,
        {
          createdBy: 'ALIGNMENT_INTERVAL_POINTS',
        },
      );
      const pointEntity: CadSurveyPointEntity = {
        ...pointBundle.point,
        metadata: {
          ...buildCadCogoEntityMetadata(pointBundle.point.metadata, provenance),
          alignmentEntityId: alignmentEntity.id,
          alignmentName: alignmentEntity.name,
          alignmentStation: formattedStation,
          alignmentOffset: 0,
          alignmentPointKind: 'interval',
        },
      };
      const labelEntity = pointBundle.label
        ? {
            ...pointBundle.label,
            text: buildAlignmentStakeoutLabelText(pointEntity.stationId, formattedStation),
            metadata: {
              ...buildCadCogoEntityMetadata(pointBundle.label.metadata, provenance),
              alignmentEntityId: alignmentEntity.id,
              alignmentName: alignmentEntity.name,
              alignmentStation: formattedStation,
              alignmentOffset: 0,
              alignmentPointKind: 'interval',
            },
          }
        : null;
      const entities = compactManualPointEntities([pointEntity, labelEntity]);
      workingProject = appendCadProjectEntities(workingProject, entities);
      createdEntities.push(...entities);
      selectedPointIds.push(pointEntity.id);
    });
    const startStation = command.startStation ?? alignmentEntity.startStation;
    const endStation = command.endStation ?? cadAlignmentEndStation(alignmentEntity) ?? alignmentEntity.startStation;
    const nextProject = appendCogoComputation({
      project: workingProject,
      provenance: {
        ...provenance,
        parameters: {
          interval: command.interval,
          startStation,
          endStation,
          pointCount: stationPoints.length,
        },
      },
      title: 'Alignment Interval Points',
      summary,
      rows: [
        { label: 'Alignment', value: alignmentEntity.name },
        { label: 'Start station', value: formatCadStation(startStation), unit: 'm' },
        { label: 'End station', value: formatCadStation(endStation), unit: 'm' },
        { label: 'Interval', value: command.interval.toFixed(3), unit: 'm' },
        { label: 'Points', value: String(stationPoints.length) },
      ],
      createdEntities,
    });
    return {
      nextSnapshot: {
        project: nextProject,
        selection: createCadSelectionState(nextProject, selectedPointIds),
      },
      commandState: {
        key: 'ALIGNMENT_INTERVAL_POINTS',
        phase: 'committed',
        prompt: `STA INT committed with ${stationPoints.length} point${stationPoints.length === 1 ? '' : 's'} on ${alignmentEntity.name}.`,
      },
      transactionLabel: `ALIGNMENT_INTERVAL_POINTS (${stationPoints.length})`,
      addedEntityIds: createdEntities.map((entity) => entity.id),
      removedEntityIds: [],
    };
  },
};

