import { centerIndustryLine } from './industryListingFormatters';
import type { IndustryListingRunDiagnostics } from './industryListingTypes';

type AppendIndustryListingTopFileSummaryArgs = {
  lines: string[];
  now: Date;
  runDiagnostics: IndustryListingRunDiagnostics;
  projectName?: string;
  projectFolder?: string;
  projectSourceFiles: string[];
  pathTokenLeaf: (_pathToken: string) => string;
  usesClassicParityLayout: boolean;
  usesCompactGnssParityLayout: boolean;
};

export const appendIndustryListingTopFileSummary = ({
  lines,
  now,
  runDiagnostics,
  projectName,
  projectFolder,
  projectSourceFiles,
  pathTokenLeaf,
  usesClassicParityLayout,
  usesCompactGnssParityLayout,
}: AppendIndustryListingTopFileSummaryArgs): void => {
  if (usesClassicParityLayout || usesCompactGnssParityLayout) {
    lines.push(centerIndustryLine(`Run Date: ${now.toLocaleString()}`));
  } else {
    lines.push('INDUSTRY-STANDARD-STYLE Listing (WebNet Emulation)');
    lines.push(`Run Date: ${now.toLocaleString()}`);
  }
  lines.push('');
  lines.push(
    runDiagnostics.solveProfile !== 'webnet'
      ? centerIndustryLine('Summary of Files Used and Option Settings')
      : 'Summary of Files Used and Option Settings',
  );
  lines.push(
    runDiagnostics.solveProfile !== 'webnet'
      ? centerIndustryLine('=========================================')
      : '=========================================',
  );
  lines.push('');
  if (runDiagnostics.solveProfile !== 'webnet') {
    lines.push(centerIndustryLine('Project Folder and Data Files'));
    lines.push('');
    if (projectName) lines.push(`      ${'Project Name'.padEnd(18)} ${projectName}`);
    if (projectFolder) lines.push(`      ${'Project Folder'.padEnd(18)} ${projectFolder}`);
    projectSourceFiles.forEach((sourceFile, index) => {
      lines.push(
        `      ${(index === 0 ? 'Data File List' : '').padEnd(18)} ${index + 1}. ${pathTokenLeaf(sourceFile)}`,
      );
    });
    if (projectName || projectFolder || projectSourceFiles.length > 0) lines.push('');
  }
  lines.push(
    runDiagnostics.solveProfile !== 'webnet'
      ? centerIndustryLine('Project Option Settings')
      : 'Project Option Settings',
  );
  lines.push('');
};
