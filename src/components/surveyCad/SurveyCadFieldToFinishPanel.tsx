import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { CadProject } from '../../engine/cad/cadTypes';
import type { FeatureCodeCatalog } from '../../engine/fieldToFinish/featureCatalog';
import { cloneFeatureCatalog } from '../../engine/fieldToFinish/featureCatalog';
import { STARTER_CATALOG } from '../../engine/fieldToFinish/starterCatalog';
import {
  importCatalog,
  validateCatalogStyleReferences,
  type ControlTokenAliasProfile,
} from '../../engine/fieldToFinish/catalogIo';
import { diffFeatureCatalogs } from '../../engine/fieldToFinish/catalogRevision';
import { buildCodeIndex, matchCodeToken } from '../../engine/fieldToFinish/codeMatching';
import {
  buildFieldToFinishPayload,
  type FieldToFinishCadPayload,
  type FieldToFinishCadPoint,
} from '../../engine/fieldToFinish/cadGeneration';
import {
  applyFieldToFinishRegen,
  previewFieldToFinishRegen,
  type FieldToFinishRegenPreview,
} from '../../engine/fieldToFinish/regeneration';
import type { FieldToFinishSyncStatus } from '../../engine/fieldToFinish/linkedSync';
import type { SuccessfulAdjustmentRunInfo } from '../../hooks/useAdjustmentOutcomeApplication';
import {
  adjustedStationsToFieldToFinishPoints,
  authoritativeCoordinatesOf,
  controlStationsToFieldToFinishPoints,
} from '../../engine/fieldToFinish/regeneration';
import { parseTerrestrialCoordinateCsv } from '../../engine/terrestrialCsvImport';
import { SurveyCadFeatureCatalogEditor } from './SurveyCadFeatureCatalogEditor';
import { CatalogFileIo } from './F2FCatalogFileIo';
import { F2FReviewTable } from './F2FReviewTable';
import { TokenProfileEditor } from './F2FTokenProfile';
import { buildF2FReviewRows, summarizeF2FReview } from './f2fReviewUtils';
import {
  summarizeGeneratedFeatures,
  surfaceLegacyProvenance,
} from './f2fGeneratedSummary';

interface FieldToFinishPanelProps {
  project: CadProject;
  onCommitPayload: (_payload: FieldToFinishCadPayload) => void;
  catalog?: FeatureCodeCatalog;
  onCatalogChange?: (_catalog: FeatureCodeCatalog) => void;
  adjustmentSource?: SuccessfulAdjustmentRunInfo | null;
  /** READY when the drawing owns a catalog; MISSING_LEGACY blocks regen. */
  catalogStatus?: 'READY' | 'MISSING_LEGACY';
  catalogIsFallback?: boolean;
  catalogHasLegacyContent?: boolean;
  referenceCounts?: Record<string, number>;
  fieldToFinishSettings?: { controlTokenAliases?: ControlTokenAliasProfile };
  onFieldToFinishSettingsChange?: (_settings: { controlTokenAliases?: ControlTokenAliasProfile }) => void;
  /** Toolspace/ribbon focus target. Session-only; consumed into step state. */
  f2fSection?: string | null;
}

type PanelStep = 'CONFIGURE' | 'REVIEW' | 'MAPPINGS' | 'PREVIEW' | 'COMMIT';

const STEPS: PanelStep[] = ['CONFIGURE', 'REVIEW', 'MAPPINGS', 'PREVIEW', 'COMMIT'];

const INLINE_SAMPLE = [
  'Point,Northing,Easting,Elevation,Code,Description',
  'C1,1000,5000,100,CONTROL,Control station',
  'E1,950,5010,99.8,EDGE BEGIN,Edge start',
  'E2,960,5020,99.7,EDGE CONTINUE,',
  'E3,970,5030,99.6,EDGE END,Edge end',
  'T1,980,5050,100.1,TREE,Oak',
  'R1,990,5070,100.2,ROCK,Unmapped rock',
].join('\n');

const STALE_LINK_COPY: Record<Exclude<FieldToFinishSyncStatus, 'CURRENT' | 'UNLINKED'>, string> = {
  COORDINATES_CHANGED: 'Adjusted coordinates changed since generation.',
  SOURCE_TOPOLOGY_CHANGED: 'Adjustment stations were added or removed since generation.',
  CATALOG_CHANGED: 'The feature catalog changed since generation.',
  FEATURE_METADATA_CHANGED: 'Field coding changed since generation.',
  MANUAL_CONFLICT: 'Manual overrides conflict with generated geometry.',
  MISSING_SOURCE: 'Linked source stations are missing from the latest result.',
};

