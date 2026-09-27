// Phase 19D network sessions — typed-submit for PARCELDESIGNATE,
// PARCELNUMBER, PARCELLINK, PARCELUNLINK, PARCELCHECK, PARCELSCHEDULE and
// PARCELSHAREDEDIT. Parcels/links are captured from the selection at starter
// time; every commit goes through the registered engine command (one undo
// entry each). Sessions are input-only: no viewport picks, Esc cancels.

import { runCadCommand } from '../../engine/cad/cadUndoRedo';
import { matchParcelCourses } from '../../engine/cad/cadParcelNetwork';
import {
  readCadParcelSharedBoundaries,
  validateSharedBoundary,
} from '../../engine/cad/cadParcelSharedBoundary';
import type {
  CadParcelEntity,
  CadParcelPlanRole,
  CadProject,
} from '../../engine/cad/cadTypes';
import { parseAbsolutePoint } from './useSurveyCadCommandParsing';
import type { ApplyHistoryUpdate, ReplaceSession } from './useSurveyCadTypedSubmit.types';
import type { CommandSession } from './useSurveyCadCommandTypes';

interface ParcelNetworkSubmitOptions {
  applyHistoryUpdate: ApplyHistoryUpdate;
  replaceSession: ReplaceSession;
  session: CommandSession;
  project: CadProject;
  selectedParcelEntityIds: string[];
}

const PLAN_ROLES: readonly CadParcelPlanRole[] = [
  'lot',
  'remainder',
  'road',
  'right-of-way',
  'easement',
  'other',
];

const parcelsById = (project: CadProject): Map<string, CadParcelEntity> =>
  new Map(
    project.entities
      .filter((entity): entity is CadParcelEntity => entity.type === 'parcel')
      .map((entity) => [entity.id, entity] as const),
  );

/** Commit one engine command; true when history moved (else show `failure`). */
const commitOne = (
  applyHistoryUpdate: ApplyHistoryUpdate,
  replaceSession: ReplaceSession,
  session: CommandSession,
  command: Parameters<typeof runCadCommand>[1],
  failure: string,
): boolean => {
  let committed = false;
  applyHistoryUpdate((existing) => {
    const next = runCadCommand(existing, command);
    committed = next !== existing;
    return next;
  });
  replaceSession(committed ? null : { ...session, inputValue: '', resultText: failure });
  return true;
};

const parseRole = (token: string | undefined): CadParcelPlanRole | null => {
  if (token == null || token.trim() === '') return null;
  const normalized = token.trim().toLowerCase().replace(/[\s_]+/g, '-') as CadParcelPlanRole;
  return PLAN_ROLES.includes(normalized) ? normalized : null;
};

const handleDesignateOrNumber = (options: ParcelNetworkSubmitOptions): boolean => {
  const { applyHistoryUpdate, replaceSession, session, project } = options;
  if (session.key !== 'PARCELDESIGNATE' && session.key !== 'PARCELNUMBER') return false;
  const known = parcelsById(project);
  const ids = session.parcelEntityIds.filter((id) => known.has(id));
  if (ids.length === 0) {
    replaceSession({ ...session, inputValue: '', resultText: `${session.key}: no selected parcels (select parcels first).` });
    return true;
  }
  if (session.key === 'PARCELDESIGNATE') {
    const [designation = '', roleToken = '', ...rest] = session.inputValue.split(';');
    const role = parseRole(roleToken || undefined);
    if (roleToken.trim() !== '' && !role) {
      replaceSession({ ...session, resultText: `PARCELDESIGNATE role invalid. Use one of: ${PLAN_ROLES.join(', ')}.` });
      return true;
    }
    const trimmed = designation.trim();
    if (!trimmed) {
      replaceSession({ ...session, resultText: 'PARCELDESIGNATE input: `designation[; role][; description]` (role is Plan Role display metadata).' });
      return true;
    }
    return commitOne(
      applyHistoryUpdate,
      replaceSession,
      session,
      {
        key: 'PARCELDESIGNATE',
        parcelEntityIds: ids,
        designation: trimmed,
        ...(role ? { role } : {}),
        ...(rest.length > 0 ? { description: rest.join(';').trim() } : {}),
      },
      'PARCELDESIGNATE rejected (duplicate lot designation blocked).',
    );
  }
  const [prefix = '', startToken = '', padToken = ''] = session.inputValue.split(',').map((part) => part.trim());
  const start = startToken === '' ? 1 : Number(startToken);
  const pad = padToken === '' ? 0 : Number(padToken);
  if (!Number.isInteger(start) || start < 0 || !Number.isInteger(pad) || pad < 0) {
    replaceSession({ ...session, resultText: 'PARCELNUMBER input: `[prefix][, start][, pad]` (empty = Lot 1, 2, …).' });
    return true;
  }
  return commitOne(
    applyHistoryUpdate,
    replaceSession,
    session,
    {
      key: 'PARCELNUMBER',
      parcelEntityIds: ids,
      numbering: { ...(prefix ? { prefix } : {}), start, ...(pad > 0 ? { pad } : {}) },
    },
    'PARCELNUMBER rejected (duplicate lot designation blocked).',
  );
};

