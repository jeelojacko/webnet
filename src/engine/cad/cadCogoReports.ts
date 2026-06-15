import type { CadCogoComputation } from './cadCogoTypes';

export type CadCogoExportFormat = 'txt' | 'csv' | 'md';

const escapeCadCogoCsv = (value: string): string => {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
};

export const buildCadCogoExportFilename = (
  computation: CadCogoComputation,
  format: CadCogoExportFormat,
): string => {
  const stamp = (computation.createdAtIso ?? 'cogo')
    .replace(/[:]/g, '-')
    .replace(/[.]/g, '_');
  return `${computation.toolKey.toLowerCase()}-${stamp}.${format}`;
};

export const formatCadCogoComputation = (
  computation: CadCogoComputation,
  format: CadCogoExportFormat,
): string => {
  const { report } = computation;
  if (format === 'csv') {
    const lines = [
      ['section', 'label', 'value', 'unit'].map(escapeCadCogoCsv).join(','),
      ['meta', 'title', report.title, ''].map(escapeCadCogoCsv).join(','),
      ['meta', 'summary', report.summary, ''].map(escapeCadCogoCsv).join(','),
      ['meta', 'tool', computation.toolKey, ''].map(escapeCadCogoCsv).join(','),
    ];
    if (computation.createdAtIso) {
      lines.push(['meta', 'created', computation.createdAtIso, ''].map(escapeCadCogoCsv).join(','));
    }
    report.rows.forEach((row) => {
      lines.push(
        ['row', row.label, row.value, row.unit ?? ''].map(escapeCadCogoCsv).join(','),
      );
    });
    computation.warnings.forEach((warning) => {
      lines.push(
        ['warning', `${warning.severity}:${warning.code}`, warning.message, '']
          .map(escapeCadCogoCsv)
          .join(','),
      );
    });
    (computation.alternatives ?? []).forEach((alternative) => {
      lines.push(
        ['alternative', alternative.label, alternative.report?.summary ?? alternative.id, '']
          .map(escapeCadCogoCsv)
          .join(','),
      );
    });
    return lines.join('\n');
  }

  const bullet = format === 'md' ? '- ' : '- ';
  const lines: string[] = [];

  if (format === 'md') {
    lines.push(`# ${report.title}`);
    lines.push('');
    lines.push(report.summary);
    lines.push('');
    lines.push(`Tool: ${computation.toolKey}`);
    if (computation.createdAtIso) lines.push(`Created: ${computation.createdAtIso}`);
    lines.push('');
    lines.push('## Results');
    report.rows.forEach((row) => {
      lines.push(`${bullet}${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ''}`);
    });
    if (computation.warnings.length > 0) {
      lines.push('');
      lines.push('## Warnings');
      computation.warnings.forEach((warning) => {
        lines.push(`${bullet}[${warning.severity}] ${warning.message}`);
      });
    }
    if ((computation.alternatives ?? []).length > 0) {
      lines.push('');
      lines.push('## Alternatives');
      computation.alternatives?.forEach((alternative) => {
        lines.push(`${bullet}${alternative.label}`);
      });
    }
    return lines.join('\n');
  }

  lines.push(report.title);
  lines.push(report.summary);
  lines.push(`Tool: ${computation.toolKey}`);
  if (computation.createdAtIso) lines.push(`Created: ${computation.createdAtIso}`);
  lines.push('');
  report.rows.forEach((row) => {
    lines.push(`${row.label}: ${row.value}${row.unit ? ` ${row.unit}` : ''}`);
  });
  if (computation.warnings.length > 0) {
    lines.push('');
    lines.push('Warnings:');
    computation.warnings.forEach((warning) => {
      lines.push(`${bullet}[${warning.severity}] ${warning.message}`);
    });
  }
  if ((computation.alternatives ?? []).length > 0) {
    lines.push('');
    lines.push('Alternatives:');
    computation.alternatives?.forEach((alternative) => {
      lines.push(`${bullet}${alternative.label}`);
    });
  }
  return lines.join('\n');
};