const sectionToStep = (section: string | null | undefined): PanelStep | null => {
  switch (section) {
    case 'codes':
    case 'aliases':
    case 'import':
    case 'export':
    case 'catalog':
    case 'generated':
      return 'CONFIGURE';
    case 'review':
      return 'REVIEW';
    case 'mappings':
    case 'unmapped':
      return 'MAPPINGS';
    case 'regen':
    case 'link':
      return 'PREVIEW';
    case 'commit':
      return 'COMMIT';
    default:
      return null;
  }
};

export const SurveyCadFieldToFinishPanel: React.FC<FieldToFinishPanelProps> = ({
  project,
  onCommitPayload,
  catalog: controlledCatalog,
  onCatalogChange,
  adjustmentSource = null,
  catalogStatus = 'READY',
  catalogIsFallback = false,
  catalogHasLegacyContent = false,
  referenceCounts = {},
  fieldToFinishSettings,
  onFieldToFinishSettingsChange,
  f2fSection = null,
}) => {
  const [step, setStep] = useState<PanelStep>('CONFIGURE');
  const [localCatalog, setLocalCatalog] = useState<FeatureCodeCatalog>(() => cloneFeatureCatalog(STARTER_CATALOG));
  const controlled = controlledCatalog !== undefined && onCatalogChange !== undefined;
  const catalog = controlled ? (controlledCatalog as FeatureCodeCatalog) : localCatalog;
  const setCatalog = controlled
    ? (onCatalogChange as (_catalog: FeatureCodeCatalog) => void)
    : setLocalCatalog;
  const [csvText, setCsvText] = useState(INLINE_SAMPLE);
  const [points, setPoints] = useState<FieldToFinishCadPoint[] | null>(null);
  const [importNote, setImportNote] = useState('');
  const [runId, setRunId] = useState('ui-1');
  const [importKey] = useState('f2f-ui-import');
  const [regenPreview, setRegenPreview] = useState<FieldToFinishRegenPreview | null>(null);
  const [createPrefill, setCreatePrefill] = useState<{ code: string; description?: string; layer?: string } | null>(null);
  const [catalogNotice, setCatalogNotice] = useState('');
  const [importPreview, setImportPreview] = useState<{ catalog: FeatureCodeCatalog; fileName: string } | null>(null);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const next = sectionToStep(f2fSection);
    if (next) setStep(next);
  }, [f2fSection]);

  const controlTokenAliases = useMemo(
    () => fieldToFinishSettings?.controlTokenAliases ?? {},
    [fieldToFinishSettings],
  );
  const missingLegacy = catalogStatus === 'MISSING_LEGACY' || catalogHasLegacyContent;
  const generated = useMemo(() => summarizeGeneratedFeatures(project), [project]);
  const legacyTrace = useMemo(
    () => (missingLegacy ? surfaceLegacyProvenance(project) : null),
    [missingLegacy, project],
  );

  const reviewRows = useMemo(
    () => (points ? buildF2FReviewRows(points, catalog, controlTokenAliases) : []),
    [points, catalog, controlTokenAliases],
  );
  const summary = useMemo(
    () => (points ? summarizeF2FReview(points, catalog, controlTokenAliases) : null),
    [points, catalog, controlTokenAliases],
  );
  // Per-row matched-definition lookup for Layer/Style/Linework columns.
  const rowDetails = useMemo(() => {
    const index = buildCodeIndex(catalog.definitions, catalog.aliases);
    const byId = new Map(catalog.definitions.map((def) => [def.id, def]));
    return new Map(
      reviewRows.map((row) => {
        const hit = row.codes.map((code) => matchCodeToken(code, index)).find((id) => id !== undefined);
        const def = hit ? byId.get(hit) : undefined;
        return [row.pointId, def ?? null] as const;
      }),
    );
  }, [reviewRows, catalog]);
  const unmappedCodes = useMemo(() => {
    const codes = new Map<string, { description: string; count: number }>();
    for (const row of reviewRows) {
      if (row.mappingStatus !== 'Unmapped') continue;
      for (const code of row.codes) {
        const key = code.trim().toUpperCase();
        if (!key) continue;
        const prior = codes.get(key);
        codes.set(key, { description: row.description, count: (prior?.count ?? 0) + 1 });
      }
    }
    return [...codes.entries()].sort(([a], [b]) => (a < b ? -1 : 1));
  }, [reviewRows]);

  const preview = useMemo(() => {
    if (!points) return null;
    const built = buildFieldToFinishPayload(project, {
      points,
      catalog,
      generationRunId: runId,
      controlTokenAliases,
    });
    return {
      stats: {
        create: built.addedEntityIds.length,
        update: built.updatedEntityIds.length,
        labels: built.stats.labels,
        segments: built.stats.linework,
        layers: built.payload.layersToAdd.length,
        styles: built.payload.stylesToAdd.length,
        unmapped: built.stats.unmapped,
      },
      warnings: built.warnings,
      payload: built.payload,
    };
  }, [points, project, catalog, runId, controlTokenAliases]);

  const styleFallbacks = useMemo(
    () =>
      validateCatalogStyleReferences(catalog, {
        pointStyles: project.pointStyles,
        labelStyles: project.labelStyles,
        pointSymbols: project.styleLibrary.pointSymbols,
      }),
    [catalog, project.pointStyles, project.labelStyles, project.styleLibrary.pointSymbols],
  );

  const adjustedCommit = useMemo((): {
    payload: FieldToFinishCadPayload | null;
    adjustedCount: number;
    total: number;
    missing: string[];
  } | null => {
    if (!points || !adjustmentSource) return null;
    const coords = authoritativeCoordinatesOf(adjustmentSource.result);
    const missing = points
      .map((point) => point.stationId)
      .filter((stationId) => !coords.has(stationId));
    if (missing.length > 0) return { payload: null, adjustedCount: points.length - missing.length, total: points.length, missing };
    const overlaid = adjustedStationsToFieldToFinishPoints(points, coords);
    const built = buildFieldToFinishPayload(project, {
      points: overlaid,
      catalog,
      generationRunId: runId,
      controlTokenAliases,
      source: {
        sourceKind: 'adjustment',
        inputFingerprint: adjustmentSource.inputFingerprint,
        settingsFingerprint: adjustmentSource.settingsFingerprint,
        resultFingerprint: adjustmentSource.resultFingerprint,
      },
      resultDependencyIdentity: adjustmentSource.resultDependencyIdentity ?? null,
    });
    return { payload: built.payload, adjustedCount: points.length, total: points.length, missing: [] };
  }, [points, adjustmentSource, project, catalog, runId, controlTokenAliases]);

  const runImport = (text: string): void => {
    const dataset = parseTerrestrialCoordinateCsv(text, { units: 'm', unitsExplicit: true }, 'f2f-import.csv');
    if (!dataset) {
      setPoints(null);
      setImportNote('Import failed: header must carry Point/ID + Northing + Easting (units m).');
      return;
    }
    const converted = controlStationsToFieldToFinishPoints(dataset.controlStations, importKey);
    setPoints(converted);
    setRegenPreview(null);
    setImportNote(`Imported ${converted.length} points from ${dataset.controlStations.length} records.`);
    setRunId((current) => `ui-${Number(current.slice(3)) + 1}`);
  };

  const runRegenPreview = (): void => {
    if (!points || missingLegacy) return;
    setRegenPreview(previewFieldToFinishRegen(project, { points, catalog, generationRunId: runId, controlTokenAliases }, importKey));
  };

  // Explicit atomic Apply Regeneration: GENERATED-only removal list from the
  // confirmed engine apply, committed as ONE F2F_GENERATE transaction.
  // MANUAL_OVERRIDE/DETACHED are never in the removal list; confirmed:false
  // removes nothing (preview path). Manual overrides, layer edits, style
  // definitions, and Point Group precedence are preserved by the payload
  // path — counts below surface what was kept.
  const applyRegen = (): void => {
    if (!points || missingLegacy) return;
    const args = { points, catalog, generationRunId: runId, controlTokenAliases };
    const confirmed = applyFieldToFinishRegen(project, args, importKey, { confirmed: true });
    const built = buildFieldToFinishPayload(project, args);
    onCommitPayload({ ...built.payload, removeEntityIds: confirmed.removedEntityIds });
    const { project: _dropped, ...previewOnly } = confirmed;
    setRegenPreview(previewOnly);
  };

  const onPickImportFile = async (file: File | undefined): Promise<void> => {
    setImportError('');
    if (!file) return;
    const text = await file.text();
    const result = importCatalog(text);
    if (!result.catalog) {
      // Malformed or error-level issues: existing catalog stays unchanged.
      setImportPreview(null);
      setImportError(`Import rejected — catalog unchanged: ${result.issues.map((issue) => issue.message).join(' ')}`);
      return;
    }
    setImportPreview({ catalog: result.catalog, fileName: file.name });
  };

  const link = project.metadata.fieldToFinishLink;
  const staleCopy = link && link.status !== 'CURRENT' && link.status !== 'UNLINKED'
    ? STALE_LINK_COPY[link.status]
    : null;
  const importDiff = importPreview ? diffFeatureCatalogs(catalog, importPreview.catalog) : null;

  return (
    <div className="grid gap-2" data-f2f-panel>
      {staleCopy ? (
        <div className="rounded border border-amber-500 bg-amber-950 px-2 py-1 text-[12px] text-amber-200" data-f2f-link-status={link?.status}>
          <span>Linked sync {link?.status}: {staleCopy} Structural changes need an explicit preview before regenerating — nothing is applied automatically.</span>
          {' '}
          <button type="button" className="underline hover:text-amber-100" onClick={() => setStep('PREVIEW')} data-f2f-link-review>
            Review source &amp; preview
          </button>
        </div>
      ) : null}
      <div role="tablist" aria-label="Field-to-Finish workflow" className="flex flex-wrap gap-1">
        {STEPS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={step === key}
            className={`rounded border px-2 py-1 text-[12px] hover:bg-slate-800 ${step === key ? 'border-sky-500' : 'border-slate-600'}`}
            onClick={() => setStep(key)}
            data-f2f-step={key}
          >
            {key === 'CONFIGURE' ? '1 Configure' : key === 'REVIEW' ? '2 Load/Review' : key === 'MAPPINGS' ? '3 Mappings' : key === 'PREVIEW' ? '4 Preview' : '5 Commit'}
          </button>
        ))}
      </div>

      {step === 'CONFIGURE' ? (
        <div className="grid gap-2" data-f2f-configure>
          {missingLegacy ? (
            <div className="rounded border border-red-700 bg-red-950 px-2 py-1 text-[12px] text-red-200" data-f2f-legacy-block>
              <p className="font-semibold">Legacy drawing: no feature catalog stored — regeneration blocked.</p>
              <p>
                This drawing has field-to-finish content but no catalog (provenance only carries
                {legacyTrace && legacyTrace.catalogIds.length > 0 ? ` catalog ${legacyTrace.catalogIds.join(', ')}` : ' a catalog id'}
                {legacyTrace && legacyTrace.catalogVersions.length > 0 ? ` v${legacyTrace.catalogVersions.join(', v')}` : ''}
                {legacyTrace && legacyTrace.definitionIds.length > 0 ? `, definitions ${legacyTrace.definitionIds.slice(0, 8).join(', ')}${legacyTrace.definitionIds.length > 8 ? '…' : ''}` : ''}).
                Existing content stays visible; nothing regenerates until a catalog is attached. No sample catalog is claimed.
              </p>
              <div className="mt-1 flex gap-1">
                <button
                  type="button"
                  className="rounded border border-sky-500 bg-sky-950 px-2 py-1 hover:bg-sky-900"
                  onClick={() => {
                    setCatalog(cloneFeatureCatalog(STARTER_CATALOG));
                    setCatalogNotice('Starter catalog attached — review codes before regenerating.');
                  }}
                  data-f2f-attach-starter
                >
                  Attach starter
                </button>
                <button
                  type="button"
                  className="rounded border border-slate-600 px-2 py-1 hover:bg-slate-800"
                  onClick={() => fileInputRef.current?.click()}
                  data-f2f-legacy-import
                >
                  Import catalog
                </button>
              </div>
            </div>
          ) : null}
          <p className="text-[12px] text-slate-300" data-f2f-generated-summary>
            Generated: {generated.points} points · {generated.labels} labels · {generated.linework} linework ·{' '}
            {generated.overrides} overrides · {generated.detached} detached · {generated.unmapped} unmapped · link {link?.status ?? 'UNLINKED'}
          </p>
          <SurveyCadFeatureCatalogEditor
            catalog={catalog}
            onCatalogChange={setCatalog}
            drawing={{
              layers: project.layers,
              pointSymbols: project.styleLibrary.pointSymbols,
              pointStyles: project.pointStyles ?? [],
              labelStyles: project.labelStyles ?? [],
            }}
            linkStatus={link?.status ?? 'UNLINKED'}
            isFallback={catalogIsFallback}
            referenceCounts={referenceCounts}
            createPrefill={createPrefill}
            onCreateConsumed={() => setCreatePrefill(null)}
            focusSection={f2fSection}
          />
          <TokenProfileEditor
            aliases={controlTokenAliases}
            onSave={(next) => onFieldToFinishSettingsChange?.({ controlTokenAliases: next })}
          />
          <CatalogFileIo
            catalog={catalog}
            catalogNotice={catalogNotice}
            importPreview={importPreview}
            importDiff={importDiff}
            importError={importError}
            linkStatus={link?.status ?? 'UNLINKED'}
            project={project}
            fileInputRef={fileInputRef}
            onPickFile={onPickImportFile}
            onReplace={() => {
              if (!importPreview) return;
              setCatalog(importPreview.catalog);
              setCatalogNotice(`Catalog replaced from ${importPreview.fileName} — link CATALOG_CHANGED, no auto-regen.`);
              setImportPreview(null);
            }}
            onCancelImport={() => setImportPreview(null)}
          />
        </div>
      ) : null}

      {step === 'REVIEW' ? (
        <div className="grid gap-2" data-f2f-review>
          <textarea
            aria-label="Coded point CSV"
            className="h-28 rounded border border-slate-700 bg-slate-900 p-1 font-mono text-[11px]"
            value={csvText}
            onChange={(event) => setCsvText(event.target.value)}
          />
          <div className="flex items-center gap-1">
            <button type="button" className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800" onClick={() => runImport(csvText)} data-f2f-import-run>
              Review import
            </button>
            <button type="button" className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800" onClick={() => { setCsvText(INLINE_SAMPLE); runImport(INLINE_SAMPLE); }} data-f2f-import-sample>
              Load sample
            </button>
            {importNote ? <span className="text-[11px] text-slate-400">{importNote}</span> : null}
          </div>
          {summary ? (
            <p className="text-[12px]" data-f2f-review-summary>
              {summary.total} points · {summary.mapped} mapped · {summary.unmapped} unmapped ·{' '}
              {summary.noCode} without code · {summary.invalidControls} invalid controls ·{' '}
              {summary.chains} linework chains · {summary.lineworkWarnings} warnings ·{' '}
              {summary.lineworkFailures} failures
            </p>
          ) : null}
          <F2FReviewTable rows={reviewRows} details={rowDetails} />
        </div>
      ) : null}

      {step === 'MAPPINGS' ? (
        <div className="grid gap-2" data-f2f-mappings>
          {unmappedCodes.length === 0 ? (
            <p className="text-[12px] text-emerald-300">No unmapped codes — run a load/review first.</p>
          ) : (
            <>
              <p className="text-[12px] text-slate-300">{unmappedCodes.length} unmapped codes preserved (never auto-created):</p>
              <div className="grid max-h-56 gap-0.5 overflow-auto text-[12px]" data-f2f-unmapped-list>
                {unmappedCodes.map(([code, info]) => (
                  <div key={code} className="flex items-center justify-between gap-2 border-t border-slate-800 py-0.5">
                    <span className="font-mono">{code} <span className="text-slate-500">×{info.count}</span></span>
                    <button
                      type="button"
                      className="rounded border border-sky-500 px-2 py-0.5 hover:bg-sky-950"
                      onClick={() => {
                        setCreatePrefill({ code, ...(info.description ? { description: info.description } : {}), layer: `F2F-${code}` });
                        setStep('CONFIGURE');
                      }}
                      data-f2f-create-definition={code}
                    >
                      Create definition from code
                    </button>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-slate-500">Creating pre-fills code/description/suggested layer — you confirm in Configure; nothing is auto-created.</p>
            </>
          )}
        </div>
      ) : null}

      {step === 'PREVIEW' ? (
        <div className="grid gap-2" data-f2f-regen>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="rounded border border-sky-500 bg-sky-950 px-2 py-1 text-[12px] hover:bg-sky-900 disabled:opacity-40"
              onClick={runRegenPreview}
              disabled={!points || missingLegacy}
              title={missingLegacy ? 'Blocked: legacy drawing has no catalog' : 'Compute regeneration preview'}
              data-f2f-regen-preview
            >
              Preview regeneration
            </button>
            {missingLegacy ? <span className="text-[11px] text-red-300">Regen blocked — attach or import a catalog in Configure.</span> : null}
            {!points ? <span className="text-[11px] text-slate-500">Run a load/review first.</span> : null}
          </div>
          {regenPreview ? (
            <div className="grid gap-1 text-[12px]" data-f2f-regen-counts>
              <p>
                +{regenPreview.added.length} create · ~{regenPreview.updated.length} update ·{' '}
                −{regenPreview.removed.length} remove (GENERATED only) · {regenPreview.codesChanged.length} recoded ·{' '}
                {regenPreview.lineworkChanged.length} linework · {regenPreview.unmapped.length} unmapped ·{' '}
                {regenPreview.manualConflicts.length} overrides preserved
              </p>
              {regenPreview.manualConflicts.length > 0 ? (
                <p className="text-slate-400">Manual overrides kept, never silently removed: {regenPreview.manualConflicts.join(', ')}</p>
              ) : null}
              {regenPreview.warnings.length > 0 ? (
                <ul className="grid max-h-32 gap-0.5 overflow-auto text-[11px] text-amber-300">
                  {regenPreview.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>{warning.code}{warning.pointId ? ` ${warning.pointId}` : ''}: {warning.message}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          {styleFallbacks.length > 0 ? (
            <ul className="grid gap-0.5 text-[11px] text-amber-300" data-f2f-style-fallbacks>
              {styleFallbacks.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {step === 'COMMIT' ? (
        <div className="grid gap-2" data-f2f-preview>
          {!preview ? (
            <p className="text-[12px] text-slate-400">Run an import review first.</p>
          ) : (
            <>
              <p className="text-[12px]" data-f2f-preview-counts>
                {preview.stats.create} create · {preview.stats.update} update · {preview.stats.labels} labels ·{' '}
                {preview.stats.segments} linework · {preview.stats.layers} layers ·{' '}
                {preview.stats.styles} styles · {preview.stats.unmapped} unmapped
              </p>
              {preview.warnings.length > 0 ? (
                <ul className="grid max-h-40 gap-0.5 overflow-auto text-[11px] text-amber-300" data-f2f-preview-warnings>
                  {preview.warnings.map((warning, index) => (
                    <li key={`${warning.code}-${index}`}>
                      {warning.code}{warning.pointId ? ` ${warning.pointId}` : ''}: {warning.message}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[12px] text-emerald-300">No diagnostics.</p>
              )}
              {adjustedCommit ? (
                <p className="text-[12px] text-slate-300" data-f2f-adjusted-note>
                  {adjustedCommit.missing.length === 0 ? (
                    <>
                      {adjustedCommit.adjustedCount} of {adjustedCommit.total} stations use adjusted
                      coordinates from the current run; committing linked enables rerun auto-sync.
                    </>
                  ) : (
                    <>
                      Linked commit unavailable: {adjustedCommit.missing.join(', ')} has no
                      adjusted or sideshot coordinates in the current run. Commit
                      coordinate-import instead — it never auto-syncs.
                    </>
                  )}
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  className="rounded border border-sky-500 bg-sky-950 px-2 py-1 text-[12px] hover:bg-sky-900 disabled:opacity-40"
                  onClick={() => onCommitPayload(preview.payload)}
                  disabled={missingLegacy}
                  title={missingLegacy ? 'Blocked: legacy drawing has no catalog' : 'Commit as one transaction'}
                  data-f2f-commit
                >
                  Confirm commit (one transaction)
                </button>
                {adjustedCommit?.payload ? (
                  <button
                    type="button"
                    className="rounded border border-emerald-500 bg-emerald-950 px-2 py-1 text-[12px] hover:bg-emerald-900 disabled:opacity-40"
                    onClick={() => adjustedCommit.payload && onCommitPayload(adjustedCommit.payload)}
                    disabled={missingLegacy}
                    data-f2f-commit-adjusted
                  >
                    Commit linked to adjustment run
                  </button>
                ) : null}
                {regenPreview ? (
                  <button
                    type="button"
                    className="rounded border border-amber-500 bg-amber-950 px-2 py-1 text-[12px] hover:bg-amber-900 disabled:opacity-40"
                    onClick={applyRegen}
                    disabled={missingLegacy}
                    title="Atomic: one undoable transaction; GENERATED-only removal"
                    data-f2f-regen-apply
                  >
                    Apply regeneration (−{regenPreview.removed.length} GENERATED, one transaction)
                  </button>
                ) : null}
                <button
                  type="button"
                  className="rounded border border-slate-600 px-2 py-1 text-[12px] hover:bg-slate-800"
                  onClick={() => setRunId((current) => `ui-${Number(current.slice(3)) + 1}`)}
                >
                  Refresh preview
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
