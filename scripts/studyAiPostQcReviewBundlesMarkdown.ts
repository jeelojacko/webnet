/**
 * Markdown rendering for the deterministic post-QC review bundles.
 * Pure formatting — no rules, no lookups. See
 * studyAiPostQcReviewBundles.ts for the data contract.
 */
import type {
  AdjacentP1BundleRow,
  BroadGroupBundleRow,
  PostQcAdjacentP1Bundle,
  PostQcBroadGroupBundle,
} from './studyAiPostQcReviewBundles';

const esc = (text: string): string => text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

const flagsText = (flags: Record<string, boolean>): string => {
  const on = Object.entries(flags)
    .filter(([, v]) => v)
    .map(([k]) => k);
  return on.length > 0 ? on.join(', ') : '(none)';
};

const focusBlock = (row: {
  groupTitles: string[];
  focusSelections: AdjacentP1BundleRow['focusSelections'];
}): string[] => {
  const lines: string[] = [];
  for (const sel of row.focusSelections) {
    const children = sel.childLabels.length > 0 ? sel.childLabels.join(', ') : '(no child labels)';
    const terms = sel.definedTerms.length > 0 ? sel.definedTerms.join(', ') : '(none)';
    lines.push(
      `  - **${esc(sel.groupTitle)}** — source \`${sel.sourceKey}\` · children: ${esc(children)} · defined terms: ${esc(terms)}`,
    );
    for (const ev of sel.evidenceText) {
      lines.push(`    - evidence: "${esc(ev)}"`);
    }
  }
  return lines;
};

const adjacentRowSection = (row: AdjacentP1BundleRow): string[] => {
  const lines: string[] = [];
  lines.push(
    `### s. ${esc(row.sectionLabel)} — \`${row.jobId}\` — ${row.disposition} / ${row.confidence}`,
    '',
  );
  if (row.heading !== null) lines.push(`> ${esc(row.heading)}`);
  lines.push(
    `- **provenance** ${row.provenance} · **failure attempts** ${row.failureAttempts} · ` +
      `**balanced set** ${row.inBalancedSet ? `yes (${row.balancedStratum ?? '?'})` : 'no'}`,
    `- **source status** ${row.sourceStatus} · **content flags** ${flagsText(row.contentFlags)} · ` +
      `**operative chars** ${row.operativeCharacters}`,
    `- **reason** ${esc(row.reason)}`,
  );
  lines.push(
    `- **groups** (${row.groupCount}) ${row.groupTitles.map(esc).join(' / ') || '(none)'}`,
  );
  lines.push(`- **learning goals** ${row.learningGoals.map(esc).join(' · ') || '(none)'}`);
  if (row.warnings.length > 0) lines.push(`- **warnings** ${row.warnings.map(esc).join('; ')}`);
  lines.push('- **focus selections**');
  lines.push(...(row.focusSelections.length > 0 ? focusBlock(row) : ['  - (none)']));
  lines.push('', '```text', row.exactSourceText, '```', '');
  return lines;
};

export const renderAdjacentP1BundleMd = (bundle: PostQcAdjacentP1Bundle): string => {
  const lines: string[] = [];
  lines.push(`# Post-QC adjacent P1 review — ${bundle.runId}`, '');
  lines.push(
    `- kind \`${bundle.kind}\` · date tag \`${bundle.dateTag}\` · source audit \`${bundle.sourceAudit}\``,
    `- JSON SHA-256 \`${bundle.summary.jsonSha256}\``,
    `- rows **${bundle.summary.totalRows}** · documents **${bundle.summary.documentCount}** · ` +
      `operative characters **${bundle.summary.totalOperativeCharacters}**`,
    '- ordering: document title → documentId → section label → jobId (deterministic)',
    '- review material only — no canonical results are modified by this bundle.',
    '',
  );
  const byDoc = new Map<string, AdjacentP1BundleRow[]>();
  for (const row of bundle.rows) {
    const list = byDoc.get(row.documentTitle) ?? [];
    list.push(row);
    byDoc.set(row.documentTitle, list);
  }
  let index = 0;
  for (const [title, rows] of byDoc) {
    const docId = rows[0] !== undefined ? rows[0].documentId : '';
    lines.push(`## ${title} (\`${docId}\`)`, '');
    for (const row of rows) {
      index += 1;
      lines.push(`${index}. `, ...adjacentRowSection(row));
    }
  }
  return `${lines.join('\n')}\n`;
};

