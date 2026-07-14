import { buildCadCogoComputation } from '../../engine/cad/cadCogoTypes';

type CadCogoComputation = ReturnType<typeof buildCadCogoComputation>;

export type SurveyCadReportPublisher = (
  _toolKey: string,
  _title: string,
  _summary: string,
  _rows: Array<{ label: string; value: string; unit?: string }>,
  _alternatives?: Array<{ id: string; label: string; point?: { x: number; y: number } }>,
) => void;

type ReportComputationHandler = (_computation: CadCogoComputation | null) => void;

const buildReportProvenance = (toolKey: string, summary: string) => ({
  id: `${toolKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
  toolKey,
  inputs: {},
  resultSummary: summary,
  createdAtIso: new Date().toISOString(),
});

export const createSurveyCadReportPublisher = (
  onReportComputation?: ReportComputationHandler,
): SurveyCadReportPublisher =>
  (toolKey, title, summary, rows, alternatives = []) => {
    onReportComputation?.(
      buildCadCogoComputation({
        createdEntities: [],
        report: {
          title,
          summary,
          rows,
        },
        warnings: [],
        alternatives,
        provenance: buildReportProvenance(toolKey, summary),
      }),
    );
  };
