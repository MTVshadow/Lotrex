export type IQuickDiscoveryResult =
  | {
      gameIds: string[];
      status: "success";
    }
  | {
      error: { message: string };
      gameIds: string[];
      status: "failed";
    };

export type QuickDiscoveryCallback = (gameIds: string[], result?: IQuickDiscoveryResult) => void;
