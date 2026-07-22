import { applyCoreDirectiveState } from './parseDirectiveState';
import { GEO_DIRECTIVE_HANDLERS } from './parseDirectiveRegistryGeoHandlers';
import { GENERAL_DIRECTIVE_HANDLERS } from './parseDirectiveRegistryGeneralHandlers';
import { GPS_DIRECTIVE_HANDLERS } from './parseDirectiveRegistryGpsHandlers';
import { WORKFLOW_DIRECTIVE_HANDLERS } from './parseDirectiveRegistryWorkflowHandlers';
import { handled, type ParseDirectiveDispatchArgs, type ParseDirectiveDispatchResult, type SpecializedDirectiveHandler } from './parseDirectiveRegistryShared';

export type { ParseDirectiveDispatchArgs, ParseDirectiveDispatchResult } from './parseDirectiveRegistryShared';

const SPECIALIZED_DIRECTIVE_HANDLERS: Record<string, SpecializedDirectiveHandler> = {
  ...GEO_DIRECTIVE_HANDLERS,
  ...GPS_DIRECTIVE_HANDLERS,
  ...GENERAL_DIRECTIVE_HANDLERS,
  ...WORKFLOW_DIRECTIVE_HANDLERS,
};

export const dispatchParseDirective = (
  args: ParseDirectiveDispatchArgs,
): ParseDirectiveDispatchResult => {
  const coreDirectiveResult = applyCoreDirectiveState(args);
  if (coreDirectiveResult.handled) return coreDirectiveResult;
  const handler = SPECIALIZED_DIRECTIVE_HANDLERS[args.op];
  if (handler) return handler(args);
  return handled(args.orderExplicit);
};
