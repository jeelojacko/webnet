import type { CadDrawingDocument } from '../engine/cad/cadTypes';

/**
 * Phase 18A — CAD document session model.
 *
 * Structured for future multi-document (a session holds one active drawing
 * plus, later, a tab list) while the UI stays single-document only.
 */
export interface CadDocumentSession {
  drawing: CadDrawingDocument;
  /** True once the drawing differs from its last save/open/new baseline. */
  dirty: boolean;
  /** Last save/open file name, used as the Save target. Null = never saved. */
  saveTargetName: string | null;
}

export type CadDrawingLifecycleEvent = 'cad-saved' | 'cad-opened' | 'cad-created';

export const createCleanSession = (drawing: CadDrawingDocument, saveTargetName: string | null): CadDocumentSession => ({
  drawing,
  dirty: false,
  saveTargetName,
});
