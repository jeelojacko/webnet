import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildNbLawContentPackage, validateNbLawContentPackage } from '../src/study/content/nbLawContentPackage';
import { normalizeNbLawDocument, renderNbLawNormalizedMarkdown } from '../src/study/content/nbLawNormalize';
import type { NbLawNormalizedDocument, NbLawRawFetchMetadata } from '../src/study/content/nbLawTypes';
import {
  assertSitCorpusInventoryCanFetchRequired,
  buildSitCorpusInventoryReport,
  getFetchableRequiredSitDocuments,
  getRequiredSitDocuments,
  getRequiredSitRegulations,
  hashSitCorpusManifest,
  NB_SIT_CORPUS_ID,
  NB_SIT_FETCH_PIPELINE_VERSION,
  NB_SIT_NORMALIZER_VERSION,
  NB_SIT_PACKAGE_SCHEMA_VERSION,
  toNbLawManifestEntry,
} from '../src/study/content/nbSitCorpus';
import type {
  SitCorpusFetchStatusEntry,
  SitCorpusFetchStatusReport,
  SitCorpusManifest,
  SitSourceChange,
} from '../src/study/content/nbSitCorpusTypes';

const MANIFEST_PATH = path.resolve('study-content/manifests/nb-sit-statute-corpus.json');
const RAW_DIR = path.resolve('study-content/raw/nb-sit');
const NORMALIZED_DIR = path.resolve('study-content/normalized/nb-sit');
const PACKAGE_DIR = path.resolve('study-content/packages');
const REPORT_DIR = path.resolve('study-content/reports');
const PACKAGE_PATH = path.join(PACKAGE_DIR, 'nb-sit-statute-corpus.content-package.json');
const USER_AGENT = 'WebNetStudyCorpus/0.1 (development fetch; official laws.gnb.ca source only)';
const MAX_ATTEMPTS = 3;
const FETCH_DELAY_MS = 750;

const args = process.argv.slice(2);
const command = args.find((arg) => !arg.startsWith('--')) ?? 'inventory';
const hasFlag = (flag: string): boolean => args.includes(flag);
const getArg = (flag: string): string | undefined => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const writeJson = async (filePath: string, value: unknown): Promise<void> => {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const canonicalizeLawsGnbHtmlForHash = (html: string): string =>
  html.replace(/Pd\d+e\d+/g, 'Pd{volatile-anchor}');

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const loadManifest = async (): Promise<SitCorpusManifest> => readJson<SitCorpusManifest>(MANIFEST_PATH);

const renderInventoryMarkdown = (report: ReturnType<typeof buildSitCorpusInventoryReport>): string =>
  [
    `# ${report.title} Inventory`,
    '',
    `Manifest hash: ${report.manifestHash}`,
    '',
    `Expected Act count: ${report.expectedActCount}`,
    `Actual required Act count: ${report.actualRequiredActCount}`,
    `Required regulations: ${report.requiredRegulationCount}`,
    `Candidate regulations: ${report.candidateRegulationCount}`,
    `Missing source URLs: ${report.missingSourceUrls.length}`,
    `Duplicate IDs: ${report.duplicateIds.length}`,
    `Duplicate titles: ${report.duplicateTitles.length}`,
    `Unresolved parent Acts: ${report.unresolvedParentActs.length}`,
    `Unknown citations: ${report.unknownCitations.length}`,
    '',
    '## Pilot Documents',
    '',
    ...report.pilotDocuments.map((documentId) => `- ${documentId}`),
    '',
    '## Awaiting Manual Confirmation',
    '',
    ...(report.awaitingManualConfirmation.length > 0
      ? report.awaitingManualConfirmation.map((documentId) => `- ${documentId}`)
      : ['None']),
    '',
    '## Findings',
    '',
    ...(report.findings.length > 0
      ? report.findings.map((finding) => `- ${finding.severity} ${finding.code}: ${finding.message}`)
      : ['None']),
    '',
  ].join('\n');

const runInventory = async ({ failOnError }: { failOnError: boolean }): Promise<void> => {
  const manifest = await loadManifest();
  const report = buildSitCorpusInventoryReport(manifest);
  const discoveredCandidateCount = await writeRegulationCandidates(manifest, hasFlag('--discover-regulations'));
  if (hasFlag('--discover-regulations')) {
    report.candidateRegulationCount = discoveredCandidateCount;
  }
  await writeJson(path.join(REPORT_DIR, 'nb-sit-corpus-inventory.json'), report);
  await writeFile(path.join(REPORT_DIR, 'nb-sit-corpus-inventory.md'), renderInventoryMarkdown(report), 'utf8');
  console.log(`Required Acts: ${report.actualRequiredActCount} / ${report.expectedActCount}`);
  console.log(`Required Regulations: ${report.requiredRegulationCount}`);
  console.log(`Missing source URLs: ${report.missingSourceUrls.length}`);
  console.log(`Inventory errors: ${report.findings.filter((finding) => finding.severity === 'ERROR').length}`);
  if (failOnError) assertSitCorpusInventoryCanFetchRequired(report);
};

const fetchWithRetry = async (url: string): Promise<{ response: Response; attempts: number }> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok || response.status === 404 || attempt === MAX_ATTEMPTS) return { response, attempts: attempt };
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) throw error;
    }
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error('Fetch failed.');
};

