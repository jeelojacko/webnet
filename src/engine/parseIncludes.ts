import type { ProjectRunFile } from './projectWorkspace';
import type { ParseIncludeError, ParseOptions } from '../types';

export type ParseInputLineEntry =
  | {
      kind: 'line';
      raw: string;
      sourceLine: number;
      sourceFile: string;
    }
  | {
      kind: 'include-enter' | 'include-exit';
      sourceLine: number;
      sourceFile: string;
      includeSourceFile: string;
    }
  | {
      kind: 'project-file-enter';
      sourceLine: number;
      sourceFile: string;
      projectFileIndex: number;
      projectFileCount: number;
    };

interface ExpandDirectiveHelpers {
  splitInlineCommentAndDescription: (_line: string) => { line: string; description?: string };
  splitWhitespaceTokens: (_line: string) => string[];
  normalizeInlineDirective: (_token: string) => { op?: string };
}

const normalizePathToken = (value: string): string => value.replace(/\\/g, '/');

const collapsePathToken = (value: string): string => {
  const normalized = normalizePathToken(value).trim();
  if (!normalized) return '';
  const absolute = normalized.startsWith('/');
  const segments = normalized.split('/');
  const stack: string[] = [];
  segments.forEach((segment) => {
    if (!segment || segment === '.') return;
    if (segment === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!absolute) {
        stack.push('..');
      }
      return;
    }
    stack.push(segment);
  });
  const joined = stack.join('/');
  if (absolute) return joined ? `/${joined}` : '/';
  return joined;
};

const parentDirectoryToken = (sourceFile?: string): string => {
  const normalized = collapsePathToken(sourceFile ?? '');
  if (!normalized || normalized === '<input>') return '';
  const idx = normalized.lastIndexOf('/');
  return idx < 0 ? '' : normalized.slice(0, idx);
};

const resolveIncludeFromMap = (
  includePath: string,
  includeFiles: Record<string, string>,
  parentSourceFile?: string,
): { sourceFile: string; content: string } | null => {
  if (!includePath) return null;
  const raw = includePath.trim();
  if (!raw) return null;
  const normalizedRaw = normalizePathToken(raw);
  const collapsedRaw = collapsePathToken(raw);
  const parentDir = parentDirectoryToken(parentSourceFile);
  const candidateKeys = new Set<string>([raw, normalizedRaw, collapsedRaw]);
  if (parentDir) {
    candidateKeys.add(collapsePathToken(`${parentDir}/${raw}`));
    candidateKeys.add(collapsePathToken(`${parentDir}/${normalizedRaw}`));
  }
  for (const key of candidateKeys) {
    if (includeFiles[key] != null) {
      return { sourceFile: key, content: includeFiles[key] };
    }
  }
  return null;
};

