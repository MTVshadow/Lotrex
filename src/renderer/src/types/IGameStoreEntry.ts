export type GameStoreRuntimeType = "native" | "proton" | "umu" | "wine";

export interface IGameStoreLaunchContext {
  launcher: "heroic" | "lutris" | "steam";
  runner?: string;
  prefixPath?: string;
  runtimePath?: string;
  runtimeType?: GameStoreRuntimeType;
  executablePath?: string;
  arguments?: string[];
}

export interface IGameStoreEntry {
  appid: string;
  name: string;
  gamePath: string;
  gameStoreId: string | undefined;
  priority?: number;
  lastUpdated?: Date;
  lastUser?: string;
  /** Compatibility environment used by the launcher for this game. */
  launchContext?: IGameStoreLaunchContext;
}
