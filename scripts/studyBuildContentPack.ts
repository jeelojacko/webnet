import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NbLawManifest, NbLawNormalizedDocument } from '../src/study/content/nbLawTypes';
import { getEnabledNbLawEntries, validateNbLawManifest } from '../src/study/content/nbLawManifest';
import { buildNbLawContentPackage, validateNbLawContentPackage } from '../src/study/content/nbLawContentPackage';

const MANIFEST_PATH = path.resolve('study-content/manifests/nb-law-pilot.json');
const NORMALIZED_DIR = path.resolve('study-content/normalized/nb-law-pilot');
const PACK_DIR = path.resolve('study-content/packages');
const REPORT_DIR = path.resolve('study-content/reports');

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const main = async (): Promise<void> => {
  const manifest = await readJson<NbLawManifest>(MANIFEST_PATH);
  const manifestValidation = validateNbLawManifest(manifest);
  if (!manifestValidation.valid) {
    manifestValidation.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
    return;
  }
  const documents = await Promise.all(
    getEnabledNbLawEntries(manifest).map((entry) =>
      readJson<NbLawNormalizedDocument>(path.join(NORMALIZED_DIR, `${entry.id}.json`)),
    ),
  );
  const createdAt = new Date().toISOString();
  const contentPackage = buildNbLawContentPackage({
    id: `${manifest.id}-${createdAt.slice(0, 10)}`,
    manifestId: manifest.id,
    createdAt,
    documents,
  });
  const packageValidation = validateNbLawContentPackage(contentPackage);
  if (!packageValidation.valid) {
    packageValidation.errors.forEach((error) => console.error(error));
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(
      path.join(REPORT_DIR, `${manifest.id}.integrity-report.json`),
      `${JSON.stringify(contentPackage.integrityReport, null, 2)}\n`,
      'utf8',
    );
    process.exitCode = 1;
    return;
  }
  await mkdir(PACK_DIR, { recursive: true });
  await mkdir(REPORT_DIR, { recursive: true });
  const outputPath = path.join(PACK_DIR, `${manifest.id}.content-package.json`);
  const reportJsonPath = path.join(REPORT_DIR, `${manifest.id}.integrity-report.json`);
  const reportMdPath = path.join(REPORT_DIR, `${manifest.id}.integrity-report.md`);
  await writeFile(outputPath, `${JSON.stringify(contentPackage, null, 2)}\n`, 'utf8');
  await writeFile(reportJsonPath, `${JSON.stringify(contentPackage.integrityReport, null, 2)}\n`, 'utf8');
  await writeFile(
    reportMdPath,
    [
      `# ${manifest.title} Integrity Report`,
      '',
      `Created: ${contentPackage.integrityReport?.createdAt ?? createdAt}`,
      '',
      `Errors: ${contentPackage.integrityReport?.errors.length ?? 0}`,
      `Warnings: ${contentPackage.integrityReport?.warnings.length ?? 0}`,
      '',
      ...(contentPackage.integrityReport?.documents.flatMap((document) => [
        `## ${document.documentId}`,
        '',
        `Title: ${document.officialTitle}`,
        `Citation: ${document.officialCitation ?? ''}`,
        `Type: ${document.documentType}`,
        `Expected parent: ${document.expectedParentAct ?? ''}`,
        `Enabling Acts: ${document.extractedEnablingActs.map((act) => act.title).join(', ')}`,
        `Consolidated to: ${document.consolidationDate ?? ''}`,
        `Sections: ${document.sectionCount}`,
        `Subsections: ${document.subsectionCount}`,
        `Schedules: ${document.scheduleCount}`,
        `Forms: ${document.formCount}`,
        `Boilerplate: ${document.boilerplateContamination.ok ? 'ok' : document.boilerplateContamination.markers.join(', ')}`,
        `Duplicate source keys: ${document.duplicateSourceKeys.ok ? 'ok' : document.duplicateSourceKeys.keys.join(', ')}`,
        `TOC references: ${document.tableOfContentsReferences.ok ? 'ok' : document.tableOfContentsReferences.missingSourceKeys.join(', ')}`,
        `Hash: ${document.contentHash}`,
        '',
      ]) ?? []),
    ].join('\n'),
    'utf8',
  );
  console.log(`built: ${outputPath}`);
  console.log(`integrity: ${reportJsonPath}`);
};

await main();
