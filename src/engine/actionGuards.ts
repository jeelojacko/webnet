export type ActionGuardId =
  | 'exclude-rerun'
  | 'cluster-apply'
  | 'cluster-revert'
  | 'import-apply'
  | 'import-new-file';

export interface ActionGuardContext {
  action: ActionGuardId;
  scope: string;
  detail?: string;
  disabledReason?: string;
}

export const resolveActionGuardReason = (
  enabled: boolean,
  context: Pick<ActionGuardContext, 'disabledReason'>,
): string | null => {
  if (enabled) return null;
  return context.disabledReason?.trim() || 'Action unavailable in the current run context.';
};

export const buildActionGuardMessage = (context: ActionGuardContext): string => {
  const detail = context.detail ? `\n\n${context.detail}` : '';
  switch (context.action) {
    case 'exclude-rerun':
      return `Exclude and rerun this observation?\n\nScope: ${context.scope}${detail}`;
    case 'cluster-apply':
      return `Apply approved cluster merges and rerun?\n\nScope: ${context.scope}${detail}`;
    case 'cluster-revert':
      return `Revert applied cluster merges and rerun?\n\nScope: ${context.scope}${detail}`;
    case 'import-apply':
      return `Import selected rows into the current editor workspace?\n\nScope: ${context.scope}${detail}`;
    case 'import-new-file':
      return `Import selected rows as a new project source file?\n\nScope: ${context.scope}${detail}`;
    default:
      return `Confirm action?\n\nScope: ${context.scope}${detail}`;
  }
};

export const confirmActionGuard = (
  context: ActionGuardContext,
  confirmFn: (_message: string) => boolean = (message) => window.confirm(message),
): boolean => confirmFn(buildActionGuardMessage(context));

