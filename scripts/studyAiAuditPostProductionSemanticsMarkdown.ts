/**
 * Markdown renderer for the post-QC semantic audit report.
 * Pure formatting — no rules live here.
 */
import type {
  BroadStandaloneRow,
  LargeSplitRow,
  PostQcSemanticAudit,
  RetryAccounting,
  ZeroGroupSuspect,
} from './studyAiAuditPostProductionSemantics';

const md = (lines: string[]): string => `${lines.join('\n')}\n`;

const section = (title: string): string[] => ['', `## ${title}`, ''];

/** Escape pipes and flatten whitespace so multi-word titles cannot break a row. */
const cell = (value: string): string =>
  value.replace(/\s+/g, ' ').replaceAll('|', '\\|').trim();

const row = (...cells: string[]): string => `| ${cells.map(cell).join(' | ')} |`;

const canonicalState = (audit: PostQcSemanticAudit): string[] =>
  section('Canonical run state').concat([
    row('metric', 'value'),
    '| --- | --- |',
    row('run', `\`${audit.runId}\``),
    row('expected jobs', String(audit.inputs.expectedJobCount)),
    row('accepted results', String(audit.inputs.acceptedResultCount)),
    row(
      'zero-group results (reference-only / skip)',
      String(audit.inputs.zeroGroupResultCount),
    ),
    row(
      'group results (standalone / split / combine)',
      String(audit.inputs.groupResultCount),
    ),
    row('local-failures jobs (current)', String(audit.inputs.localFailuresJobCount)),
    '',
  ]);

const anchorSection = (audit: PostQcSemanticAudit): string[] =>
  section('Pinned anchors (report validation)').concat([
    row('jobId', 'label', 'expected', 'found', 'detail'),
    '| --- | --- | --- | --- | --- |',
    ...audit.pinnedAnchors.map((a) =>
      row(
        `\`${a.jobId}\``,
        a.label,
        a.expectedKind === 'zero-group-suspect'
          ? `suspect / ${a.expectedCategory ?? 'any'}`
          : a.expectedKind,
        a.found ? 'yes' : '**MISSING**',
        a.detail,
      ),
    ),
    '',
    `All anchors found: **${audit.allPinnedAnchorsFound ? 'yes' : 'NO'}**`,
    '',
  ]);

const guardSection = (audit: PostQcSemanticAudit): string[] => {
  const g = audit.guards;
  return section('Zero-group scan guards').concat([
    row('guard', 'excluded'),
    '| --- | --- |',
    row('scanned zero-group total', String(g.scannedZeroGroupTotal)),
    row('static-geographic-boundary-description', String(g.staticGeographicExcluded)),
    row('fully-repealed (unlabelled standalone Repealed marker line)', String(g.fullyRepealedExcluded)),
    row('consequential-amendment (effect belongs to receiving instrument)', String(g.consequentialAmendmentExcluded)),
    '',
  ]);
};

const suspectSummary = (audit: PostQcSemanticAudit): string[] =>
  section(`Zero-group suspects (${audit.suspects.length})`).concat([
    'Priority order per suspect: official-power, then operative-scope, then operative-crossref. `matched` lists every category that fired.',
    '',
    row('jobId', 'document', 'section', 'disposition', 'transitional', 'primary', 'matched'),
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...audit.suspects.map((s) =>
      row(
        `\`${s.jobId}\``,
        `${s.title} (${s.documentId})`,
        s.sectionLabel,
        s.disposition,
        s.transitional ? 'yes' : '',
        s.primaryCategory,
        s.matchedCategories.map((h) => h.category).join(' + '),
      ),
    ),
    '',
  ]);

