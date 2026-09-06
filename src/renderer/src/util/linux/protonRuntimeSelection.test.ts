import { describe, expect, it } from "vitest";

import type { IProtonRuntimeOption } from "./protonRuntimes";
import { resolveProtonRuntimePreference } from "./protonRuntimeSelection";

const installed: IProtonRuntimeOption[] = [
  {
    id: "experimental",
    isUsable: true,
    name: "Proton Experimental",
    path: "/steam/Proton Experimental",
    source: "steamapps",
    type: "experimental",
  },
  {
    id: "ge",
    isUsable: true,
    name: "GE-Proton10",
    path: "/steam/GE-Proton10",
    source: "compatibilitytools.d",
    type: "ge-proton",
  },
];

describe("resolveProtonRuntimePreference", () => {
  it("leaves automatic selection to the launch resolver", () => {
    expect(resolveProtonRuntimePreference(undefined, "/steam/Proton 10", installed)).toEqual({
      type: "auto",
      path: undefined,
    });
  });

  it("resolves Steam-selected, Experimental, and GE choices", () => {
    expect(
      resolveProtonRuntimePreference({ type: "steam-selected" }, "/steam/Proton 10", installed)
        .path,
    ).toBe("/steam/Proton 10");
    expect(
      resolveProtonRuntimePreference({ type: "experimental" }, undefined, installed).path,
    ).toBe("/steam/Proton Experimental");
    expect(resolveProtonRuntimePreference({ type: "ge-proton" }, undefined, installed).path).toBe(
      "/steam/GE-Proton10",
    );
  });

  it("returns an actionable error when a persisted runtime disappeared", () => {
    expect(
      resolveProtonRuntimePreference(
        { type: "custom", path: "/removed/Proton" },
        undefined,
        installed,
      ).error,
    ).toContain("does not exist");
  });
});
