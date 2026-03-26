import type {
  IndustryParityCaseDefinition,
  IndustryParityHeaderNormalizationRule,
} from '../industryParityCases';

const normalizeHeaderLine = (
  line: string,
  rules: IndustryParityHeaderNormalizationRule[],
): string => {
  const trimmed = line.trim();
  if (
    rules.includes('softwareVersion') &&
    trimmed.startsWith('MicroSurvey STAR*NET-PRO Version ')
  ) {
    return 'MicroSurvey STAR*NET-PRO Version <normalized>';
  }
  if (rules.includes('runDate') && trimmed.startsWith('Run Date: ')) {
    return 'Run Date: <normalized>';
  }
  if (rules.includes('projectFolder') && trimmed.startsWith('Project Folder')) {
    return 'Project Folder     <normalized>';
  }
  if (rules.includes('dataFileList') && trimmed.startsWith('Data File List')) {
    return 'Data File List  <normalized>';
  }
  return line.replace(/\r/g, '');
};

export const normalizeIndustryParityText = (
  text: string,
  rules: IndustryParityHeaderNormalizationRule[],
): string =>
  text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => normalizeHeaderLine(line, rules))
    .join('\n')
    .trimEnd();

export const normalizeIndustryParityCaseText = (
  text: string,
  spec: Pick<IndustryParityCaseDefinition, 'normalizationRules'>,
): string => normalizeIndustryParityText(text, spec.normalizationRules);