const formatComparable = (s: ZeroGroupSuspect): string[] => {
  if (s.comparables.length === 0) return ['comparables: none', ''];
  return [
    ...s.comparables.map((c) => {
      const byDisp = Object.entries(c.byDisposition)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      return `- **${c.family}**: ${c.totalAccepted} accepted group results (${byDisp}); e.g. ${c.exampleJobIds.map((j) => `\`${j}\``).join(', ') || 'none'}`;
    }),
    '',
  ];
};

const suspectDetails = (suspects: ZeroGroupSuspect[]): string[] => {
  const out: string[] = [];
  for (const s of suspects) {
    out.push(`### \`${s.jobId}\` — ${cell(s.title)}, s. ${s.sectionLabel}`);
    out.push('');
    out.push(
      `- **disposition:** ${s.disposition} (**${s.confidence}** confidence)${s.transitional ? ' · *transitional* (reviewer triage, not auto-excluded)' : ''}`,
    );
    out.push(`- **primary category:** ${s.primaryCategory} — matched: ${s.matchedCategories.map((h) => `${h.category}[${h.families.join(',')}]${h.phrases.length > 0 ? ` ("${h.phrases.join('"; "')}")` : ''}`).join('; ')}`);
    out.push(`- **operative size:** ${s.operativeCharacters} chars · repeal stub lines masked: ${s.repealedStubLinesMasked}`);
    out.push(`- **model reason:** ${cell(s.reason)}`);
    out.push('');
    out.push(...formatComparable(s));
    out.push('**Review questions:**');
    for (const q of s.reviewQuestions) out.push(`- ${q}`);
    out.push('');
    out.push('**Masked source text:**');
    out.push('');
    out.push('```text');
    out.push(s.maskedSourceText.trimEnd());
    out.push('```');
    out.push('');
  }
  return out;
};

const p1Section = (audit: PostQcSemanticAudit): string[] => {
  const { byBucket, rows, total } = audit.p1;
  return section(`P1 export (${total})`).concat([
    'Documented explicit allowlists; see Methodology for the lists.',
    '',
    row('bucket', 'count'),
    '| --- | --- |',
    row('core-surveying-licensing', String(byBucket['core-surveying-licensing'])),
    row('cadastral-property-registration-planning', String(byBucket['cadastral-property-registration-planning'])),
    row('adjacent-general-law', String(byBucket['adjacent-general-law'])),
    '',
    row('jobId', 'document', 'section', 'bucket', 'disposition', 'conf', 'provenance', 'attempts', 'in 250', 'stratum'),
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((r) =>
      row(
        `\`${r.jobId}\``,
        r.documentId,
        r.sectionLabel,
        r.relevanceBucket,
        r.disposition,
        r.confidence,
        r.provenance,
        String(r.failureAttempts),
        r.inBalancedSet ? (r.balancedOrigin ?? 'yes') : '',
        r.inBalancedSet ? (r.balancedStratum ?? '') : '',
      ),
    ),
    '',
  ]);
};

const broadRow = (r: BroadStandaloneRow): string =>
  row(
    `\`${r.jobId}\``,
    `${r.title} (${r.documentId})`,
    r.sectionLabel,
    String(r.operativeCharacters),
    r.groupTitles.join(' / '),
    r.triggers.join(', '),
    r.warnings.join(', '),
  );

const broadSection = (audit: PostQcSemanticAudit): string[] => {
  const b = audit.broad;
  return section('Broad standalone unit review').concat([
    'A standalone result with any trigger below is a candidate for human "split this?" review.',
    '',
    row('trigger', 'rule'),
    '| --- | --- |',
    ...Object.entries(b.triggerDefinitions).map(([k, v]) => row(k, v)),
    '',
    `Pinned anchor \`${b.pinnedAnchorJobId}\` is **${b.standaloneSuspects.some((s) => s.jobId === b.pinnedAnchorJobId) ? 'in the trigger list' : 'carried as a pinned anchor (below)'}**.`,
    '',
    row('jobId', 'document', 'section', 'operative chars', 'group', 'triggers', 'warnings'),
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...b.standaloneSuspects.map(broadRow),
    '',
  ]);
};

const largeSplitSection = (audit: PostQcSemanticAudit): string[] => {
  const splits: LargeSplitRow[] = audit.broad.largeSplitResults;
  return section(`Large split results (contrast, ${splits.length})`).concat([
    'Split dispositions with large operative text or many groups — contrast for the broad-standalone review (large material *was* split here).',
    '',
    row('jobId', 'document', 'section', 'operative chars', 'groups'),
    '| --- | --- | --- | --- | --- |',
    ...splits.map((s) =>
      row(
        `\`${s.jobId}\``,
        s.documentId,
        s.sectionLabel,
        String(s.operativeCharacters),
        String(s.groupCount),
      ),
    ),
    '',
  ]);
};

