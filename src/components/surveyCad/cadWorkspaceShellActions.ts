import type { CadShellActions } from '../../cad-app/shell/cadShellTypes';
import {
  buildCadWorkspaceShellCoreActions,
  type CadWorkspaceShellCoreContext,
} from './cadWorkspaceShellActionsCore';
import {
  buildCadWorkspaceShellCivilActions,
  type CadWorkspaceShellCivilContext,
} from './cadWorkspaceShellActionsCivil';
import {
  buildCadWorkspaceShellLinearActions,
  type CadWorkspaceShellLinearContext,
} from './cadWorkspaceShellActionsLinear';
import {
  buildCadWorkspaceShellGradingActions,
  type CadWorkspaceShellGradingContext,
} from './cadWorkspaceShellActionsGrading';

export interface CadWorkspaceShellActionsContext {
  core: CadWorkspaceShellCoreContext;
  civil: CadWorkspaceShellCivilContext;
  linear: CadWorkspaceShellLinearContext;
  grading: CadWorkspaceShellGradingContext;
}

/**
 * STRUCT-194.2 — compose the full shell-action control plane from four
 * cohesive, side-effect-free-at-construction factories. Called on every
 * root render with the current context so every closure reads fresh state;
 * the returned object is a new identity each render, exactly like the
 * former inline literal.
 */
export const buildCadWorkspaceShellActions = (
  context: CadWorkspaceShellActionsContext,
): CadShellActions => ({
  ...buildCadWorkspaceShellCoreActions(context.core),
  ...buildCadWorkspaceShellCivilActions(context.civil),
  ...buildCadWorkspaceShellLinearActions(context.linear),
  ...buildCadWorkspaceShellGradingActions(context.grading),
});
