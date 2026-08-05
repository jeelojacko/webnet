import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { NbLawManifest, NbLawRawFetchMetadata } from '../src/study/content/nbLawTypes';
import { buildNbLawSourceUrl, getEnabledNbLawEntries, validateNbLawManifest } from '../src/study/content/nbLawManifest';

const MANIFEST_PATH = path.resolve('study-content/manifests/nb-law-pilot.json');
const RAW_DIR = path.resolve('study-content/raw/nb-law-pilot');
const USER_AGENT = 'WebNetStudyContentPilot/0.1 (development fetch; https://github.com/openai/codex)';
const MIN_DELAY_MS = 1000;
const MAX_ATTEMPTS = 3;

type FetchStatus = 'changed' | 'unchanged' | 'failed';

type FetchReport = {
  id: string;
  status: FetchStatus;
  detail: string;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const canonicalizeLawsGnbHtmlForHash = (html: string): string =>
  html.replace(/Pd\d+e\d+/g, 'Pd{volatile-anchor}');

const readJson = async <T>(filePath: string): Promise<T> =>
  JSON.parse(await readFile(filePath, 'utf8')) as T;

const readExistingHash = async (metadataPath: string): Promise<string | undefined> => {
  try {
    const metadata = await readJson<NbLawRawFetchMetadata>(metadataPath);
    return metadata.contentHash;
  } catch {
    return undefined;
  }
};

const fetchWithRetry = async (url: string): Promise<Response> => {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      if (response.ok || attempt === MAX_ATTEMPTS) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === MAX_ATTEMPTS) throw error;
    }
    await sleep(500 * 2 ** (attempt - 1));
  }
  throw lastError instanceof Error ? lastError : new Error('Fetch failed.');
};

const fetchEntry = async (
  manifest: NbLawManifest,
  entry: ReturnType<typeof getEnabledNbLawEntries>[number],
): Promise<FetchReport> => {
  const url = buildNbLawSourceUrl(entry, manifest.sourceBaseUrl);
  const htmlPath = path.join(RAW_DIR, `${entry.id}.html`);
  const metadataPath = path.join(RAW_DIR, `${entry.id}.metadata.json`);
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();
    if (/The document does not exist in the database\./i.test(html)) {
      throw new Error(`laws.gnb.ca returned a missing-document page for ${url}`);
    }
    const contentHash = sha256(canonicalizeLawsGnbHtmlForHash(html));
    const existingHash = await readExistingHash(metadataPath);
    const metadata: NbLawRawFetchMetadata = {
      documentId: entry.id,
      sourceUrl: url,
      httpStatus: response.status,
      fetchedAt: new Date().toISOString(),
      contentHash,
    };
    await mkdir(RAW_DIR, { recursive: true });
    if (existingHash !== contentHash) {
      await writeFile(htmlPath, html, 'utf8');
      await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
      return { id: entry.id, status: 'changed', detail: `HTTP ${response.status}` };
    }
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
    return { id: entry.id, status: 'unchanged', detail: `HTTP ${response.status}` };
  } catch (error) {
    return {
      id: entry.id,
      status: 'failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

const main = async (): Promise<void> => {
  const manifest = await readJson<NbLawManifest>(MANIFEST_PATH);
  const validation = validateNbLawManifest(manifest);
  if (!validation.valid) {
    validation.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
    return;
  }
  const enabledEntries = getEnabledNbLawEntries(manifest);
  const reports: FetchReport[] = [];
  for (const [index, entry] of enabledEntries.entries()) {
    if (index > 0) await sleep(MIN_DELAY_MS);
    reports.push(await fetchEntry(manifest, entry));
  }
  const changed = reports.filter((report) => report.status === 'changed');
  const unchanged = reports.filter((report) => report.status === 'unchanged');
  const failed = reports.filter((report) => report.status === 'failed');
  const missing = enabledEntries.filter(
    (entry) => !reports.some((report) => report.id === entry.id && report.status !== 'failed'),
  );
  console.log(`Changed: ${changed.length}`);
  console.log(`Unchanged: ${unchanged.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log(`Missing: ${missing.length}`);
  for (const report of reports) console.log(`${report.status}: ${report.id} (${report.detail})`);
  if (failed.length > 0 || missing.length > 0) process.exitCode = 1;
};

await main();
