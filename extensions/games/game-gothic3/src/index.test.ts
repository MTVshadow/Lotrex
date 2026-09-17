import path from "node:path";

import { describe, expect, it, vi } from "vitest";

const {
  GAME_ID,
  FORSAKEN_GODS_GAME_ID,
  PRIMARY_EXE,
  FORSAKEN_GODS_EXE,
  STEAM_APP_ID,
  FORSAKEN_GODS_STEAM_ID,
  GOG_APP_ID,
  FORSAKEN_GODS_GOG_ID,
  FORSAKEN_GODS_GAME,
  GAMES,
  linuxSteamCandidates,
  default: registerGames,
  isGothic3DataArchive,
  isGothic3DataFile,
  findCommonRoot,
  normalizeGothic3Path,
  isPatchBundle,
  isCommunityPatch,
  isUpdatePack,
  isUkrainianLocalization,
  patchOrderingInstructions,
  reconcileInstalledPatchStack,
  testSupportedContent,
  installContent,
  getExecutable,
} = require("./index.js");

type RegisteredGame = {
  id: string;
  queryArgs: { steam: string[]; gog: string[] };
  requiredFiles: string[];
  executable: () => string;
  details: { nexusPageId: string };
};

describe("game-gothic3 metadata and identifiers", () => {
  it("has correct game ID matching Nexus Mods", () => {
    expect(GAME_ID).toBe("gothic3");
  });

  it("has correct Steam AppID and GOG ID", () => {
    expect(STEAM_APP_ID).toBe("39500");
    expect(GOG_APP_ID).toBe("1207658986");
    expect(getExecutable(undefined)).toBe(PRIMARY_EXE);
  });

  it("identifies Forsaken Gods as its own installation", () => {
    expect(FORSAKEN_GODS_GAME_ID).toBe("gothic3fg");
    expect(FORSAKEN_GODS_STEAM_ID).toBe("65600");
    expect(FORSAKEN_GODS_GOG_ID).toBe("1207658993");
    expect(FORSAKEN_GODS_EXE).toBe("Gothic III Forsaken Gods.exe");
    expect(FORSAKEN_GODS_GAME.installDir).toBe("Gothic 3 Forsaken Gods");
  });

  it("registers both game editions with edition-specific Steam discovery", () => {
    const registeredGames: RegisteredGame[] = [];
    const registerGame = vi.fn<(game: RegisteredGame) => void>((game) => {
      registeredGames.push(game);
    });
    const registerInstaller = vi.fn<(...args: unknown[]) => void>();

    registerGames({ registerGame, registerInstaller });

    expect(registeredGames.map((game) => game.id)).toEqual(
      GAMES.map((game: RegisteredGame) => game.id),
    );
    expect(registeredGames[0].queryArgs.steam).toEqual([STEAM_APP_ID]);

    const forsakenGods = registeredGames.find((game) => game.id === FORSAKEN_GODS_GAME_ID);
    if (forsakenGods === undefined) {
      throw new Error("Forsaken Gods game registration is missing");
    }

    expect(forsakenGods.queryArgs.steam).toEqual([FORSAKEN_GODS_STEAM_ID]);
    expect(forsakenGods.queryArgs.gog).toEqual([FORSAKEN_GODS_GOG_ID]);
    expect(forsakenGods.requiredFiles).toEqual([FORSAKEN_GODS_EXE]);
    expect(forsakenGods.executable()).toBe(FORSAKEN_GODS_EXE);
    expect(forsakenGods.details.nexusPageId).toBe(GAME_ID);
    expect(registerInstaller).toHaveBeenCalledOnce();
  });

  it("builds Steam fallback candidates from XDG roots for each installation", () => {
    const env = { HOME: "/home/tester", XDG_DATA_HOME: "/data/user" };

    expect(linuxSteamCandidates(GAMES[0], env)).toEqual([
      path.join("/data/user", "Steam", "steamapps", "common", "Gothic 3"),
      path.join("/home/tester", ".steam", "steam", "steamapps", "common", "Gothic 3"),
      path.join(
        "/home/tester",
        ".var",
        "app",
        "com.valvesoftware.Steam",
        ".local",
        "share",
        "Steam",
        "steamapps",
        "common",
        "Gothic 3",
      ),
    ]);
    expect(linuxSteamCandidates(FORSAKEN_GODS_GAME, env)[0]).toContain("Gothic 3 Forsaken Gods");
  });
});

