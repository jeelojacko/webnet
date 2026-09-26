/**
 * Phase 19A slice B — survey table style manager operations (pure).
 *
 * New / Duplicate / Rename / Delete-when-unused / Set Current. Ids are only
 * minted deterministically (slug + numeric suffix) — never random — so the
 * operations are reproducible and testable headlessly. A style that any
 * `survey-table` entity references cannot be deleted; the last remaining
 * style cannot be deleted either.
 */
import type { CadProject, CadSurveyTableStyle } from './cadTypes';
import {
  createDefaultCadSurveyTableStyle,
  ensureCadSurveyTableStyles,
} from './cadSurveyTables';

export type CadSurveyTableStyleDeleteReason = 'NOT_FOUND' | 'IN_USE' | 'LAST_STYLE';

export type CadSurveyTableStyleDeleteResult =
  | { ok: true; project: CadProject }
  | { ok: false; reason: CadSurveyTableStyleDeleteReason };

const slugify = (name: string): string => {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'style';
};

/** Deterministic unique id for a style name (never random). */
export function buildCadSurveyTableStyleId(
  name: string,
  existing: readonly CadSurveyTableStyle[],
): string {
  const base = `survey-table-style-${slugify(name)}`;
  const taken = new Set(existing.map((style) => style.id));
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function cadSurveyTableStyles(project: CadProject): CadSurveyTableStyle[] {
  return ensureCadSurveyTableStyles(project);
}

/** True when any survey-table entity references the style id. */
export function isCadSurveyTableStyleInUse(project: CadProject, styleId: string): boolean {
  return project.entities.some(
    (entity) => entity.type === 'survey-table' && entity.tableStyleId === styleId,
  );
}

export function createCadSurveyTableStyle(
  project: CadProject,
  options: { name: string; id?: string; seedStyleId?: string },
): CadProject {
  const styles = cadSurveyTableStyles(project);
  const seed =
    (options.seedStyleId != null
      ? styles.find((style) => style.id === options.seedStyleId)
      : undefined) ?? styles[0] ?? createDefaultCadSurveyTableStyle();
  const id = options.id ?? buildCadSurveyTableStyleId(options.name, styles);
  const style: CadSurveyTableStyle = { ...seed, id, name: options.name };
  return { ...project, surveyTableStyles: [...styles, style] };
}

export function duplicateCadSurveyTableStyle(
  project: CadProject,
  sourceStyleId: string,
  options: { name: string; id?: string },
): CadProject {
  const styles = cadSurveyTableStyles(project);
  const source = styles.find((style) => style.id === sourceStyleId);
  if (!source) return project;
  const id = options.id ?? buildCadSurveyTableStyleId(options.name, styles);
  return {
    ...project,
    surveyTableStyles: [...styles, { ...source, id, name: options.name }],
  };
}

export function renameCadSurveyTableStyle(
  project: CadProject,
  styleId: string,
  name: string,
): CadProject {
  const styles = cadSurveyTableStyles(project);
  if (!styles.some((style) => style.id === styleId) || name.trim().length === 0) return project;
  return {
    ...project,
    surveyTableStyles: styles.map((style) =>
      style.id === styleId ? { ...style, name } : style,
    ),
  };
}

export function setCurrentCadSurveyTableStyle(
  project: CadProject,
  styleId: string,
): CadProject {
  const styles = cadSurveyTableStyles(project);
  if (!styles.some((style) => style.id === styleId)) return project;
  return { ...project, surveyTableStyles: styles, currentSurveyTableStyleId: styleId };
}

export function deleteCadSurveyTableStyle(
  project: CadProject,
  styleId: string,
): CadSurveyTableStyleDeleteResult {
  const styles = cadSurveyTableStyles(project);
  if (!styles.some((style) => style.id === styleId)) return { ok: false, reason: 'NOT_FOUND' };
  if (styles.length <= 1) return { ok: false, reason: 'LAST_STYLE' };
  if (isCadSurveyTableStyleInUse(project, styleId)) return { ok: false, reason: 'IN_USE' };
  const next = styles.filter((style) => style.id !== styleId);
  const currentStyleId =
    project.currentSurveyTableStyleId === styleId
      ? next[0]?.id
      : project.currentSurveyTableStyleId;
  return {
    ok: true,
    project: {
      ...project,
      surveyTableStyles: next,
      ...(currentStyleId != null ? { currentSurveyTableStyleId: currentStyleId } : {}),
    },
  };
}
