/**
 * Phase 12E0 — GVX 1.0 syntax stage (raw document, no canonical math).
 *
 * XML text into a GvxDocument with frame resolution and XML-path error
 * context. Canonical math lives in gnssGvxImport.ts. See GVX_IMPORT.md.
 */
import type { GnssDiagnostic } from './gnssBaselineNetworkImport';
import { parseGnssStrictNumber } from './gnssBaselineNetworkImport';
import {
  GvxXmlError,
  parseXmlDocument,
  xmlChild,
  xmlChildren,
  xmlChildText,
  type GvxXmlNode,
} from './gnssGvxXml';

export interface GvxPointFrame {
  readonly id: string;
  readonly name: string;
  readonly epoch?: string;
}

export interface GvxOrbitFrame {
  readonly id: string;
  readonly name: string;
}

export interface GvxSourceMetadata {
  readonly version: string;
  readonly pointFrame: GvxPointFrame;
  readonly orbitFrame?: GvxOrbitFrame;
  readonly vectorCount: number;
  readonly markCount: number;
  /** Sorted unique element names ignored as non-math extension metadata. */
  readonly ignoredElements: string[];
  /** Max |apriori TO-FROM minus observed| over vectors, metres. */
  readonly aprioriMaxMisclosureM: number;
}

/** Raw (pre-canonicalization) GVX vector in document order. */
export interface GvxRawVector {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly dx: number;
  readonly dy: number;
  readonly dz: number;
  readonly sdx: number;
  readonly sdy: number;
  readonly sdz: number;
  readonly pxy: number;
  readonly pxz: number;
  readonly pyz: number;
  readonly line: number;
}

/** Raw (pre-canonicalization) GVX mark in first-seen document order. */
export interface GvxRawMark {
  readonly id: string;
  readonly name: string;
  readonly referenceSystemId: string;
  readonly epoch?: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly line: number;
}

/** Raw GVX document: syntax output, no canonical math applied. */
export interface GvxDocument {
  readonly version: string;
  readonly vectors: GvxRawVector[];
  readonly marks: GvxRawMark[];
  readonly pointFrame: GvxPointFrame;
  readonly orbitFrame?: GvxOrbitFrame;
  readonly ignoredElements: string[];
  readonly sourceFile?: string;
}

const GVX_VERSION = '1.0';
/** A-priori duplicate-mark equivalence threshold (proven precision). */
const APRIORI_EQUIVALENCE_M = 1e-6;
const MAX_ID_LENGTH = 64;
const RESERVED_IDS = new Set(['__proto__', 'prototype', 'constructor']);

export const gvxFail = (
  diagnostics: GnssDiagnostic[],
  code: string,
  message: string,
  line?: number,
  extra?: Partial<GnssDiagnostic>,
): void => {
  diagnostics.push({ severity: 'error', code, message, line, ...extra });
};

const checkId = (value: string | undefined, what: string, path: string): string => {
  const id = (value ?? '').trim();
  if (!id || id.length > MAX_ID_LENGTH || RESERVED_IDS.has(id)) {
    throw new Error(`${path}: ${what} '${value ?? ''}' is invalid.`);
  }
  return id;
};

const readNumber = (value: string | undefined, what: string, path: string): number => {
  try {
    return parseGnssStrictNumber(value, what, 0);
  } catch (failure) {
    const detail = failure instanceof Error ? failure.message.replace(/^Line 0: /, '') : String(failure);
    throw new Error(`${path}: ${detail}`);
  }
};

const requiredChildText = (
  node: GvxXmlNode,
  name: string,
  what: string,
  path: string,
): string => {
  const value = xmlChildText(node, name);
  if (value === undefined || value === '') {
    throw new Error(`${path}: missing required ${what} '${name}'.`);
  }
  return value;
};

export interface GvxSyntaxResult {
  readonly document: GvxDocument | null;
  readonly source: GvxSourceMetadata | null;
  readonly diagnostics: GnssDiagnostic[];
}

/**
 * Syntax stage: XML text into a raw GVX document. Collects reference
 * frames, marks, and vectors with XML-path error context. Returns null
 * document/source (with error diagnostics) when the input is not consumable.
 * No canonical math is applied here; see canonicalizeGvxDocument.
 */
