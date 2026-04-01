export enum CommandKind {
  MovePlayer = 0,
  ReturnToMap = 1,
  Attack = 2,
  BlockStart = 3,
  BlockUpdate = 4,
  BlockEnd = 5,
  SprintBoost = 6,
  Jump = 7,
  GrappleFire = 8,
  GrappleRelease = 9,
  Interact = 10,
  /** Activate the equipped primary Weave (left click quick release). */
  WeaveActivatePrimary = 11,
  /** Begin holding the primary Weave (left click sustained). */
  WeaveHoldPrimary = 12,
  /** Release/end the primary Weave hold. */
  WeaveEndPrimary = 13,
  /** Activate the equipped secondary Weave (right click quick release). */
  WeaveActivateSecondary = 14,
  /** Begin holding the secondary Weave (right click sustained). */
  WeaveHoldSecondary = 15,
  /** Release/end the secondary Weave hold. */
  WeaveEndSecondary = 16,
}

export interface MovePlayerCommand {
  kind: CommandKind.MovePlayer;
  dx: number;
  dy: number;
}

export interface ReturnToMapCommand {
  kind: CommandKind.ReturnToMap;
}

export interface AttackCommand {
  kind: CommandKind.Attack;
  /**
   * Attack aim point in screen space (absolute pixels).
   * On PC this is the mouse cursor position; on mobile it is the touch-release position.
   * gameScreen.ts converts this to a world-space direction relative to the player.
   */
  aimXPx: number;
  aimYPx: number;
}

export interface BlockStartCommand {
  kind: CommandKind.BlockStart;
  /**
   * Absolute screen-space aim position (pixels).
   * gameScreen.ts converts to world-space direction relative to the player.
   */
  aimXPx: number;
  aimYPx: number;
}

export interface BlockUpdateCommand {
  kind: CommandKind.BlockUpdate;
  /**
   * Absolute screen-space aim position (pixels).
   * gameScreen.ts converts to world-space direction relative to the player.
   */
  aimXPx: number;
  aimYPx: number;
}

export interface BlockEndCommand {
  kind: CommandKind.BlockEnd;
}

export interface SprintBoostCommand {
  kind: CommandKind.SprintBoost;
}

export interface JumpCommand {
  kind: CommandKind.Jump;
}

export interface GrappleFireCommand {
  kind: CommandKind.GrappleFire;
  /**
   * Aim point in screen space (absolute pixels) where the hook is fired.
   * gameScreen.ts converts to world-space anchor position.
   */
  aimXPx: number;
  aimYPx: number;
}

export interface GrappleReleaseCommand {
  kind: CommandKind.GrappleRelease;
}

export interface InteractCommand {
  kind: CommandKind.Interact;
}

/** Activate primary Weave — burst-type (left click quick release). */
export interface WeaveActivatePrimaryCommand {
  kind: CommandKind.WeaveActivatePrimary;
  aimXPx: number;
  aimYPx: number;
}

/** Hold primary Weave — sustained-type (left click held). */
export interface WeaveHoldPrimaryCommand {
  kind: CommandKind.WeaveHoldPrimary;
  aimXPx: number;
  aimYPx: number;
}

/** End primary Weave hold. */
export interface WeaveEndPrimaryCommand {
  kind: CommandKind.WeaveEndPrimary;
}

/** Activate secondary Weave — burst-type (right click quick release). */
export interface WeaveActivateSecondaryCommand {
  kind: CommandKind.WeaveActivateSecondary;
  aimXPx: number;
  aimYPx: number;
}

/** Hold secondary Weave — sustained-type (right click held). */
export interface WeaveHoldSecondaryCommand {
  kind: CommandKind.WeaveHoldSecondary;
  aimXPx: number;
  aimYPx: number;
}

/** End secondary Weave hold. */
export interface WeaveEndSecondaryCommand {
  kind: CommandKind.WeaveEndSecondary;
}

export type GameCommand =
  | MovePlayerCommand
  | ReturnToMapCommand
  | AttackCommand
  | BlockStartCommand
  | BlockUpdateCommand
  | BlockEndCommand
  | SprintBoostCommand
  | JumpCommand
  | GrappleFireCommand
  | GrappleReleaseCommand
  | InteractCommand
  | WeaveActivatePrimaryCommand
  | WeaveHoldPrimaryCommand
  | WeaveEndPrimaryCommand
  | WeaveActivateSecondaryCommand
  | WeaveHoldSecondaryCommand
  | WeaveEndSecondaryCommand;