const broadRowSection = (row: BroadGroupBundleRow): string[] => {
  const lines: string[] = [];
  lines.push(
    `### s. ${esc(row.sectionLabel)} — \`${row.jobId}\` — ${row.disposition} / ${row.confidence}`,
    '',
  );
  if (row.heading !== null) lines.push(`> ${esc(row.heading)}`);
  lines.push(
    `- **provenance** ${row.provenance} · **failure attempts** ${row.failureAttempts} · ` +
      `**balanced set** ${row.inBalancedSet ? `yes (${row.balancedStratum ?? '?'})` : 'no'}`,
    `- **groups** (${row.groupCount}) ${row.groupTitles.map(esc).join(' / ') || '(none)'}`,
    `- **learning goal** ${esc(row.learningGoal)}`,
    `- **triggers** (${row.triggers.length}) ${row.triggers.map(esc).join(', ') || '(none)'}`,
    `- **shape** operative chars ${row.operativeCharacters} · child labels ${row.childLabelCount} · ` +
      `paragraph-label lines ${row.paragraphLabelLineCount} · evidence entries ${row.evidenceTextEntries}`,
    `- **high risk** ${row.highRisk ? row.highRiskReasons.map(esc).join(' · ') : 'no'}`,
  );
  if (row.comparableSplits.length > 0) {
    const splits = row.comparableSplits
      .map(
        (s) =>
          `\`${s.jobId}\` s.${esc(s.sectionLabel)} (g${s.groupCount}, ${s.operativeCharacters}ch)`,
      )
      .join(', ');
    lines.push(`- **comparable splits in same document** ${splits}`);
  }
  if (row.warnings.length > 0) lines.push(`- **warnings** ${row.warnings.map(esc).join('; ')}`);
  lines.push('- **focus selections**');
  lines.push(...(row.focusSelections.length > 0 ? focusBlock(row) : ['  - (none)']));
  lines.push('', '```text', row.exactSourceText, '```', '');
  return lines;
};

export const renderBroadGroupBundleMd = (bundle: PostQcBroadGroupBundle): string => {
  const lines: string[] = [];
  lines.push(`# Post-QC broad-group review — ${bundle.runId}`, '');
  lines.push(
    `- kind \`${bundle.kind}\` · date tag \`${bundle.dateTag}\` · source audit \`${bundle.sourceAudit}\``,
    `- JSON SHA-256 \`${bundle.summary.jsonSha256}\``,
    `- rows **${bundle.summary.totalRows}** · documents **${bundle.summary.documentCount}** · ` +
      `**high-risk** **${bundle.summary.highRiskCount}** · ` +
      `operative characters **${bundle.summary.totalOperativeCharacters}**`,
    '- high-risk subset = pinned likely-split cases ∪ deterministic rule (≥3 broad triggers ' +
      'or ≥6000 operative chars) — a review priority signal, not an automatic action.',
    '- review material only — no canonical results are modified by this bundle.',
    '',
    '## High-risk subset',
    '',
    '| job | document | section | triggers | operative chars | reasons |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const row of bundle.rows.filter((r) => r.highRisk)) {
    lines.push(
      `| \`${row.jobId}\` | ${esc(row.documentTitle)} s.${esc(row.sectionLabel)} | ${row.triggers.length} | ` +
        `${row.operativeCharacters} | ${row.highRiskReasons.map(esc).join(' · ')} |`,
    );
  }
  lines.push('', '## All standalone suspects (jobId order)', '');
  bundle.rows.forEach((row, i) => {
    lines.push(`${i + 1}.`, ...broadRowSection(row));
  });
  return `${lines.join('\n')}\n`;
};
