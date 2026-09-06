import { describe, expect, it } from "vitest";

import {
  detectCaseCollisions,
  formatCaseCollisionReport,
  normalizeCasePath,
} from "./caseCollisions";

describe("caseCollisions", () => {
  it("normalizes paths to lowercase posix format", () => {
    expect(normalizeCasePath("Data\\Textures\\Wood.DDS")).toBe("data/textures/wood.dds");
    expect(normalizeCasePath("data/textures/wood.dds")).toBe("data/textures/wood.dds");
    expect(normalizeCasePath("Data\\Meshes/../Textures\\Wood.DDS")).toBe("data/textures/wood.dds");
  });

  it("collides canonically equivalent NFC and NFD names", () => {
    const collisions = detectCaseCollisions([
      { modId: "nfc", relPath: "Textures/Café.dds" },
      { modId: "nfd", relPath: "Textures/Cafe\u0301.dds" },
    ]);

    expect(collisions).toHaveLength(1);
    expect(collisions[0].normalizedPath).toBe("textures/café.dds");
  });

  it("uses stable locale-independent casing for Turkish-I variants", () => {
    expect(normalizeCasePath("INTERFACE/ICON.DDS")).toBe("interface/icon.dds");
    expect(normalizeCasePath("İNTERFACE/İCON.DDS")).toBe("i\u0307nterface/i\u0307con.dds");
    expect(normalizeCasePath("ınterface/ıcon.dds")).toBe("ınterface/ıcon.dds");
  });

  it("detects non-Latin case variants", () => {
    expect(
      detectCaseCollisions([{ relPath: "ТЕКСТУРЫ/БРОНЯ.DDS" }, { relPath: "текстуры/броня.dds" }]),
    ).toHaveLength(1);
  });

  it("collides mixed Windows and POSIX separators after dot-segment normalization", () => {
    expect(
      detectCaseCollisions([
        { relPath: "Data\\Meshes\\..\\Textures\\Armor.dds" },
        { relPath: "data/textures/armor.dds" },
      ]),
    ).toHaveLength(1);
  });

  it("identifies case collisions between different mod files", () => {
    const items = [
      {
        modId: "mod-a",
        relPath: "Textures/Armor/Iron.dds",
        sourcePath: "/staging/mod-a/Textures/Armor/Iron.dds",
      },
      {
        modId: "mod-b",
        relPath: "textures/armor/iron.dds",
        sourcePath: "/staging/mod-b/textures/armor/iron.dds",
      },
      {
        modId: "mod-c",
        relPath: "Meshes/Armor/Iron.nif",
        sourcePath: "/staging/mod-c/Meshes/Armor/Iron.nif",
      },
    ];

    const collisions = detectCaseCollisions(items);
    expect(collisions.length).toBe(1);
    expect(collisions[0].normalizedPath).toBe("textures/armor/iron.dds");
    expect(collisions[0].variants).toEqual(["Textures/Armor/Iron.dds", "textures/armor/iron.dds"]);
    expect(collisions[0].sources.length).toBe(2);
  });

  it("does not report identical casing as a collision", () => {
    const items = [
      {
        modId: "mod-a",
        relPath: "Textures/Armor/Iron.dds",
      },
      {
        modId: "mod-b",
        relPath: "Textures/Armor/Iron.dds",
      },
    ];

    const collisions = detectCaseCollisions(items);
    expect(collisions.length).toBe(0);
  });

  it("formats human-readable diagnostic report", () => {
    const collisions = [
      {
        normalizedPath: "textures/wood.dds",
        sources: [
          { modId: "mod-1", relPath: "Textures/Wood.dds" },
          { modId: "mod-2", relPath: "textures/wood.dds" },
        ],
        variants: ["Textures/Wood.dds", "textures/wood.dds"],
      },
    ];

    const report = formatCaseCollisionReport(collisions);
    expect(report).toContain("case-sensitive filename collision");
    expect(report).toContain("Textures/Wood.dds (mod: mod-1)");
    expect(report).toContain("textures/wood.dds (mod: mod-2)");
  });
});
