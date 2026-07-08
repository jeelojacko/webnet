import { buildCadCogoComputation } from './cadCogoTypes';
import { appendCadProjectCogoComputation } from './cadProjectState';
import type { CadCogoReportTable, CadCogoToolKey } from './cadCogoTypes';
import type { CadEntity, CadEntityId, CadProject } from './cadTypes';
import { createStableRuntimeId } from '../id';

export const createCogoProvenance = ({
  toolKey,
  summary,
  sourceEntityIds,
  sourcePointIds,
  inputs,
  parameters,
}: {
  toolKey: CadCogoToolKey;
  summary: string;
  sourceEntityIds?: CadEntityId[];
  sourcePointIds?: string[];
  inputs: Record<string, unknown>;
  parameters?: Record<string, unknown>;
}) => ({
  id: createStableRuntimeId('cad-cogo'),
  toolKey,
  inputs,
  parameters,
  sourceEntityIds,
  sourcePointIds,
  resultSummary: summary,
});

export const appendCogoComputation = ({
  project,
  provenance,
  title,
  summary,
  rows,
  tables = [],
  createdEntities,
}: {
  project: CadProject;
  provenance: ReturnType<typeof createCogoProvenance>;
  title: string;
  summary: string;
  rows: Array<{ label: string; value: string; unit?: string }>;
  tables?: CadCogoReportTable[];
  createdEntities: CadEntity[];
}): CadProject => {
  return appendCadProjectCogoComputation(
    project,
    buildCadCogoComputation({
      createdEntities,
      report: {
        title,
        summary,
        rows,
        tables,
      },
      warnings: [],
      provenance,
    }),
  );
};

export const buildParcelSetReportTable = ({
  title,
  parcels,
}: {
  title: string;
  parcels: Array<{
    name: string;
    role: string;
    areaSquareMeters: number;
    perimeterMeters: number;
    closureDistanceMeters: number;
  }>;
}): CadCogoReportTable => ({
  title,
  columns: ['Name', 'Role', 'Area (m2)', 'Perimeter (m)', 'Closure (m)'],
  rows: parcels.map((parcel) => [
    parcel.name,
    parcel.role,
    parcel.areaSquareMeters.toFixed(3),
    parcel.perimeterMeters.toFixed(3),
    parcel.closureDistanceMeters.toFixed(6),
  ]),
});
