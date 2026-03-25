export enum CommandKind {
  MovePlayer = 0,
  ReturnToMap = 1,
}

export interface MovePlayerCommand {
  kind: CommandKind.MovePlayer;
  dx: number;
  dy: number;
}

export interface ReturnToMapCommand {
  kind: CommandKind.ReturnToMap;
}

export type GameCommand = MovePlayerCommand | ReturnToMapCommand;
