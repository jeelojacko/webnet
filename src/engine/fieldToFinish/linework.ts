/**
 * Deterministic linework generation from coded points in authoritative
 * source order (explicit sequence — never point-id/coordinate/hash order).
 *
 * BEGIN starts a chain, CONTINUE adds a vertex, END terminates, CLOSE closes
 * to the start vertex; BREAK terminates the open chain before the current
 * point. Malformed coding (END w/o BEGIN, CLOSE w/o chain, duplicate BEGIN,
 * unterminated) yields per-chain warn/fail diagnostics with the source
 * record/point — geometry is never invented. Multi-code instances keep
 * separate chains per (code, instance). Implicit continuation applies only
 * when the catalog enables it. No curve fitting.
 */
import { buildCodeIndex, canonicalizeCode, matchCodeToken } from './codeMatching';
import { UNMAPPED_LAYER, type FeatureCodeCatalog } from './featureCatalog';
import { FieldLineworkControl, type ImportedFeatureMetadata } from './featureMetadata';

export interface CodedPointInput {
  pointId: string;
  sourceOrder: number;
  sourceLine?: number;
  feature?: ImportedFeatureMetadata;
}

export interface LineworkVertex {
  pointId: string;
  sourceOrder: number;
  sourceLine?: number;
}

export interface LineworkChain {
  key: string;
  code: string;
  instance?: string;
  definitionId?: string;
  layer: string;
  vertices: LineworkVertex[];
  closed: boolean;
  complete: boolean;
}

export interface LineworkDiagnostic {
  severity: 'warn' | 'fail';
  code: string;
  pointId: string;
  sourceOrder: number;
  sourceLine?: number;
  message: string;
}

export interface LineworkResult {
  chains: LineworkChain[];
  diagnostics: LineworkDiagnostic[];
  unmappedPointIds: string[];
}

const chainKey = (code: string, instance?: string): string =>
  `${canonicalizeCode(code)}|${instance ?? ''}`;

const fail = (
  code: string,
  point: CodedPointInput,
  message: string,
): LineworkDiagnostic => ({
  severity: 'fail',
  code,
  pointId: point.pointId,
  sourceOrder: point.sourceOrder,
  ...(point.sourceLine !== undefined ? { sourceLine: point.sourceLine } : {}),
  message,
});

const warn = (
  code: string,
  point: CodedPointInput,
  message: string,
): LineworkDiagnostic => ({
  severity: 'warn',
  code,
  pointId: point.pointId,
  sourceOrder: point.sourceOrder,
  ...(point.sourceLine !== undefined ? { sourceLine: point.sourceLine } : {}),
  message,
});

const vertexOf = (point: CodedPointInput): LineworkVertex => ({
  pointId: point.pointId,
  sourceOrder: point.sourceOrder,
  ...(point.sourceLine !== undefined ? { sourceLine: point.sourceLine } : {}),
});