export const parseGvxSyntax = (text: string, sourceFile?: string): GvxSyntaxResult => {
  const diagnostics: GnssDiagnostic[] = [];
  const ignored = new Set<string>();
  const ignore = (node: GvxXmlNode): void => {
    ignored.add(node.name);
  };

  let root: GvxXmlNode;
  try {
    root = parseXmlDocument(text);
  } catch (failure) {
    const line = failure instanceof GvxXmlError ? failure.line : undefined;
    const message = failure instanceof Error ? failure.message : String(failure);
    gvxFail(diagnostics, 'GNSS_GVX_BAD_XML', message, line);
    return { document: null, source: null, diagnostics };
  }
  if (root.name !== 'GVX') {
    gvxFail(diagnostics, 'GNSS_GVX_BAD_XML', `GVX/GVX: root element is '${root.name}', expected 'GVX'.`, root.line);
    return { document: null, source: null, diagnostics };
  }
  const version = (root.attrs['VERSION'] ?? '').trim();
  if (version !== GVX_VERSION) {
    gvxFail(
      diagnostics,
      'GNSS_GVX_UNSUPPORTED_VERSION',
      `GVX/GVX: VERSION '${version || '(missing)'}' is unsupported; only '${GVX_VERSION}' is accepted (fail closed).`,
      root.line,
    );
    return { document: null, source: null, diagnostics };
  }

  // Reference frames: point frame feeds canonical metadata; the orbit
  // frame (e.g. IGS14) is recorded for provenance and never mismatched.
  const frameById = new Map<string, { name: string; linearUnit: string }>();
  root.children.forEach((node) => {
    if (node.name !== 'REFERENCE_SYSTEM') return;
    const path = 'GVX/REFERENCE_SYSTEM';
    try {
      const id = checkId(xmlChildText(node, 'ID'), 'reference-system ID', path);
      const name = requiredChildText(node, 'NAME', 'reference-system name', path);
      const linearUnit = xmlChildText(xmlChild(node, 'LINEAR_UNIT') ?? node, 'NAME') ?? '';
      if (frameById.has(id)) throw new Error(`${path}: duplicate REFERENCE_SYSTEM ID '${id}'.`);
      frameById.set(id, { name, linearUnit });
    } catch (failure) {
      gvxFail(diagnostics, 'GNSS_GVX_BAD_XML', failure instanceof Error ? failure.message : String(failure), node.line);
    }
    node.children.forEach((child) => {
      if (child.name !== 'ID' && child.name !== 'NAME' && child.name !== 'LINEAR_UNIT' && child.name !== 'ANGULAR_UNIT') {
        ignore(child);
      }
    });
  });

  // Marks: POINT elements in first-seen document order.
  const marks: GvxRawMark[] = [];
  const markById = new Map<string, GvxRawMark>();
  xmlChildren(root, 'POINT').forEach((node) => {
    const path = 'GVX/POINT';
    try {
      const id = checkId(xmlChildText(node, 'ID'), 'POINT ID', path);
      const name = xmlChildText(node, 'NAME')?.trim() || id;
      const coordinates = xmlChild(node, 'COORDINATES');
      if (!coordinates) throw new Error(`${path}: missing required coordinates 'COORDINATES'.`);
      const refId = checkId(
        xmlChildText(coordinates, 'REFERENCE_SYSTEM_ID'),
        'REFERENCE_SYSTEM_ID',
        `${path}/COORDINATES`,
      );
      const epochRaw = xmlChildText(coordinates, 'EPOCH')?.trim();
      const epoch = epochRaw === '' || epochRaw === undefined ? undefined : epochRaw;
      const geocentric = xmlChild(coordinates, 'GEOCENTRIC_COORDINATES');
      if (!geocentric) {
        throw new Error(
          `${path}/COORDINATES: missing required math block 'GEOCENTRIC_COORDINATES' (no geodetic fallback; transforms are out of scope).`,
        );
      }
      const mark: GvxRawMark = {
        id,
        name,
        referenceSystemId: refId,
        epoch,
        x: readNumber(xmlChildText(geocentric, 'X'), 'GEOCENTRIC X', `${path}/COORDINATES/GEOCENTRIC_COORDINATES`),
        y: readNumber(xmlChildText(geocentric, 'Y'), 'GEOCENTRIC Y', `${path}/COORDINATES/GEOCENTRIC_COORDINATES`),
        z: readNumber(xmlChildText(geocentric, 'Z'), 'GEOCENTRIC Z', `${path}/COORDINATES/GEOCENTRIC_COORDINATES`),
        line: node.line,
      };
      const prior = markById.get(id);
      if (prior) {
        const drift = Math.max(
          Math.abs(prior.x - mark.x),
          Math.abs(prior.y - mark.y),
          Math.abs(prior.z - mark.z),
        );
        if (prior.referenceSystemId !== mark.referenceSystemId || (prior.epoch ?? '') !== (mark.epoch ?? '')) {
          throw new Error(`${path}: duplicate POINT ID '${id}' disagrees on frame/epoch.`);
        }
        // A-priori consistency: equivalent within proven precision keeps
        // first-seen order silently; anything larger is a diagnostic.
        if (!(drift <= APRIORI_EQUIVALENCE_M)) {
          diagnostics.push({
            severity: 'warning',
            code: 'GNSS_GVX_BAD_XML',
            message: `${path}: duplicate POINT ID '${id}' differs by ${drift} m; first-seen coordinates kept.`,
            line: node.line,
            stationId: id,
          });
        }
      } else {
        markById.set(id, mark);
        marks.push(mark);
      }
      node.children.forEach((child) => {
        if (child.name !== 'ID' && child.name !== 'NAME' && child.name !== 'COORDINATES') ignore(child);
      });
      coordinates.children.forEach((child) => {
        if (child.name !== 'REFERENCE_SYSTEM_ID' && child.name !== 'EPOCH' && child.name !== 'GEOCENTRIC_COORDINATES') {
          ignore(child);
        }
      });
    } catch (failure) {
      gvxFail(diagnostics, 'GNSS_GVX_BAD_XML', failure instanceof Error ? failure.message : String(failure), node.line, {
        stationId: xmlChildText(node, 'ID')?.trim(),
      });
    }
  });

  // Vectors: GNSS_VECTOR elements in document order (never deduplicated
  // by endpoints; identity is the vector ID / source position).
  const vectors: GvxRawVector[] = [];
  const vectorIds = new Set<string>();
  const vectorNodes = xmlChildren(root, 'GNSS_VECTOR');
  vectorNodes.forEach((node, index) => {
    const path = `GVX/GNSS_VECTOR[${index + 1}]`;
    try {
      const id = checkId(xmlChildText(node, 'ID'), 'GNSS_VECTOR ID', path);
      if (vectorIds.has(id)) throw new Error(`${path}: duplicate GNSS_VECTOR ID '${id}'.`);
      const from = checkId(xmlChildText(node, 'INITIAL_POINT_ID'), 'INITIAL_POINT_ID', path);
      const to = checkId(xmlChildText(node, 'TERMINAL_POINT_ID'), 'TERMINAL_POINT_ID', path);
      const deltas = xmlChild(node, 'ECEF_DELTAS');
      if (!deltas) {
        gvxFail(
          diagnostics,
          'GNSS_GVX_MISSING_VECTOR_COMPONENT',
          `${path}: missing required math block 'ECEF_DELTAS' (only ECEF vector semantics are supported).`,
          node.line,
          { baselineId: id },
        );
        return;
      }
      const matrix = xmlChild(node, 'CORRELATION_MATRIX');
      if (!matrix) {
        gvxFail(
          diagnostics,
          'GNSS_GVX_MISSING_VECTOR_COMPONENT',
          `${path}: missing required math block 'CORRELATION_MATRIX'.`,
          node.line,
          { baselineId: id },
        );
        return;
      }
      const vector: GvxRawVector = {
        id,
        from,
        to,
        dx: readNumber(xmlChildText(deltas, 'DX'), 'DX', `${path}/ECEF_DELTAS`),
        dy: readNumber(xmlChildText(deltas, 'DY'), 'DY', `${path}/ECEF_DELTAS`),
        dz: readNumber(xmlChildText(deltas, 'DZ'), 'DZ', `${path}/ECEF_DELTAS`),
        sdx: readNumber(xmlChildText(matrix, 'SDX'), 'SDX', `${path}/CORRELATION_MATRIX`),
        sdy: readNumber(xmlChildText(matrix, 'SDY'), 'SDY', `${path}/CORRELATION_MATRIX`),
        sdz: readNumber(xmlChildText(matrix, 'SDZ'), 'SDZ', `${path}/CORRELATION_MATRIX`),
        pxy: readNumber(xmlChildText(matrix, 'PXY'), 'PXY', `${path}/CORRELATION_MATRIX`),
        pxz: readNumber(xmlChildText(matrix, 'PXZ'), 'PXZ', `${path}/CORRELATION_MATRIX`),
        pyz: readNumber(xmlChildText(matrix, 'PYZ'), 'PYZ', `${path}/CORRELATION_MATRIX`),
        line: node.line,
      };
      if (!markById.has(from)) {
        gvxFail(
          diagnostics,
          'GNSS_GVX_UNKNOWN_MARK',
          `${path}: INITIAL_POINT_ID '${from}' has no POINT definition.`,
          node.line,
          { baselineId: id, stationId: from },
        );
        return;
      }
      if (!markById.has(to)) {
        gvxFail(
          diagnostics,
          'GNSS_GVX_UNKNOWN_MARK',
          `${path}: TERMINAL_POINT_ID '${to}' has no POINT definition.`,
          node.line,
          { baselineId: id, stationId: to },
        );
        return;
      }
      vectorIds.add(id);
      vectors.push(vector);
      node.children.forEach((child) => {
        if (
          child.name !== 'ID' &&
          child.name !== 'INITIAL_POINT_ID' &&
          child.name !== 'TERMINAL_POINT_ID' &&
          child.name !== 'ECEF_DELTAS' &&
          child.name !== 'CORRELATION_MATRIX'
        ) {
          ignore(child);
        }
      });
    } catch (failure) {
      gvxFail(diagnostics, 'GNSS_GVX_BAD_XML', failure instanceof Error ? failure.message : String(failure), node.line, {
        row: index + 1,
      });
    }
  });

  // Non-consumed top-level metadata is extension surface: ignore + diagnostic.
  root.children.forEach((node) => {
    if (node.name !== 'REFERENCE_SYSTEM' && node.name !== 'POINT' && node.name !== 'GNSS_VECTOR') {
      ignore(node);
    }
  });

  const hasError = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
  if (hasError) return { document: null, source: null, diagnostics };
  if (vectors.length === 0) {
    gvxFail(diagnostics, 'GNSS_GVX_BAD_XML', 'GVX/GVX: no GNSS_VECTOR elements found.');
    return { document: null, source: null, diagnostics };
  }
  if (marks.length === 0) {
    gvxFail(diagnostics, 'GNSS_GVX_BAD_XML', 'GVX/GVX: no POINT elements found.');
    return { document: null, source: null, diagnostics };
  }

  const document: GvxDocument = {
    version,
    vectors,
    marks,
    pointFrame: { id: '', name: '' },
    ignoredElements: [...ignored].sort(),
    sourceFile,
  };
  const source = sourceOf(document, markById, frameById, diagnostics);
  if (!source) return { document: null, source: null, diagnostics };
  return { document, source, diagnostics };
};


