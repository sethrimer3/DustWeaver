/** Player actions that exclusively own the player's weaving state. */
export enum ExclusivePlayerAction {
  None = 0,
  Grapple = 1,
  ShieldWeave = 2,
}

export interface PlayerActionRequests {
  grapple: boolean;
  shieldWeave: boolean;
}

export interface PlayerActionArbitration {
  /** Action that owns this input frame. Existing ownership is never preempted. */
  owner: ExclusivePlayerAction;
  allowGrapple: boolean;
  allowShieldWeave: boolean;
}

/**
 * Resolves mutually exclusive grapple/Shield Weave input for one frame.
 *
 * An action that was active at the start of the frame keeps ownership until
 * released, so a competing input cannot cancel it or take over in the same
 * frame. From idle, simultaneous requests use the canonical input priority:
 * grappling wins over Shield Weave.
 */
export function arbitrateExclusivePlayerActions(
  activeAction: ExclusivePlayerAction,
  requests: PlayerActionRequests,
): PlayerActionArbitration {
  let owner = activeAction;
  if (owner === ExclusivePlayerAction.None) {
    if (requests.grapple) owner = ExclusivePlayerAction.Grapple;
    else if (requests.shieldWeave) owner = ExclusivePlayerAction.ShieldWeave;
  }

  return {
    owner,
    allowGrapple: owner === ExclusivePlayerAction.Grapple,
    allowShieldWeave: owner === ExclusivePlayerAction.ShieldWeave,
  };
}

export function getActiveExclusivePlayerAction(
  isGrappleActive: boolean,
  isShieldWeaveActive: boolean,
): ExclusivePlayerAction {
  if (isGrappleActive) return ExclusivePlayerAction.Grapple;
  if (isShieldWeaveActive) return ExclusivePlayerAction.ShieldWeave;
  return ExclusivePlayerAction.None;
}