export const generateLinework = (
  points: CodedPointInput[],
  catalog: FeatureCodeCatalog,
): LineworkResult => {
  const index = buildCodeIndex(catalog.definitions, catalog.aliases);
  const defsById = new Map(catalog.definitions.map((def) => [def.id, def]));
  const ordered = [...points].sort((a, b) => a.sourceOrder - b.sourceOrder);
  const open = new Map<string, LineworkChain>();
  const finished: LineworkChain[] = [];
  const diagnostics: LineworkDiagnostic[] = [];
  const unmappedPointIds: string[] = [];

  const closeChain = (key: string, complete: boolean): void => {
    const chain = open.get(key);
    if (!chain) return;
    open.delete(key);
    finished.push({ ...chain, vertices: [...chain.vertices], complete });
  };

  for (const point of ordered) {
    const codes = point.feature?.codes ?? [];
    if (codes.length === 0) continue;
    let matchedAny = false;
    for (const entry of codes) {
      const definitionId = matchCodeToken(entry.code, index);
      if (definitionId === undefined) {
        if (!unmappedPointIds.includes(point.pointId)) unmappedPointIds.push(point.pointId);
        continue;
      }
      matchedAny = true;
      const def = defsById.get(definitionId);
      const key = chainKey(entry.code, entry.instance);
      const layer = def?.layer ?? UNMAPPED_LAYER;
      const implicit = def?.lineworkBehavior.implicitContinuation === true;
      const enabled = def?.lineworkBehavior.enabled === true;
      const controls = entry.controls.length > 0 ? entry.controls : [];
      // Bare code token: continue the open chain only under implicit mode.
      if (controls.length === 0) {
        if (!enabled) continue;
        const current = open.get(key);
        if (current) {
          current.vertices.push(vertexOf(point));
        } else if (implicit) {
          open.set(key, {
            key,
            code: entry.code,
            ...(entry.instance !== undefined ? { instance: entry.instance } : {}),
            ...(definitionId !== undefined ? { definitionId } : {}),
            layer,
            vertices: [vertexOf(point)],
            closed: false,
            complete: false,
          });
        }
        continue;
      }
      for (const control of controls) {
        const current = open.get(key);
        switch (control) {
          case FieldLineworkControl.BEGIN:
            if (current) {
              diagnostics.push(warn(entry.code, point, `Duplicate BEGIN for "${entry.code}"; prior chain left unterminated.`));
              closeChain(key, false);
            }
            open.set(key, {
              key,
              code: entry.code,
              ...(entry.instance !== undefined ? { instance: entry.instance } : {}),
              ...(definitionId !== undefined ? { definitionId } : {}),
              layer,
              vertices: [vertexOf(point)],
              closed: false,
              complete: false,
            });
            break;
          case FieldLineworkControl.CONTINUE:
            if (current) {
              current.vertices.push(vertexOf(point));
            } else if (enabled && implicit) {
              open.set(key, {
                key,
                code: entry.code,
                ...(entry.instance !== undefined ? { instance: entry.instance } : {}),
                ...(definitionId !== undefined ? { definitionId } : {}),
                layer,
                vertices: [vertexOf(point)],
                closed: false,
                complete: false,
              });
            } else {
              diagnostics.push(fail(entry.code, point, `CONTINUE without open chain for "${entry.code}".`));
            }
            break;
          case FieldLineworkControl.END:
            if (current) {
              current.vertices.push(vertexOf(point));
              closeChain(key, true);
            } else {
              diagnostics.push(fail(entry.code, point, `END without BEGIN for "${entry.code}".`));
            }
            break;
          case FieldLineworkControl.CLOSE:
            if (current) {
              current.vertices.push(vertexOf(point));
              current.closed = true;
              closeChain(key, true);
            } else {
              diagnostics.push(fail(entry.code, point, `CLOSE without open chain for "${entry.code}".`));
            }
            break;
          case FieldLineworkControl.BREAK:
            if (current) closeChain(key, true);
            else diagnostics.push(warn(entry.code, point, `BREAK without open chain for "${entry.code}".`));
            break;
        }
      }
    }
    void matchedAny;
  }

  for (const chain of open.values()) {
    const last = chain.vertices[chain.vertices.length - 1];
    diagnostics.push({
      severity: 'warn',
      code: chain.code,
      pointId: last?.pointId ?? '',
      sourceOrder: last?.sourceOrder ?? 0,
      ...(last?.sourceLine !== undefined ? { sourceLine: last.sourceLine } : {}),
      message: `Unterminated chain for "${chain.code}".`,
    });
    finished.push({ ...chain, vertices: [...chain.vertices], complete: false });
  }

  finished.sort((a, b) =>
    (a.vertices[0]?.sourceOrder ?? 0) - (b.vertices[0]?.sourceOrder ?? 0) ||
    a.code.localeCompare(b.code) ||
    (a.instance ?? '').localeCompare(b.instance ?? ''),
  );
  return { chains: finished, diagnostics, unmappedPointIds };
};