const retrySection = (audit: PostQcSemanticAudit): string[] => {
  const r: RetryAccounting | null = audit.retryAccounting;
  if (r === null) {
    return section('Retry accounting').concat(['not available (no balanced set file)', '']);
  }
  return section('Balanced-set retry accounting').concat([
    `Source: \`${r.balancedSetFile}\``,
    '',
    row('metric', 'value'),
    '| --- | --- |',
    row('final set size', String(r.finalSetSize)),
    row('`recovered-retries` stratum quota', String(r.stratumQuota)),
    row('`recovered-retries` pool at build time', String(r.stratumPoolAtBuild)),
    row('`recovered-retries` entries selected', String(r.stratumSelected)),
    row(
      '**total retry-history jobs in final set**',
      `**${r.totalRetryHistoryInFinalSet}** (${r.finalSetRetrySharePct}%)`,
    ),
    row(
      'retry pool as share of full run',
      `${r.stratumPoolAtBuild} / ${r.fullRunJobCount} (${r.retryPoolShareOfFullRunPct}%)`,
    ),
    row('current local-failures jobs (fs, audit time)', String(r.currentLocalFailuresJobCount)),
    row(`retry-run accepted jobs (${r.retryRunId ?? 'n/a'})`, String(r.retryRunAcceptedJobCount)),
    '',
    `> ${r.note}`,
    '',
  ]);
};

const methodology = (): string[] => [
  ...section('Methodology (deterministic rules, no inference)'),
  '',
  '- **Corpus scan target:** accepted zero-group results only (reference-only / skip).',
  '- **Text used for matching:** `exactSourceText` after repeal-stub masking (labeled repeal stubs blanked; an unlabelled standalone `Repealed:` line = full-repeal marker → provision excluded).',
  '- **C1 official-power:** heading is `Regulations`/`Regulation` or text contains a delegated-power phrase (may make regulations; Lieutenant-Governor in Council may; Minister may; Board may; Council may; may prescribe; may order; may approve; may authorize) **and** the model reason mentions regulation/delegation/power/authority.',
  '- **C2 operative-scope families:** act-scope-exclusion (does/do/shall/will not apply|extend, not extend or apply, extends or applies to, not applicable, inapplicable); this-act-applies; section-applies (section/subsection N applies / does not apply / shall apply, incl. "and" joins); applies-with-modifications.',
  '- **C3 operative-crossref:** operative text ≤ 1200 chars, contains a section/subsection/paragraph/schedule reference within 150 chars of a strict legal-effect verb (deemed; continues to apply/have effect/be in force; ceases to…; validates; supersedes; prevails; exempt; binding on / shall bind).',
  '- **Guards (deterministic):** staticGeographicBoundaryDescription, full-repeal marker, consequentialAmendment → excluded; transitional → kept and flagged.',
  '- **Comparables:** accepted results with ≥1 proposed group whose masked text matches the same family; up to 5 example jobIds (jobId order) plus totals and disposition mix.',
  '- **P1 buckets:** core-surveying-licensing = builder CORE_SURVEYING_DOCS; cadastral-property-registration-planning = explicit allowlist (community-planning act+regulation, condominium-property, marital-property, easements, expropriation, real-property-transfer-tax, standard-forms-of-conveyances, crown-grant-restrictions); everything else = adjacent-general-law.',
  '- **Provenance:** promoted = accepted in the production-retry9 sibling run; recovered = has a local-failures directory; else original.',
  '- **Determinism:** all lists sorted by documentId/jobId; no wall clock, no randomness. Re-running on unchanged inputs reproduces byte-identical reports.',
  '',
];

export const renderPostQcSemanticAuditMd = (audit: PostQcSemanticAudit): string =>
  md(
    [`# Post-QC semantic audit — ${audit.runId}`, ''].concat([
      `Date tag: \`${audit.dateTag}\` · kind: \`${audit.kind}\` · schema v${audit.schemaVersion}`,
      '',
    ])
      .concat(canonicalState(audit))
      .concat(anchorSection(audit))
      .concat(guardSection(audit))
      .concat(suspectSummary(audit))
      .concat(suspectDetails(audit.suspects))
      .concat(p1Section(audit))
      .concat(broadSection(audit))
      .concat(largeSplitSection(audit))
      .concat(retrySection(audit))
      .concat(methodology()),
  );
