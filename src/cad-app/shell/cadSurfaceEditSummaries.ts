import type { CadSurface, CadSurfaceEdit } from '../../engine/cad/cadTypes';

/*
 * Phase 18S/18T edit-stack summaries (Toolspace/manager/Properties rows).
 * Order is the authoritative definition order (never sorted); status is a
 * display derivation, never persisted. Target labels are readable
 * (native P station id, imported V<i>, edit-created E<n> — display only,
 * the stable ref stays the authority).
 */

/**
 * Phase 18S — one TIN edit-stack row for the Toolspace/manager/properties.
 * Status is a display derivation (build state + reference liveness); it is
 * never persisted and never a stored field on the edit model.
 */
export type CadSurfaceEditDisplayStatus =
  | 'applied'
  | 'disabled'
  | 'broken-reference'
  | 'not-applicable'
  | 'blocked-constraint';

export interface CadSurfaceEditSummary {
  id: string;
  kind: CadSurfaceEdit['kind'];
  typeLabel: string;
  enabled: boolean;
  /** Readable vertex/edge refs, e.g. "P104 – P117" or "V42 – V57". */
  refsLabel: string;
  /** Phase 18T — dense Target column (vertex label or XY). */
  targetLabel: string;
  /** Phase 18T — dense Value column (Z, ΔZ, or target XY), null when none. */
  valueLabel: string | null;
  /** Full row text, e.g. "Swap Edge P104 – P117". */
  description: string;
  status: CadSurfaceEditDisplayStatus;
  reason: string | null;
}

export const cadSurfaceEditStatusText = (status: CadSurfaceEditDisplayStatus): string => {
  if (status === 'blocked-constraint') return 'blocked (constraint)';
  if (status === 'not-applicable') return 'not applied';
  return status;
};

const EDIT_TYPE_LABEL: Record<CadSurfaceEdit['kind'], string> = {
  'swap-edge': 'Swap Edge',
  'add-line': 'Add Line',
  'delete-line': 'Delete Line',
  'add-point': 'Add Point',
  'delete-point': 'Delete Point',
  'move-point': 'Move Point',
  'set-elevation': 'Set Elevation',
  'raise-lower-surface': 'Raise/Lower',
};

export const shortPointLabel = (stationId: string): string =>
  /^[A-Za-z]/.test(stationId) ? stationId : `P${stationId}`;

const editRefKeys = (edit: CadSurfaceEdit): [string | null, string | null] => {
  if (edit.kind === 'add-line') return [edit.from.key, edit.to.key];
  if (edit.kind === 'swap-edge' || edit.kind === 'delete-line') return [edit.edge.a.key, edit.edge.b.key];
  if (edit.kind === 'delete-point' || edit.kind === 'move-point' || edit.kind === 'set-elevation') {
    return [edit.vertex.key, null];
  }
  return [null, null];
};

/** Map a stable ref key to a readable label; never emit the raw key/UUID. */
const resolveEditRef = (
  key: string,
  pointLabels: ReadonlyMap<string, string>,
  importedVertexCount: number | null,
  editNumbers: ReadonlyMap<string, number>,
): { label: string; broken: boolean } => {
  if (key.startsWith('source:')) {
    const label = pointLabels.get(key.slice('source:'.length));
    return label != null ? { label, broken: false } : { label: 'unresolved', broken: true };
  }
  if (key.startsWith('imported:')) {
    const parts = key.split(':');
    const index = Number(parts[parts.length - 1]);
    if (!Number.isInteger(index) || index < 0 || (importedVertexCount != null && index >= importedVertexCount)) {
      return { label: 'unresolved', broken: true };
    }
    return { label: `V${index}`, broken: false };
  }
  if (key.startsWith('edit:')) {
    // Display-only E-number (definition order among add-point edits); the
    // stable `edit:` key stays the authority.
    const id = key.split(':').pop() ?? '';
    const at = editNumbers.get(id);
    return at != null ? { label: `E${at}`, broken: false } : { label: 'unresolved', broken: true };
  }
  return { label: 'unresolved', broken: true };
};

/**
 * Phase 18S — derive the readable edit rows for one surface. Order is the
 * authoritative definition order (never sorted). `meshPresent` means a
 * retained mesh exists (fresh or stale), so the last replay applied.
 */
export const deriveCadSurfaceEditSummaries = (
  surface: CadSurface,
  pointLabels: ReadonlyMap<string, string>,
  meshPresent: boolean,
): CadSurfaceEditSummary[] => {
  const edits = surface.definition.edits ?? [];
  const importedVertexCount =
    surface.definition.sourceKind === 'imported-tin' && surface.definition.importedTin
      ? surface.definition.importedTin.vertices.length / 3
      : null;
  // Display-only E-numbers for edit-created vertices (definition order
  // among add-point edits; the stable `edit:` key stays authoritative).
  const numbers = new Map<string, number>();
  let addCount = 0;
  for (const edit of edits) {
    if (edit.kind === 'add-point') {
      addCount += 1;
      numbers.set(edit.id, addCount);
    }
  }
  const ref = (key: string | null): { label: string; broken: boolean } =>
    key == null ? { label: '—', broken: false } : resolveEditRef(key, pointLabels, importedVertexCount, numbers);
  const num = (value: number): string => value.toFixed(3);
  return edits.map((edit) => {
    const [keyA, keyB] = editRefKeys(edit);
    const a = ref(keyA);
    const b = ref(keyB);
    const broken = a.broken || b.broken;
    const status: CadSurfaceEditDisplayStatus =
      edit.enabled === false
        ? 'disabled'
        : broken
          ? 'broken-reference'
          : meshPresent
            ? 'applied'
            : 'not-applicable';
    const typeLabel = EDIT_TYPE_LABEL[edit.kind];
    // Dense Target/Value columns per kind; edge edits keep the A – B pair.
    let targetLabel = `${a.label} – ${b.label}`;
    let valueLabel: string | null = null;
    let description = `${typeLabel} ${a.label} – ${b.label}`;
    if (edit.kind === 'add-point') {
      targetLabel = `(${num(edit.x)}, ${num(edit.y)})`;
      valueLabel = num(edit.z);
      description = `${typeLabel} (${num(edit.x)}, ${num(edit.y)}) @ ${num(edit.z)}`;
    } else if (edit.kind === 'delete-point' || edit.kind === 'set-elevation') {
      targetLabel = a.label;
      valueLabel = edit.kind === 'set-elevation' ? num(edit.z) : null;
      description = edit.kind === 'set-elevation'
        ? `${typeLabel} ${a.label} → ${num(edit.z)}`
        : `${typeLabel} ${a.label}`;
    } else if (edit.kind === 'move-point') {
      targetLabel = a.label;
      valueLabel = `(${num(edit.x)}, ${num(edit.y)})`;
      description = `${typeLabel} ${a.label} → (${num(edit.x)}, ${num(edit.y)})`;
    } else if (edit.kind === 'raise-lower-surface') {
      targetLabel = 'all vertices';
      valueLabel = `${edit.deltaZ >= 0 ? '+' : ''}${num(edit.deltaZ)}`;
      description = `${typeLabel} ${valueLabel}`;
    }
    return {
      id: edit.id,
      kind: edit.kind,
      typeLabel,
      enabled: edit.enabled !== false,
      refsLabel: `${a.label} – ${b.label}`,
      targetLabel,
      valueLabel,
      description,
      status,
      reason: broken ? 'SURFACE_EDIT_VERTEX_MISSING' : null,
    };
  });
};