const readExistingRawMetadata = async (documentId: string): Promise<NbLawRawFetchMetadata | undefined> => {
  try {
    return await readJson<NbLawRawFetchMetadata>(path.join(RAW_DIR, `${documentId}.metadata.json`));
  } catch {
    return undefined;
  }
};

const fetchDocument = async (
  document: SitCorpusManifest['documents'][number],
  force: boolean,
): Promise<SitCorpusFetchStatusEntry> => {
  const existing = await readExistingRawMetadata(document.id);
  if (!force && existing?.sourceUrl === document.sourceUrl) {
    try {
      await stat(path.join(RAW_DIR, `${document.id}.html`));
      return {
        documentId: document.id,
        sourceUrl: document.sourceUrl,
        status: 'unchanged',
        fetchedAt: existing.fetchedAt,
        sourceHash: existing.contentHash,
        previousSourceHash: existing.contentHash,
        attempts: 0,
      };
    } catch {
      // Missing raw file; refetch below.
    }
  }
  try {
    const { response, attempts } = await fetchWithRetry(document.sourceUrl);
    const html = await response.text();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (/The document does not exist in the database\./i.test(html)) {
      throw new Error(`laws.gnb.ca returned a missing-document page for ${document.sourceUrl}`);
    }
    const sourceHash = sha256(canonicalizeLawsGnbHtmlForHash(html));
    const metadata: NbLawRawFetchMetadata = {
      documentId: document.id,
      sourceUrl: document.sourceUrl,
      httpStatus: response.status,
      fetchedAt: new Date().toISOString(),
      contentHash: sourceHash,
    };
    await mkdir(RAW_DIR, { recursive: true });
    await writeFile(path.join(RAW_DIR, `${document.id}.html`), html, 'utf8');
    await writeJson(path.join(RAW_DIR, `${document.id}.metadata.json`), metadata);
    return {
      documentId: document.id,
      sourceUrl: document.sourceUrl,
      status: existing?.contentHash && existing.contentHash !== sourceHash ? 'changed' : 'success',
      fetchedAt: metadata.fetchedAt,
      sourceHash,
      previousSourceHash: existing?.contentHash,
      attempts,
    };
  } catch (error) {
    return {
      documentId: document.id,
      sourceUrl: document.sourceUrl,
      status: 'failed',
      previousSourceHash: existing?.contentHash,
      error: error instanceof Error ? error.message : String(error),
      attempts: MAX_ATTEMPTS,
    };
  }
};

const runFetch = async (): Promise<void> => {
  const manifest = await loadManifest();
  const report = buildSitCorpusInventoryReport(manifest);
  assertSitCorpusInventoryCanFetchRequired(report);
  const force = hasFlag('--force');
  const onlyDocument = getArg('--document');
  const documents = getFetchableRequiredSitDocuments(manifest).filter(
    (document) => !onlyDocument || document.id === onlyDocument,
  );
  const statuses: SitCorpusFetchStatusEntry[] = [];
  for (const [index, document] of documents.entries()) {
    if (index > 0) await sleep(FETCH_DELAY_MS);
    const status = await fetchDocument(document, force);
    statuses.push(status);
    console.log(`${status.status}: ${status.documentId}`);
  }
  const statusReport: SitCorpusFetchStatusReport = {
    corpusId: manifest.corpusId,
    generatedAt: new Date().toISOString(),
    documents: statuses,
  };
  await writeJson(path.join(REPORT_DIR, 'nb-sit-fetch-status.json'), statusReport);
  if (statuses.some((status) => status.status === 'failed')) process.exitCode = 1;
};