describe("Gothic 3 archive and data extensions detection", () => {
  it("identifies base, CP, mod and AB archive generations", () => {
    expect(isGothic3DataArchive(".pak")).toBe(true);
    expect(isGothic3DataArchive(".p00")).toBe(true);
    expect(isGothic3DataArchive(".p01")).toBe(true);
    expect(isGothic3DataArchive(".cpt")).toBe(true);
    expect(isGothic3DataArchive(".c00")).toBe(true);
    expect(isGothic3DataArchive(".mod")).toBe(true);
    expect(isGothic3DataArchive(".m00")).toBe(true);
    expect(isGothic3DataArchive(".m12")).toBe(true);
    expect(isGothic3DataArchive(".nod")).toBe(true);
    expect(isGothic3DataArchive(".n00")).toBe(true);
    expect(isGothic3DataArchive(".n05")).toBe(true);
  });

  it("rejects non-archive extensions", () => {
    expect(isGothic3DataArchive(".txt")).toBe(false);
    expect(isGothic3DataArchive(".exe")).toBe(false);
    expect(isGothic3DataArchive(".dll")).toBe(false);
    expect(isGothic3DataArchive(".ini")).toBe(false);
  });

  it("identifies Gothic 3 engine asset formats", () => {
    expect(isGothic3DataFile(".ximg")).toBe(true);
    expect(isGothic3DataFile(".xmat")).toBe(true);
    expect(isGothic3DataFile(".xmsh")).toBe(true);
    expect(isGothic3DataFile(".lrentdat")).toBe(true);
    expect(isGothic3DataFile(".wrldatasc")).toBe(true);
    expect(isGothic3DataFile(".pdf")).toBe(false);
  });
});

describe("findCommonRoot wrapper stripper", () => {
  it("strips common mod folder wrapper", () => {
    const files = [
      "Autumn_Mod_v1.0/Templates.m00",
      "Autumn_Mod_v1.0/Quests.m00",
      "Autumn_Mod_v1.0/Readme.txt",
    ];
    expect(findCommonRoot(files)).toBe("Autumn_Mod_v1.0/");
  });

  it("does not strip if first directory is Data, Ini, Scripts or Docs", () => {
    const files = ["Data/_compiledImage.m00", "Data/Templates.m00"];
    expect(findCommonRoot(files)).toBe("");

    const iniFiles = ["Ini/ge3.ini", "Ini/mountlist.ini"];
    expect(findCommonRoot(iniFiles)).toBe("");
  });

  it("returns empty string for root files", () => {
    const files = ["_compiledImage.m00", "Templates.m00"];
    expect(findCommonRoot(files)).toBe("");
  });
});

describe("normalizeGothic3Path router", () => {
  it("routes loose mod archives to Data/", () => {
    expect(normalizeGothic3Path("_compiledImage.m00")).toBe(
      path.join("Data", "_compiledImage.m00"),
    );
    expect(normalizeGothic3Path("Templates.nod")).toBe(path.join("Data", "Templates.nod"));
    expect(normalizeGothic3Path("Sound.c00")).toBe(path.join("Data", "Sound.c00"));
  });

  it("preserves files already in Data/", () => {
    expect(normalizeGothic3Path("Data/_compiledImage.m00")).toBe(
      path.join("Data", "_compiledImage.m00"),
    );
    expect(normalizeGothic3Path("data/templates.m00")).toBe(path.join("Data", "templates.m00"));
  });

  it("routes loose ge3.ini to Ini/", () => {
    expect(normalizeGothic3Path("ge3.ini")).toBe(path.join("Ini", "ge3.ini"));
    expect(normalizeGothic3Path("mountlist.ini")).toBe(path.join("Ini", "mountlist.ini"));
  });

  it("routes mountlist subfolders to Data/<folder>", () => {
    expect(normalizeGothic3Path("Materials/world.xmat")).toBe(
      path.join("Data", "Materials", "world.xmat"),
    );
    expect(normalizeGothic3Path("Video/intro.bik")).toBe(path.join("Data", "Video", "intro.bik"));
  });

  it("keeps root runtime DLLs in root", () => {
    expect(normalizeGothic3Path("d3d9.dll")).toBe("d3d9.dll");
    expect(normalizeGothic3Path("dxvk.conf")).toBe("dxvk.conf");
  });

  it("strips common root prefix correctly", () => {
    const prefix = "MyMod/";
    expect(normalizeGothic3Path("MyMod/_compiledImage.m00", prefix)).toBe(
      path.join("Data", "_compiledImage.m00"),
    );
    expect(normalizeGothic3Path("MyMod/Ini/ge3.ini", prefix)).toBe(path.join("Ini", "ge3.ini"));
  });
});