const sourceOf = (
  document: GvxDocument,
  markById: Map<string, GvxRawMark>,
  frameById: Map<string, { name: string; linearUnit: string }>,
  diagnostics: GnssDiagnostic[],
): GvxSourceMetadata | null => {
  // Frame resolution is canonicalization, not syntax: mixed or unknown
  // point frames fail here with FRAME_UNSUPPORTED (never a mismatch
  // against the orbit frame, which is provenance only).
  const refIds = [...new Set(document.marks.map((mark) => mark.referenceSystemId))].sort();
  if (refIds.length !== 1) {
    gvxFail(
      diagnostics,
      'GNSS_GVX_FRAME_UNSUPPORTED',
      `GVX/POINT: mixed point reference frames (${refIds.join(', ')}); a single frame is required (no transforms).`,
    );
    return null;
  }
  const refId = refIds[0] ?? '';
  const frame = frameById.get(refId);
  if (!frame) {
    gvxFail(
      diagnostics,
      'GNSS_GVX_FRAME_UNSUPPORTED',
      `GVX/POINT: REFERENCE_SYSTEM_ID '${refId}' has no REFERENCE_SYSTEM definition.`,
    );
    return null;
  }
  if (!/met(er|re)s?/i.test(frame.linearUnit)) {
    gvxFail(
      diagnostics,
      'GNSS_GVX_FRAME_UNSUPPORTED',
      `GVX/REFERENCE_SYSTEM: linear unit '${frame.linearUnit || '(missing)'}' is not metres (only metre intake is supported).`,
    );
    return null;
  }
  const epochs = [...new Set(document.marks.map((mark) => mark.epoch).filter((epoch) => epoch !== undefined))].sort();
  if (epochs.length > 1) {
    gvxFail(
      diagnostics,
      'GNSS_GVX_FRAME_UNSUPPORTED',
      `GVX/POINT: mixed point epochs (${epochs.join(', ')}); a single epoch is required (no transforms).`,
    );
    return null;
  }
  let orbitFrame: GvxOrbitFrame | undefined;
  for (const [id, entry] of [...frameById.entries()].sort()) {
    if (id !== refId && orbitFrame === undefined) orbitFrame = { id, name: entry.name };
  }
  let aprioriMaxMisclosureM = 0;
  document.vectors.forEach((vector) => {
    const from = markById.get(vector.from);
    const to = markById.get(vector.to);
    if (!from || !to) return;
    const misclosure = Math.max(
      Math.abs(to.x - from.x - vector.dx),
      Math.abs(to.y - from.y - vector.dy),
      Math.abs(to.z - from.z - vector.dz),
    );
    if (misclosure > aprioriMaxMisclosureM) aprioriMaxMisclosureM = misclosure;
  });
  return {
    version: document.version,
    pointFrame: { id: refId, name: frame.name, epoch: epochs[0] },
    orbitFrame,
    vectorCount: document.vectors.length,
    markCount: document.marks.length,
    ignoredElements: document.ignoredElements,
    aprioriMaxMisclosureM,
  };
};

