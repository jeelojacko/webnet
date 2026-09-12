/**
 * Phase 12E.2 — minimal zero-dependency .xlsx reader for the TBC vector
 * list. Evidence tooling only: manual ZIP parsing (stored + deflate via
 * node:zlib) plus shared-string/sheet XML cell scans. No new dependencies.
 *
 * Only the decoded string/numeric grid is exposed; column semantics stay
 * with the caller (most vectorlist.xlsx columns are UNRESOLVED).
 */
import { inflateRawSync } from 'node:zlib';

export type XlsxCell = string;

const findEndOfCentralDirectory = (data: Buffer): number => {
  for (let i = data.length - 22; i >= 0; i -= 1) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      return i;
    }
  }
  throw new Error('XLSX: end-of-central-directory not found.');
};

const readEntries = (data: Buffer): Map<string, Buffer> => {
  const eocd = findEndOfCentralDirectory(data);
  const count = data.readUInt16LE(eocd + 10);
  let offset = data.readUInt32LE(eocd + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i += 1) {
    const method = data.readUInt16LE(offset + 10);
    const compSize = data.readUInt32LE(offset + 20);
    const nameLen = data.readUInt16LE(offset + 28);
    const extraLen = data.readUInt16LE(offset + 30);
    const commentLen = data.readUInt16LE(offset + 32);
    const headerOffset = data.readUInt32LE(offset + 42);
    const name = data.toString('utf8', offset + 46, offset + 46 + nameLen);
    const localNameLen = data.readUInt16LE(headerOffset + 26);
    const localExtraLen = data.readUInt16LE(headerOffset + 28);
    const start = headerOffset + 30 + localNameLen + localExtraLen;
    const raw = data.subarray(start, start + compSize);
    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`XLSX: unsupported compression method ${method} for ${name}.`);
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return files;
};

const decodeSharedStrings = (xml: string): string[] => {
  const out: string[] = [];
  const pattern = /<si>([\s\S]*?)<\/si\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    const texts: string[] = [];
    const inner = /<t[^>]*>([\s\S]*?)<\/t\s*>/g;
    let text: RegExpExecArray | null;
    while ((text = inner.exec(match[1] ?? '')) !== null) texts.push(text[1] ?? '');
    out.push(texts.join(''));
  }
  return out;
};

const columnIndex = (ref: string): number => {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
};

/** Dense row-major grid; missing cells decode as ''. */
export const decodeXlsxSheet = (xlsx: Buffer, sheetPath: string): XlsxCell[][] => {
  const entries = readEntries(xlsx);
  const sheet = entries.get(sheetPath)?.toString('utf8');
  if (sheet == null) throw new Error(`XLSX: missing ${sheetPath}.`);
  const shared = entries.has('xl/sharedStrings.xml')
    ? decodeSharedStrings(entries.get('xl/sharedStrings.xml')?.toString('utf8') ?? '')
    : [];
  const grid: XlsxCell[][] = [];
  const rowPattern = /<row[^>]*>([\s\S]*?)<\/row\s*>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(sheet)) !== null) {
    const row: XlsxCell[] = [];
    const cellPattern = /<c ([^>]*?)>(?:<v>([\s\S]*?)<\/v\s*>)?/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellPattern.exec(rowMatch[1] ?? '')) !== null) {
      const attrs = cellMatch[1] ?? '';
      const raw = cellMatch[2] ?? '';
      const ref = /r="([A-Z]+\d+)"/.exec(attrs)?.[1] ?? 'A1';
      const kind = /t="([a-z])"/.exec(attrs)?.[1];
      const value =
        kind === 's' ? (shared[Number(raw)] ?? '') : kind === 'b' ? (raw === '1' ? 'TRUE' : 'FALSE') : raw;
      row[columnIndex(ref)] = value;
    }
    grid.push(row.map((cell) => cell ?? ''));
  }
  return grid;
};

/** Column-A IDs (solution IDs) of the first sheet. */
export const decodeXlsxColumnA = (xlsx: Buffer): string[] =>
  decodeXlsxSheet(xlsx, 'xl/worksheets/sheet1.xml')
    .map((row) => row[0] ?? '')
    .filter((id) => id !== '');