describe("testSupportedContent & installContent", () => {
  it("supports Gothic 3 mod archives", async () => {
    const res = await testSupportedContent(["_compiledImage.m00", "ge3.ini"], GAME_ID);
    expect(res.supported).toBe(true);
  });

  it("supports Gothic 3 Nexus mods for the Forsaken Gods installation", async () => {
    const res = await testSupportedContent(["Data/_compiledImage.m00"], FORSAKEN_GODS_GAME_ID);
    expect(res.supported).toBe(true);
  });

  it("rejects non-gothic3 game ID", async () => {
    const res = await testSupportedContent(["_compiledImage.m00"], "skyrimse");
    expect(res.supported).toBe(false);
  });

  it("generates correct copy instructions during install", async () => {
    const files = ["MyMod/_compiledImage.m00", "MyMod/Templates.nod", "MyMod/d3d9.dll"];
    const { instructions } = await installContent(files);
    expect(instructions).toEqual([
      {
        type: "copy",
        source: "MyMod/_compiledImage.m00",
        destination: path.join("Data", "_compiledImage.m00"),
      },
      {
        type: "copy",
        source: "MyMod/Templates.nod",
        destination: path.join("Data", "Templates.nod"),
      },
      {
        type: "copy",
        source: "MyMod/d3d9.dll",
        destination: "d3d9.dll",
      },
    ]);
  });

  it("identifies the patch sequence and makes the update override the base patch", () => {
    const communityPatch = ["Gothic3.exe", "Data/Projects_compiled.cpt"];
    const updatePack = ["Data/Projects_compiled.p01", "Data/Strings.p00"];
    const localization = ["Data/Projects_compiled/stringtable.bin", "Ini/ge3.INI"];

    expect(isCommunityPatch(communityPatch)).toBe(true);
    expect(isUpdatePack(updatePack)).toBe(true);
    expect(isUkrainianLocalization(localization)).toBe(true);
    expect(patchOrderingInstructions(updatePack)).toEqual([
      expect.objectContaining({ type: "rule", rule: expect.objectContaining({ type: "after" }) }),
    ]);
    expect(patchOrderingInstructions(localization)).toHaveLength(2);
  });

  it("rejects patch compilations that contain several installer executables", async () => {
    const patchBundle = [
      "Community Patch/Gothic_3_EE_Patch_v1.75.14_Int_Full.exe",
      "Update Pack/Gothic_3_EE_v1.75_Int_Update_Pack_v1.04.11.exe",
    ];

    expect(isPatchBundle(patchBundle)).toBe(true);
    await expect(installContent(patchBundle)).rejects.toThrow("multiple Gothic 3 patch installers");
  });

  it("orders the installed patch stack and disables a patch compilation", () => {
    const dispatch = vi.fn();
    const state = {
      persistent: {
        mods: {
          gothic3: {
            "Gothic_3_EE_Patch_v1.75.14_Int_Full": { rules: [] },
            "Gothic_3_EE_v1.75_Int_Update_Pack_v1.04.11": { rules: [] },
            patchBundle: {
              attributes: { fileName: "Gothic 3 Patches-46-04-06-26-1767543105.7z" },
              rules: [],
            },
          },
        },
        profiles: {
          gothic: {
            id: "gothic",
            gameId: GAME_ID,
            modState: { patchBundle: { enabled: true } },
          },
        },
      },
    };
    const actionApi = {
      addModRule: vi.fn((gameId, modId, rule) => ({ gameId, modId, rule })),
      setModEnabled: vi.fn((profileId, modId, enabled) => ({ profileId, modId, enabled })),
    };

    reconcileInstalledPatchStack({
      actions: actionApi,
      getState: () => state,
      store: { dispatch },
    });

    expect(actionApi.addModRule).toHaveBeenCalledTimes(2);
    expect(actionApi.setModEnabled).toHaveBeenCalledWith("gothic", "patchBundle", false);
  });
});
