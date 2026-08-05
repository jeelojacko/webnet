import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NbLawManifest, NbLawNormalizedDocument } from '../src/study/content/nbLawTypes';
import { getEnabledNbLawEntries, validateNbLawManifest } from '../src/study/content/nbLawManifest';
import { buildNbLawContentPackage, validateNbLawContentPackage } from '../src/study/content/nbLawContentPackage';

const MANIFEST_PATH = path.resolve('study-content/manifests/nb-law-pilot.json');
const NORMALIZED_DIR = path.resolve('study-content/normalized/nb-law-pilot');
const PACK_DIR = path.resolve('study-content/packages');

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
    process.exitCode = 1;
    return;
  }
  await mkdir(PACK_DIR, { recursive: true });
  const outputPath = path.join(PACK_DIR, `${manifest.id}.content-package.json`);
  await writeFile(outputPath, `${JSON.stringify(contentPackage, null, 2)}\n`, 'utf8');
  console.log(`built: ${outputPath}`);
};

await main();