const handleLink = (options: ParcelNetworkSubmitOptions): boolean => {
  const { applyHistoryUpdate, replaceSession, session, project } = options;
  if (session.key !== 'PARCELLINK') return false;
  const known = parcelsById(project);
  const parcels = session.parcelEntityIds
    .map((id) => known.get(id))
    .filter((parcel): parcel is CadParcelEntity => parcel != null);
  if (parcels.length < 2) {
    replaceSession({ ...session, inputValue: '', resultText: 'PARCELLINK: select 2+ parcels, then press Enter to link coincident courses.' });
    return true;
  }
  let linked = 0;
  applyHistoryUpdate((existing) => {
    let state = existing;
    const live = parcelsById(state.present.project);
    const ordered = parcels.map((parcel) => live.get(parcel.id)).filter((parcel): parcel is CadParcelEntity => parcel != null);
    for (let a = 0; a < ordered.length; a += 1) {
      for (let b = a + 1; b < ordered.length; b += 1) {
        for (const match of matchParcelCourses(ordered[a]!, ordered[b]!)) {
          const first = { parcelId: ordered[a]!.id, courseId: match.firstCourseId };
          const second = { parcelId: ordered[b]!.id, courseId: match.secondCourseId };
          if (!validateSharedBoundary(state.present.project, first, second).ok) continue;
          const next = runCadCommand(state, { key: 'PARCELLINK', first, second });
          if (next !== state) {
            state = next;
            linked += 1;
          }
        }
      }
    }
    return state;
  });
  replaceSession(
    linked > 0
      ? null
      : { ...session, inputValue: '', resultText: 'PARCELLINK: no coincident unlinked courses between the selected parcels.' },
  );
  return true;
};

const linksFor = (project: CadProject, ids: readonly string[]) => {
  const selected = new Set(ids);
  return readCadParcelSharedBoundaries(project)
    .filter((link) => selected.has(link.first.parcelId) || selected.has(link.second.parcelId))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
};

const handleUnlink = (options: ParcelNetworkSubmitOptions): boolean => {
  const { applyHistoryUpdate, replaceSession, session, project } = options;
  if (session.key !== 'PARCELUNLINK') return false;
  const links = linksFor(project, session.parcelEntityIds);
  if (links.length === 0) {
    replaceSession({ ...session, inputValue: '', resultText: 'PARCELUNLINK: no shared-boundary links on the selected parcels.' });
    return true;
  }
  const token = session.inputValue.trim().toLowerCase();
  if (token !== 'all' && token !== '') {
    const index = Number(token);
    const target = Number.isInteger(index) && index >= 1 && index <= links.length ? links[index - 1]! : null;
    if (!target) {
      replaceSession({ ...session, resultText: `PARCELUNLINK: enter 1–${links.length} or ALL. ${links.map((link, i) => `${i + 1}=${link.id}`).join(' ')}` });
      return true;
    }
    return commitOne(
      applyHistoryUpdate,
      replaceSession,
      session,
      { key: 'PARCELUNLINK', boundaryId: target.id },
      `PARCELUNLINK rejected for ${target.id}.`,
    );
  }
  if (token === '') {
    replaceSession({
      ...session,
      resultText: `PARCELUNLINK ${links.length} link(s): enter 1–${links.length} or ALL. ${links.map((link, i) => `${i + 1}=${link.id}`).join(' ')}`,
    });
    return true;
  }
  let removed = 0;
  applyHistoryUpdate((existing) => {
    let state = existing;
    for (const link of linksFor(state.present.project, session.parcelEntityIds)) {
      const next = runCadCommand(state, { key: 'PARCELUNLINK', boundaryId: link.id });
      if (next !== state) {
        state = next;
        removed += 1;
      }
    }
    return state;
  });
  replaceSession(
    removed > 0
      ? null
      : { ...session, inputValue: '', resultText: 'PARCELUNLINK: nothing removed.' },
  );
  return true;
};

