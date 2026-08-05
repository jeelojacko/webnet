import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NbLawManifest, NbLawRawFetchMetadata } from '../src/study/content/nbLawTypes';
import { buildNbLawSourceUrl, getEnabledNbLawEntries, validateNbLawManifest } from '../src/study/content/nbLawManifest';
import { normalizeNbLawDocument, renderNbLawNormalizedMarkdown } from '../src/study/content/nbLawNormalize';

const MANIFEST_PATH = path.resolve('study-content/manifests/nb-law-pilot.json');
const RAW_DIR = path.resolve('study-content/raw/nb-law-pilot');
const NORMALIZED_DIR = path.resolve('study-content/normalized/nb-law-pilot');

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const main = async (): Promise<void> => {
  const manifest = await readJson<NbLawManifest>(MANIFEST_PATH);
  const validation = validateNbLawManifest(manifest);
  if (!validation.valid) {
    validation.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
    return;
  }
  await mkdir(NORMALIZED_DIR, { recursive: true });
  let failed = 0;
  for (const entry of getEnabledNbLawEntries(manifest)) {
    try {
      const html = await readFile(path.join(RAW_DIR, `${entry.id}.html`), 'utf8');
      const metadata = await readJson<NbLawRawFetchMetadata>(
        path.join(RAW_DIR, `${entry.id}.metadata.json`),
      );
      const document = normalizeNbLawDocument({
        entry,
        html,
        sourceUrl: metadata.sourceUrl || buildNbLawSourceUrl(entry, manifest.sourceBaseUrl),
        fetchDate: metadata.fetchedAt,
        contentHash: metadata.contentHash,
      });
      await writeFile(
        path.join(NORMALIZED_DIR, `${entry.id}.json`),
        `${JSON.stringify(document, null, 2)}\n`,
        'utf8',
      );
      await writeFile(
        path.join(NORMALIZED_DIR, `${entry.id}.md`),
        renderNbLawNormalizedMarkdown(document),
        'utf8',
      );
      console.log(`normalized: ${entry.id} (${document.sections.length} sections)`);
    } catch (error) {
      failed += 1;
      console.error(`failed: ${entry.id} (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  if (failed > 0) process.exitCode = 1;
};

await main();
