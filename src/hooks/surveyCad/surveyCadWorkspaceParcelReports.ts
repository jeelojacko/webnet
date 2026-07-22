import {
  cadBuildParcelGapDiagnostics,
  cadBuildParcelLineworkDiagnostics,
  cadBuildParcelOverlapDiagnostics,
} from '../../engine/cad/cadCogo';
import { buildCadCogoComputation, type CadCogoComputation } from '../../engine/cad/cadCogoTypes';
import type { CadLineEntity, CadParcelEntity } from '../../engine/cad/cadTypes';

type SurveyCadWorkspaceParcelReportsOptions = {
  selectedParcelDiagnosticLines: CadLineEntity[];
  selectedParcelsForOverlap: CadParcelEntity[];
  setReportedComputation: (_next: CadCogoComputation | null) => void;
};

export const buildSurveyCadWorkspaceParcelReports = ({
  selectedParcelDiagnosticLines,
  selectedParcelsForOverlap,
  setReportedComputation,
}: SurveyCadWorkspaceParcelReportsOptions) => ({
    reportParcelGapFromSelection: () => {
      if (selectedParcelsForOverlap.length < 2) return;
      const diagnostics = cadBuildParcelGapDiagnostics(selectedParcelsForOverlap);
      const summary = !diagnostics.isSupported
        ? 'Selected parcels do not form one simple connected coverage for gap detection.'
        : diagnostics.gapLoops.length === 0
          ? `Checked ${diagnostics.exposedLoopCount} exposed loop${diagnostics.exposedLoopCount === 1 ? '' : 's'}. No enclosed gaps found.`
          : `Found ${diagnostics.gapLoops.length} enclosed gap loop${diagnostics.gapLoops.length === 1 ? '' : 's'} inside the selected parcel coverage.`;
      setReportedComputation(
        buildCadCogoComputation({
          createdEntities: [],
          report: {
            title: 'Parcel Gap Check',
            summary,
            rows: [
              { label: 'Parcels', value: diagnostics.parcelCount.toFixed(0) },
              { label: 'Components', value: diagnostics.componentCount.toFixed(0) },
              { label: 'Supported', value: diagnostics.isSupported ? 'Yes' : 'No' },
              { label: 'Exposed loops', value: diagnostics.exposedLoopCount.toFixed(0) },
              { label: 'Gap loops', value: diagnostics.gapLoops.length.toFixed(0) },
              {
                label: 'Total gap area',
                value: diagnostics.totalGapAreaSquareMeters.toFixed(3),
                unit: 'm2',
              },
              ...(
                diagnostics.gapLoops.length === 0
                  ? [{ label: 'Gaps', value: diagnostics.isSupported ? 'None' : 'Unsupported selection' }]
                  : diagnostics.gapLoops.flatMap((gap, index) => [
                      {
                        label: `Gap ${index + 1} Area`,
                        value: gap.areaSquareMeters.toFixed(3),
                        unit: 'm2',
                      },
                      {
                        label: `Gap ${index + 1} Center`,
                        value: `${gap.centroid.x.toFixed(3)}, ${gap.centroid.y.toFixed(3)}`,
                      },
                    ])
              ),
            ],
          },
          warnings: [],
          provenance: {
            id: `parcel-gap:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            toolKey: 'PARCEL_GAP',
            inputs: {
              parcelEntityIds: selectedParcelsForOverlap.map((entity) => entity.id),
            },
            resultSummary: summary,
            createdAtIso: new Date().toISOString(),
          },
        }),
      );
    },
    reportParcelDiagnosticsFromSelection: () => {
      if (selectedParcelDiagnosticLines.length === 0) return;
      const diagnostics = cadBuildParcelLineworkDiagnostics(selectedParcelDiagnosticLines);
      const openEnds = diagnostics.danglingNodes.map((node) => node.label).join(', ');
      const branchNodes = diagnostics.branchNodes.map((node) => node.label).join(', ');
      const overlapSummary = diagnostics.overlapSegments
        .map((segment) => `${segment.firstLabel}-${segment.secondLabel} x${segment.segmentCount}`)
        .join(', ');
      const summary = diagnostics.isClosedLoopCandidate
        ? 'Selected linework forms one closed parcel loop.'
        : `Selected linework has ${diagnostics.danglingNodes.length} open end${diagnostics.danglingNodes.length === 1 ? '' : 's'}, ${diagnostics.branchNodes.length} branch node${diagnostics.branchNodes.length === 1 ? '' : 's'}, and ${diagnostics.overlapSegments.length} overlap group${diagnostics.overlapSegments.length === 1 ? '' : 's'}.`;
      setReportedComputation(
        buildCadCogoComputation({
          createdEntities: [],
          report: {
            title: 'Parcel Linework Check',
            summary,
            rows: [
              {
                label: 'Status',
                value: diagnostics.isClosedLoopCandidate ? 'Closed loop ready for PARCEL' : 'Needs cleanup',
              },
              { label: 'Lines', value: diagnostics.lineCount.toFixed(0) },
              { label: 'Nodes', value: diagnostics.nodeCount.toFixed(0) },
              { label: 'Components', value: diagnostics.componentCount.toFixed(0) },
              { label: 'Open ends', value: openEnds || 'None' },
              { label: 'Branch nodes', value: branchNodes || 'None' },
              { label: 'Overlaps', value: overlapSummary || 'None' },
            ],
          },
          warnings: [],
          provenance: {
            id: `parcel-check:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            toolKey: 'PARCEL_CHECK',
            inputs: {
              sourceEntityIds: selectedParcelDiagnosticLines.map((entity) => entity.id),
            },
            resultSummary: summary,
            createdAtIso: new Date().toISOString(),
          },
        }),
      );
    },
    reportParcelOverlapFromSelection: () => {
      if (selectedParcelsForOverlap.length < 2) return;
      const diagnostics = cadBuildParcelOverlapDiagnostics(selectedParcelsForOverlap);
      const summary =
        diagnostics.overlapPairs.length === 0
          ? `Checked ${diagnostics.pairCount} parcel pair${diagnostics.pairCount === 1 ? '' : 's'}. No overlaps found.`
          : `Found ${diagnostics.overlapPairs.length} overlapping parcel pair${diagnostics.overlapPairs.length === 1 ? '' : 's'} across ${diagnostics.pairCount} checked pair${diagnostics.pairCount === 1 ? '' : 's'}.`;
      setReportedComputation(
        buildCadCogoComputation({
          createdEntities: [],
          report: {
            title: 'Parcel Overlap Check',
            summary,
            rows: [
              { label: 'Parcels', value: diagnostics.parcelCount.toFixed(0) },
              { label: 'Pairs checked', value: diagnostics.pairCount.toFixed(0) },
              { label: 'Overlap pairs', value: diagnostics.overlapPairs.length.toFixed(0) },
              {
                label: 'Total overlap',
                value: diagnostics.totalOverlapAreaSquareMeters.toFixed(3),
                unit: 'm2',
              },
              ...(
                diagnostics.overlapPairs.length === 0
                  ? [{ label: 'Pairs', value: 'None' }]
                  : diagnostics.overlapPairs.map((pair, index) => ({
                      label: `Pair ${index + 1}`,
                      value: `${pair.firstParcelName} x ${pair.secondParcelName}`,
                    }))
              ),
              ...diagnostics.overlapPairs.map((pair, index) => ({
                label: `Pair ${index + 1} Area`,
                value: pair.overlapAreaSquareMeters.toFixed(3),
                unit: 'm2',
              })),
            ],
          },
          warnings: [],
          provenance: {
            id: `parcel-overlap:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            toolKey: 'PARCEL_OVERLAP',
            inputs: {
              parcelEntityIds: selectedParcelsForOverlap.map((entity) => entity.id),
            },
            resultSummary: summary,
            createdAtIso: new Date().toISOString(),
          },
        }),
      );
    },
});
