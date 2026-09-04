import path from "node:path";

import { describe, expect, it } from "vitest";

const {
  GAME_ID,
  PRIMARY_EXE,
  FINAL_EXE,
  STEAM_APP_ID,
  GOG_APP_ID,
  isGothic3DataArchive,
  isGothic3DataFile,
  findCommonRoot,
  normalizeGothic3Path,
  testSupportedContent,
  installContent,
  getExecutable,
} = require("./index.js");

describe("game-gothic3 metadata and identifiers", () => {
  it("has correct game ID matching Nexus Mods", () => {
    expect(GAME_ID).toBe("gothic3");
  });

  it("has correct Steam AppID and GOG ID", () => {
    expect(STEAM_APP_ID).toBe("39500");
    expect(GOG_APP_ID).toBe("1207658986");
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
});
