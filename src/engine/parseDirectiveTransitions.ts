import type {
  DirectiveNoEffectWarning,
  DirectiveTransition,
  Observation,
} from '../types';
import type { ParseInputLineEntry } from './parseIncludes';

type FinalizeDirectiveTransitionsArgs = {
  directiveTransitions: DirectiveTransition[];
  observations: Observation[];
  lines: ParseInputLineEntry[];
  splitInlineCommentAndDescription: (_line: string) => { line: string; description?: string };
};

export const finalizeDirectiveTransitions = ({
  directiveTransitions,
  observations,
  lines,
  splitInlineCommentAndDescription,
}: FinalizeDirectiveTransitionsArgs): DirectiveNoEffectWarning[] => {
  const directiveNoEffectWarnings: DirectiveNoEffectWarning[] = [];
  if (directiveTransitions.length === 0) return directiveNoEffectWarnings;

  const observationLines = observations
    .map((obs) => obs.sourceLine)
    .filter((line): line is number => Number.isFinite(line as number));
  const hasSubsequentDataLines = (sourceLine: number): boolean => {
    for (let i = 0; i < lines.length; i += 1) {
      const rawLine = lines[i];
      if (rawLine.kind !== 'line') continue;
      if (rawLine.sourceLine <= sourceLine) continue;
      const trimmed = rawLine.raw.trim();
      if (!trimmed) continue;
      const parsedInline = splitInlineCommentAndDescription(trimmed);
      if (!parsedInline.line || parsedInline.line.startsWith('#')) continue;
      return true;
    }
    return false;
  };

  directiveTransitions.forEach((transition, index) => {
    const next = directiveTransitions[index + 1];
    transition.effectiveToLine = next ? next.line - 1 : undefined;
    transition.obsCountInRange = observationLines.filter((obsLine) => {
      if (obsLine < transition.effectiveFromLine) return false;
      if (transition.effectiveToLine == null) return true;
      return obsLine <= transition.effectiveToLine;
    }).length;
    if (transition.obsCountInRange > 0) return;
    if (!hasSubsequentDataLines(transition.line)) {
      directiveNoEffectWarnings.push({
        line: transition.line,
        directive: transition.directive,
        reason: 'noSubsequentObservations',
      });
    } else {
      directiveNoEffectWarnings.push({
        line: transition.line,
        directive: transition.directive,
        reason: 'noSubsequentObsRecords',
      });
    }
  });

  return directiveNoEffectWarnings;
};
