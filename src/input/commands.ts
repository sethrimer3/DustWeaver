export enum CommandKind {
  MovePlayer = 0,
  ReturnToMap = 1,
  Attack = 2,
  BlockStart = 3,
  BlockUpdate = 4,
  BlockEnd = 5,
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
  /** Normalized attack direction in screen space. */
  dirXNorm: number;
  dirYNorm: number;
}

export interface BlockStartCommand {
  kind: CommandKind.BlockStart;
  dirXNorm: number;
  dirYNorm: number;
}

export interface BlockUpdateCommand {
  kind: CommandKind.BlockUpdate;
  dirXNorm: number;
  dirYNorm: number;
}

export interface BlockEndCommand {
  kind: CommandKind.BlockEnd;
}

export type GameCommand =
  | MovePlayerCommand
  | ReturnToMapCommand
  | AttackCommand
  | BlockStartCommand
  | BlockUpdateCommand
  | BlockEndCommand;