const runNormalize = async (): Promise<void> => {
  const manifest = await loadManifest();
  await mkdir(NORMALIZED_DIR, { recursive: true });
  let failed = 0;
  for (const document of getFetchableRequiredSitDocuments(manifest)) {
    try {
      const html = await readFile(path.join(RAW_DIR, `${document.id}.html`), 'utf8');
      const metadata = await readJson<NbLawRawFetchMetadata>(path.join(RAW_DIR, `${document.id}.metadata.json`));
      const normalized = normalizeNbLawDocument({
        entry: toNbLawManifestEntry(document),
        html,
        sourceUrl: metadata.sourceUrl || document.sourceUrl,
        fetchDate: metadata.fetchedAt,
        contentHash: metadata.contentHash,
      });
      await writeJson(path.join(NORMALIZED_DIR, `${document.id}.json`), normalized);
      await writeFile(path.join(NORMALIZED_DIR, `${document.id}.md`), renderNbLawNormalizedMarkdown(normalized), 'utf8');
      console.log(`normalized: ${document.id} (${normalized.components.length} components)`);
    } catch (error) {
      failed += 1;
      console.error(`failed: ${document.id} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (failed > 0) process.exitCode = 1;
};

const readNormalizedDocuments = async (manifest: SitCorpusManifest): Promise<NbLawNormalizedDocument[]> =>
  Promise.all(
    getFetchableRequiredSitDocuments(manifest).map((document) =>
      readJson<NbLawNormalizedDocument>(path.join(NORMALIZED_DIR, `${document.id}.json`)),
    ),
  );

const componentHashMap = (documents: NbLawNormalizedDocument[]): Map<string, { document: NbLawNormalizedDocument; hash: string }> =>
  new Map(
    documents.flatMap((document) =>
      document.components.map((component) => [
        `${document.id}:${component.sourceKey}`,
        { document, hash: component.contentHash },
      ] as const),
    ),
  );

const buildSourceChanges = (
  previousDocuments: NbLawNormalizedDocument[],
  currentDocuments: NbLawNormalizedDocument[],
): SitSourceChange[] => {
  const previous = componentHashMap(previousDocuments);
  const current = componentHashMap(currentDocuments);
  const changes: SitSourceChange[] = [];
  for (const [key, value] of current) {
    const old = previous.get(key);
    const sourceKey = key.slice(key.indexOf(':') + 1);
    changes.push({
      documentId: value.document.id,
      citation: value.document.officialCitationDisplay,
      sourceKey,
      oldHash: old?.hash,
      newHash: value.hash,
      changeType: !old ? 'added' : old.hash === value.hash ? 'unchanged' : 'changed',
    });
  }
  for (const [key, value] of previous) {
    if (!current.has(key)) {
      changes.push({
        documentId: value.document.id,
        citation: value.document.officialCitationDisplay,
        sourceKey: key.slice(key.indexOf(':') + 1),
        oldHash: value.hash,
        changeType: 'removed',
      });
    }
  }
  return changes;
};

const writeSourceChanges = async (currentDocuments: NbLawNormalizedDocument[]): Promise<SitSourceChange[]> => {
  let previousDocuments: NbLawNormalizedDocument[] = [];
  try {
    previousDocuments = (await readJson<{ documents: NbLawNormalizedDocument[] }>(PACKAGE_PATH)).documents;
  } catch {
    previousDocuments = [];
  }
  const changes = buildSourceChanges(previousDocuments, currentDocuments);
  await writeJson(path.join(REPORT_DIR, 'nb-sit-source-changes.json'), changes);
  await writeFile(
    path.join(REPORT_DIR, 'nb-sit-source-changes.md'),
    [
      '# NB SIT Source Changes',
      '',
      `Changed components: ${changes.filter((change) => change.changeType === 'changed').length}`,
      `Added components: ${changes.filter((change) => change.changeType === 'added').length}`,
      `Removed components: ${changes.filter((change) => change.changeType === 'removed').length}`,
      '',
      ...changes
        .filter((change) => change.changeType !== 'unchanged')
        .map(
          (change) =>
            `- ${change.changeType}: ${change.documentId} ${change.sourceKey} ${change.oldHash ?? ''} -> ${change.newHash ?? ''}`,
        ),
      '',
    ].join('\n'),
    'utf8',
  );
  return changes;
};

const runBuild = async (): Promise<void> => {
  const manifest = await loadManifest();
  const inventory = buildSitCorpusInventoryReport(manifest);
  assertSitCorpusInventoryCanFetchRequired(inventory);
  const documents = await readNormalizedDocuments(manifest);
  const createdAt = new Date().toISOString();
  const contentPackage = buildNbLawContentPackage({
    id: `${NB_SIT_CORPUS_ID}-${createdAt.slice(0, 10)}`,
    manifestId: manifest.corpusId,
    createdAt,
    documents,
  });
  const manifestHash = hashSitCorpusManifest(manifest);
  const corpusContentHash = sha256(
    JSON.stringify({
      manifestHash,
      documents: documents.map((document) => [document.id, document.contentHash, document.components.length]),
    }),
  );
  const packageWithMetadata = {
    ...contentPackage,
    corpusMetadata: {
      corpusId: manifest.corpusId,
      schemaVersion: manifest.schemaVersion,
      manifestHash,
      corpusContentHash,
      generatedAt: createdAt,
      fetchPipelineVersion: NB_SIT_FETCH_PIPELINE_VERSION,
      normalizerVersion: NB_SIT_NORMALIZER_VERSION,
      packageSchemaVersion: NB_SIT_PACKAGE_SCHEMA_VERSION,
    },
  };
  const validation = validateNbLawContentPackage(contentPackage);
  await mkdir(PACKAGE_DIR, { recursive: true });
  await writeJson(PACKAGE_PATH, packageWithMetadata);
  await writeIntegrityReports(manifest, contentPackage, validation.errors);
  await writeCoverage(manifest, documents, contentPackage.integrityReport?.documents ?? []);
  await writeSourceReviewQueue(contentPackage.integrityReport?.documents ?? []);
  await writePackageDiagnostics(documents, packageWithMetadata);
  await writeSourceChanges(documents);
  console.log(`Package: ${PACKAGE_PATH}`);
  console.log(`Corpus hash: ${corpusContentHash}`);
  console.log(`Integrity errors: ${validation.errors.length}`);
  if (!validation.valid) process.exitCode = 1;
};

const writeIntegrityReports = async (
  manifest: SitCorpusManifest,
  contentPackage: ReturnType<typeof buildNbLawContentPackage>,
  validationErrors: string[],
): Promise<void> => {
  const report = contentPackage.integrityReport;
  await writeJson(path.join(REPORT_DIR, 'nb-sit-integrity-report.json'), report);
  await writeFile(
    path.join(REPORT_DIR, 'nb-sit-integrity-report.md'),
    [
      `# ${manifest.title} Integrity Report`,
      '',
      `Required Acts: ${manifest.expectedRequiredActCount}`,
      `Required regulations: ${getRequiredSitRegulations(manifest).length}`,
      `Documents normalized: ${contentPackage.documents.length}`,
      `Total sections: ${contentPackage.documents.reduce((sum, document) => sum + document.sections.length, 0)}`,
      `Total subsections: ${contentPackage.documents.reduce((sum, document) => sum + document.sections.reduce((inner, section) => inner + section.subsections.length, 0), 0)}`,
      `Schedules: ${contentPackage.documents.reduce((sum, document) => sum + document.components.filter((component) => component.componentType === 'schedule').length, 0)}`,
      `Forms: ${contentPackage.documents.reduce((sum, document) => sum + document.components.filter((component) => component.componentType === 'form').length, 0)}`,
      `Errors: ${validationErrors.length}`,
      `Warnings: ${report?.warnings.length ?? 0}`,
      '',
      ...(report?.documents.flatMap((document) => [
        `## ${document.documentId}`,
        '',
        `Title: ${document.officialTitle}`,
        `Sections: ${document.sectionCount}`,
        `Subsections: ${document.subsectionCount}`,
        `Schedules: ${document.scheduleCount}`,
        `Forms: ${document.formCount}`,
        `Errors: ${document.errors.length}`,
        `Warnings: ${document.warnings.length}`,
        '',
      ]) ?? []),
    ].join('\n'),
    'utf8',
  );
};

const writeCoverage = async (
  manifest: SitCorpusManifest,
  documents: NbLawNormalizedDocument[],
  integrityDocuments: NonNullable<ReturnType<typeof buildNbLawContentPackage>['integrityReport']>['documents'],
): Promise<void> => {
  const byId = new Map(documents.map((document) => [document.id, document]));
  const integrityById = new Map(integrityDocuments.map((document) => [document.documentId, document]));
  const rows = getRequiredSitDocuments(manifest).map((entry) => {
    const document = byId.get(entry.id);
    const integrity = integrityById.get(entry.id);
    return [
      entry.id,
      entry.title,
      entry.type,
      entry.citation ?? '',
      entry.parentActId ?? '',
      entry.examScope,
      document ? 'normalized' : 'missing',
      document?.contentHash ?? '',
      document?.consolidatedTo ?? '',
      document?.sections.length ?? 0,
      document?.sections.reduce((sum, section) => sum + section.subsections.length, 0) ?? 0,
      document?.components.filter((component) => component.componentType === 'schedule').length ?? 0,
      document?.components.filter((component) => component.componentType === 'form').length ?? 0,
      document?.sections.filter((section) => /definition/i.test(section.heading ?? section.text.slice(0, 120))).length ?? 0,
      integrity?.warnings.length ?? 0,
      integrity?.errors.length ?? 0,
      entry.existingPilot ? 'yes' : 'no',
    ];
  });
  const header = [
    'Document ID',
    'Title',
    'Type',
    'Citation',
    'Parent Act',
    'Required/Candidate',
    'Fetch Status',
    'Source Hash',
    'Consolidation Date',
    'Section Count',
    'Subsection Count',
    'Schedule Count',
    'Form Count',
    'Definition Count',
    'Warning Count',
    'Error Count',
    'Pilot Document',
  ];
  const csv = [header, ...rows].map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
  await writeFile(path.join(REPORT_DIR, 'nb-sit-coverage.csv'), `${csv}\n`, 'utf8');
  await writeFile(
    path.join(REPORT_DIR, 'nb-sit-coverage.md'),
    ['# NB SIT Coverage', '', `| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`, ...rows.map((row) => `| ${row.join(' | ')} |`), ''].join('\n'),
    'utf8',
  );
};

const writeSourceReviewQueue = async (
  integrityDocuments: NonNullable<ReturnType<typeof buildNbLawContentPackage>['integrityReport']>['documents'],
): Promise<void> => {
  const rows = integrityDocuments.flatMap((document) => [
    ...document.errors.map((message) => ({ severity: 'ERROR', documentId: document.documentId, message })),
    ...document.warnings.map((message) => ({ severity: 'WARNING', documentId: document.documentId, message })),
    ...document.parsingWarnings.map((message) => ({ severity: 'WARNING', documentId: document.documentId, message })),
  ]);
  rows.sort((left, right) => left.severity.localeCompare(right.severity) || left.documentId.localeCompare(right.documentId));
  await writeFile(
    path.join(REPORT_DIR, 'nb-sit-source-review-queue.md'),
    ['# NB SIT Source Review Queue', '', ...(rows.length ? rows.map((row) => `- ${row.severity} ${row.documentId}: ${row.message}`) : ['No source-review items.']), ''].join('\n'),
    'utf8',
  );
};

const byteSize = async (filePath: string): Promise<number> => {
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
};

const writePackageDiagnostics = async (documents: NbLawNormalizedDocument[], packageValue: unknown): Promise<void> => {
  const packageText = JSON.stringify(packageValue);
  const rawFiles = await Promise.all(documents.map((document) => byteSize(path.join(RAW_DIR, `${document.id}.html`))));
  const normalizedFiles = await Promise.all(documents.map((document) => byteSize(path.join(NORMALIZED_DIR, `${document.id}.json`))));
  await writeJson(path.join(REPORT_DIR, 'nb-sit-package-diagnostics.json'), {
    rawCorpusSize: rawFiles.reduce((sum, size) => sum + size, 0),
    normalizedSize: normalizedFiles.reduce((sum, size) => sum + size, 0),
    packageJsonSize: Buffer.byteLength(packageText, 'utf8'),
    documentCount: documents.length,
    componentCount: documents.reduce((sum, document) => sum + document.components.length, 0),
  });
};

type DiscoveredRegulation = {
  parentIdentifier: string;
  citation: string;
  title: string;
  sourceUrl: string;
};

const decodeHtml = (value: string): string =>
  value
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

const discoverRegulationsFromOfficialTitleIndex = async (): Promise<Map<string, DiscoveredRegulation[]>> => {
  const html = await (await fetch('https://laws.gnb.ca/en/titles?corpus=statutes&selection=all')).text();
  const rows = [...html.matchAll(/<tr\b[^>]*class=["']([^"']*)["'][^>]*>([\s\S]*?)<\/tr>/gi)];
  const byParent = new Map<string, DiscoveredRegulation[]>();
  let currentParentIdentifier = '';
  for (const [, className, row] of rows) {
    const chapter = decodeHtml(row.match(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/i)?.[1].replace(/<[^>]+>/g, '') ?? '');
    const actMatch = row.match(/href=["']\/en\/document\/cs\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    const regulationMatch = row.match(/href=["']\/en\/document\/cr\/([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (className.includes('clickable') && actMatch) {
      currentParentIdentifier = decodeURIComponent(actMatch[1]);
      continue;
    }
    if (className.includes('nestedRow') && regulationMatch && currentParentIdentifier) {
      const citation = chapter || decodeURIComponent(regulationMatch[1]);
      const existing = byParent.get(currentParentIdentifier) ?? [];
      existing.push({
        parentIdentifier: currentParentIdentifier,
        citation,
        title: decodeHtml(regulationMatch[2].replace(/<[^>]+>/g, '')),
        sourceUrl: `https://laws.gnb.ca/en/document/cr/${decodeURIComponent(regulationMatch[1])}`,
      });
      byParent.set(currentParentIdentifier, existing);
    }
  }
  return byParent;
};

const writeRegulationCandidates = async (manifest: SitCorpusManifest, discover: boolean): Promise<number> => {
  const discovered = discover ? await discoverRegulationsFromOfficialTitleIndex() : new Map<string, DiscoveredRegulation[]>();
  const requiredByParent = new Map<string, string[]>();
  let candidateCount = 0;
  for (const regulation of getRequiredSitRegulations(manifest)) {
    if (!regulation.parentActId) continue;
    requiredByParent.set(regulation.parentActId, [...(requiredByParent.get(regulation.parentActId) ?? []), regulation.citation ?? regulation.id]);
  }
  const lines = ['# NB SIT Regulation Candidates', '', 'Candidate discovery uses the official laws.gnb.ca title index. Candidate regulations are not included in the required package unless explicitly listed as required.', ''];
  for (const act of manifest.documents.filter((document) => document.type === 'act' && document.examScope === 'required')) {
    lines.push(`## ${act.title}`, '', 'Required:');
    const required = requiredByParent.get(act.id) ?? [];
    lines.push(...(required.length > 0 ? required.map((item) => `- ${item}`) : ['- None recorded as required.']));
    lines.push('', 'Other discovered regulations:');
    const discoveredForAct = act.sourceIdentifier ? discovered.get(act.sourceIdentifier) ?? [] : [];
    const requiredCitations = new Set(required);
    if (!discover) {
      lines.push('- Discovery not run in this inventory pass.', '');
    } else {
      const candidates = discoveredForAct.filter((regulation) => !requiredCitations.has(`N.B. Reg. ${regulation.citation}`));
      candidateCount += candidates.length;
      lines.push(
        ...(candidates.length > 0
          ? candidates.map((regulation) => `- ${regulation.citation} - ${regulation.title} (${regulation.sourceUrl})`)
          : ['- None discovered beyond required regulations.']),
        '',
      );
    }
  }
  await mkdir(REPORT_DIR, { recursive: true });
  await writeFile(path.join(REPORT_DIR, 'nb-sit-regulation-candidates.md'), lines.join('\n'), 'utf8');
  return candidateCount;
};

const runValidate = async (): Promise<void> => {
  const manifest = await loadManifest();
  const inventory = buildSitCorpusInventoryReport(manifest);
  await runInventory({ failOnError: false });
  if (inventory.findings.some((finding) => finding.severity === 'ERROR')) {
    process.exitCode = 1;
    return;
  }
  const documents = await readNormalizedDocuments(manifest);
  const pack = buildNbLawContentPackage({
    id: `${NB_SIT_CORPUS_ID}-validation`,
    manifestId: manifest.corpusId,
    createdAt: new Date().toISOString(),
    documents,
  });
  const validation = validateNbLawContentPackage(pack);
  await writeIntegrityReports(manifest, pack, validation.errors);
  if (!validation.valid) process.exitCode = 1;
};

const runRefresh = async (): Promise<void> => {
  await runInventory({ failOnError: true });
  await runFetch();
  if (process.exitCode) return;
  await runNormalize();
  if (process.exitCode) return;
  await runValidate();
  if (process.exitCode) return;
  await runBuild();
};

if (command === 'inventory') await runInventory({ failOnError: false });
else if (command === 'fetch') await runFetch();
else if (command === 'normalize') await runNormalize();
else if (command === 'validate') await runValidate();
else if (command === 'build') await runBuild();
else if (command === 'refresh') await runRefresh();
else {
  console.error(`Unknown study corpus command: ${command}`);
  process.exitCode = 1;
}