const handleCheckOrSchedule = (options: ParcelNetworkSubmitOptions): boolean => {
  const { applyHistoryUpdate, replaceSession, session } = options;
  if (session.key !== 'PARCELCHECK' && session.key !== 'PARCELSCHEDULE') return false;
  const ids = session.parcelEntityIds.length > 0 ? session.parcelEntityIds : undefined;
  return commitOne(
    applyHistoryUpdate,
    replaceSession,
    session,
    session.key === 'PARCELCHECK'
      ? { key: 'PARCELCHECK', ...(ids ? { parcelEntityIds: ids } : {}) }
      : { key: 'PARCELSCHEDULE', ...(ids ? { parcelEntityIds: ids } : {}) },
    `${session.key}: no parcels in scope.`,
  );
};

const handleSharedEdit = (options: ParcelNetworkSubmitOptions): boolean => {
  const { applyHistoryUpdate, replaceSession, session, project, selectedParcelEntityIds } = options;
  if (session.key !== 'PARCELSHAREDEDIT') return false;
  const stored = readCadParcelSharedBoundaries(project).sort((a, b) => (a.id < b.id ? -1 : 1));
  const link = session.linkId != null
    ? stored.find((candidate) => candidate.id === session.linkId) ?? null
    : linksFor(project, selectedParcelEntityIds)[0] ?? stored[0] ?? null;
  if (!link) {
    replaceSession({ ...session, inputValue: '', resultText: 'PARCELSHAREDEDIT: no shared-boundary link found (select a linked parcel or use the Toolspace per-link button).' });
    return true;
  }
  const token = session.inputValue.trim();
  if (token === '') {
    replaceSession({ ...session, resultText: `PARCELSHAREDEDIT ${link.id}: \`from x,y\` / \`to x,y\` moves the shared endpoint; \`line\` straightens; \`bulge <n>\` sets the shared arc.` });
    return true;
  }
  const endpoint = /^(from|to)\s+(.+)$/i.exec(token);
  if (endpoint) {
    const point = parseAbsolutePoint(endpoint[2]!.trim());
    if (!point) {
      replaceSession({ ...session, resultText: 'PARCELSHAREDEDIT endpoint invalid. Use `from x,y` or `to x,y`.' });
      return true;
    }
    return commitOne(
      applyHistoryUpdate,
      replaceSession,
      session,
      { key: 'PARCELSHAREDEDIT', linkId: link.id, edit: { kind: 'move-endpoint', end: endpoint[1]!.toLowerCase() as 'from' | 'to', x: point.x, y: point.y } },
      `PARCELSHAREDEDIT rejected for ${link.id} (both parcels must still close).`,
    );
  }
  if (/^line$/i.test(token)) {
    return commitOne(
      applyHistoryUpdate,
      replaceSession,
      session,
      { key: 'PARCELSHAREDEDIT', linkId: link.id, edit: { kind: 'course-geometry', geometry: { kind: 'line' } } },
      `PARCELSHAREDEDIT rejected for ${link.id}.`,
    );
  }
  const bulge = /^bulge\s+(-?\d+(?:\.\d+)?)$/i.exec(token);
  if (bulge) {
    return commitOne(
      applyHistoryUpdate,
      replaceSession,
      session,
      { key: 'PARCELSHAREDEDIT', linkId: link.id, edit: { kind: 'course-geometry', geometry: { kind: 'arc', bulge: Number(bulge[1]) } } },
      `PARCELSHAREDEDIT rejected for ${link.id} (arc must stay consistent on both sides).`,
    );
  }
  replaceSession({ ...session, resultText: `PARCELSHAREDEDIT ${link.id}: use \`from x,y\`, \`to x,y\`, \`line\`, or \`bulge <n>\`.` });
  return true;
};

export const handleSurveyCadParcelNetworkSubmit = (options: ParcelNetworkSubmitOptions): boolean => {
  if (handleDesignateOrNumber(options)) return true;
  if (handleLink(options)) return true;
  if (handleUnlink(options)) return true;
  if (handleCheckOrSchedule(options)) return true;
  if (handleSharedEdit(options)) return true;
  return false;
};