export const expandInputWithIncludes = (
  input: string,
  opts: Partial<ParseOptions>,
  logs: string[],
  helpers: ExpandDirectiveHelpers,
): {
  lines: ParseInputLineEntry[];
  includeTrace: NonNullable<ParseOptions['includeTrace']>;
  includeErrors: ParseIncludeError[];
} => {
  const includeTrace: NonNullable<ParseOptions['includeTrace']> = [];
  const includeErrors: ParseIncludeError[] = [];
  const lines: ParseInputLineEntry[] = [];
  const includeFiles = opts.includeFiles ?? {};
  const rootSource = collapsePathToken(opts.sourceFile?.trim() || '') || '<input>';
  const maxDepth = Math.max(1, opts.includeMaxDepth ?? 16);
  const rootStack = [...(opts.includeStack ?? []), collapsePathToken(rootSource)].filter(Boolean);
  const seenRootStack = new Set(rootStack);

  const walk = (text: string, sourceFile: string, stack: string[]): void => {
    const sourceLines = text.split('\n');
    sourceLines.forEach((raw, idx) => {
      const sourceLine = idx + 1;
      const parsedInline = helpers.splitInlineCommentAndDescription(raw.trim());
      const inline = parsedInline.line;
      if (inline && (inline.startsWith('.') || inline.startsWith('/'))) {
        const parts = helpers.splitWhitespaceTokens(inline);
        const normalized = helpers.normalizeInlineDirective(parts[0] ?? '');
        if (normalized.op === '.INCLUDE') {
          const includePath = parts.slice(1).join(' ').trim();
          if (!includePath) {
            const message = `.INCLUDE missing file path at ${sourceFile}:${sourceLine}.`;
            includeErrors.push({
              code: 'missing-include-path',
              sourceFile,
              line: sourceLine,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          if (stack.length >= maxDepth) {
            const message = `include depth exceeded at ${sourceFile}:${sourceLine} (limit=${maxDepth}) for "${includePath}".`;
            includeErrors.push({
              code: 'include-depth-exceeded',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          let resolvedByHook: { sourceFile: string; content: string } | null = null;
          try {
            resolvedByHook =
              opts.includeResolver?.({
                includePath,
                parentSourceFile: sourceFile,
                line: sourceLine,
                stack: [...stack],
              }) ?? null;
          } catch (error) {
            const message = `include resolver failed at ${sourceFile}:${sourceLine} for "${includePath}": ${error instanceof Error ? error.message : String(error)}`;
            includeErrors.push({
              code: 'include-not-found',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          const resolved =
            resolvedByHook ?? resolveIncludeFromMap(includePath, includeFiles, sourceFile);
          if (!resolved) {
            const message = `include not found at ${sourceFile}:${sourceLine}: "${includePath}".`;
            includeErrors.push({
              code: 'include-not-found',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          const normalizedSource = collapsePathToken(resolved.sourceFile);
          if (stack.includes(normalizedSource)) {
            const cycleStack = [...stack, normalizedSource];
            const message = `include cycle detected at ${sourceFile}:${sourceLine}: ${cycleStack.join(' -> ')}`;
            includeErrors.push({
              code: 'include-cycle',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: cycleStack,
            });
            logs.push(`Error: ${message}`);
            return;
          }
          includeTrace.push({
            parentSourceFile: sourceFile,
            sourceFile: normalizedSource,
            line: sourceLine,
          });
          lines.push({
            kind: 'include-enter',
            sourceLine,
            sourceFile,
            includeSourceFile: normalizedSource,
          });
          walk(resolved.content, normalizedSource, [...stack, normalizedSource]);
          lines.push({
            kind: 'include-exit',
            sourceLine,
            sourceFile,
            includeSourceFile: normalizedSource,
          });
          return;
        }
      }
      lines.push({ kind: 'line', raw, sourceLine, sourceFile });
    });
  };

  const normalizedRootStack = [...seenRootStack];
  walk(input, rootSource, normalizedRootStack.length > 0 ? normalizedRootStack : ['<input>']);
  return { lines, includeTrace, includeErrors };
};

export const expandProjectRunFilesWithIncludes = (
  runFiles: ProjectRunFile[],
  opts: Partial<ParseOptions>,
  logs: string[],
  helpers: ExpandDirectiveHelpers,
): {
  lines: ParseInputLineEntry[];
  includeTrace: NonNullable<ParseOptions['includeTrace']>;
  includeErrors: ParseIncludeError[];
} => {
  const includeTrace: NonNullable<ParseOptions['includeTrace']> = [];
  const includeErrors: ParseIncludeError[] = [];
  const lines: ParseInputLineEntry[] = [];
  const includeFiles = opts.includeFiles ?? {};
  const maxDepth = Math.max(1, opts.includeMaxDepth ?? 16);
  const rootSourceFiles = new Set(
    runFiles
      .map((file) => collapsePathToken(file.name))
      .filter((name): name is string => name.length > 0),
  );

  const walk = (text: string, sourceFile: string, stack: string[]): void => {
    const sourceLines = text.split('\n');
    sourceLines.forEach((raw, idx) => {
      const sourceLine = idx + 1;
      const parsedInline = helpers.splitInlineCommentAndDescription(raw.trim());
      const inline = parsedInline.line;
      if (inline && (inline.startsWith('.') || inline.startsWith('/'))) {
        const parts = helpers.splitWhitespaceTokens(inline);
        const normalized = helpers.normalizeInlineDirective(parts[0] ?? '');
        if (normalized.op === '.INCLUDE') {
          const includePath = parts.slice(1).join(' ').trim();
          if (!includePath) {
            const message = `.INCLUDE missing file path at ${sourceFile}:${sourceLine}.`;
            includeErrors.push({
              code: 'missing-include-path',
              sourceFile,
              line: sourceLine,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          if (stack.length >= maxDepth) {
            const message = `include depth exceeded at ${sourceFile}:${sourceLine} (limit=${maxDepth}) for "${includePath}".`;
            includeErrors.push({
              code: 'include-depth-exceeded',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          let resolvedByHook: { sourceFile: string; content: string } | null = null;
          try {
            resolvedByHook =
              opts.includeResolver?.({
                includePath,
                parentSourceFile: sourceFile,
                line: sourceLine,
                stack: [...stack],
              }) ?? null;
          } catch (error) {
            const message = `include resolver failed at ${sourceFile}:${sourceLine} for "${includePath}": ${error instanceof Error ? error.message : String(error)}`;
            includeErrors.push({
              code: 'include-not-found',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          const resolved =
            resolvedByHook ?? resolveIncludeFromMap(includePath, includeFiles, sourceFile);
          if (!resolved) {
            const message = `include not found at ${sourceFile}:${sourceLine}: "${includePath}".`;
            includeErrors.push({
              code: 'include-not-found',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: [...stack],
            });
            logs.push(`Error: ${message}`);
            return;
          }
          const normalizedSource = collapsePathToken(resolved.sourceFile);
          if (rootSourceFiles.has(normalizedSource)) {
            logs.push(
              `Warning: skipped duplicate project-file include "${normalizedSource}" at ${sourceFile}:${sourceLine} because that checked project file is already part of the run order.`,
            );
            return;
          }
          if (stack.includes(normalizedSource)) {
            const cycleStack = [...stack, normalizedSource];
            const message = `include cycle detected at ${sourceFile}:${sourceLine}: ${cycleStack.join(' -> ')}`;
            includeErrors.push({
              code: 'include-cycle',
              sourceFile,
              line: sourceLine,
              includePath,
              message,
              stack: cycleStack,
            });
            logs.push(`Error: ${message}`);
            return;
          }
          includeTrace.push({
            parentSourceFile: sourceFile,
            sourceFile: normalizedSource,
            line: sourceLine,
          });
          lines.push({
            kind: 'include-enter',
            sourceLine,
            sourceFile,
            includeSourceFile: normalizedSource,
          });
          walk(resolved.content, normalizedSource, [...stack, normalizedSource]);
          lines.push({
            kind: 'include-exit',
            sourceLine,
            sourceFile,
            includeSourceFile: normalizedSource,
          });
          return;
        }
      }
      lines.push({ kind: 'line', raw, sourceLine, sourceFile });
    });
  };

  runFiles.forEach((file, index) => {
    const sourceFile = collapsePathToken(file.name) || `<project-file-${index + 1}>`;
    lines.push({
      kind: 'project-file-enter',
      sourceLine: 1,
      sourceFile,
      projectFileIndex: index,
      projectFileCount: runFiles.length,
    });
    walk(file.content, sourceFile, [sourceFile]);
  });

  return { lines, includeTrace, includeErrors };
};
