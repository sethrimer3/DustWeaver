export enum CommandKind {
  MovePlayer = 0,
  ReturnToMap = 1,
  Attack = 2,
  BlockStart = 3,
  BlockUpdate = 4,
  BlockEnd = 5,
  Dash = 6,
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

export interface DashCommand {
  kind: CommandKind.Dash;
  /**
   * Preferred dash direction in screen space (absolute pixels, from player toward cursor).
   * Falls back to current movement direction when no explicit direction is given.
   */
  aimXPx: number;
  aimYPx: number;
}

export type GameCommand =
  | MovePlayerCommand
  | ReturnToMapCommand
  | AttackCommand
  | BlockStartCommand
  | BlockUpdateCommand
  | BlockEndCommand
  | DashCommand;

