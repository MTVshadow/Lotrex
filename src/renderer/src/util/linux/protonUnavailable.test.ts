import { describe, expect, it } from "vitest";

import { ProtonUnavailable, protonUnavailableMessage } from "./ProtonUnavailable";

describe("ProtonUnavailable", () => {
  it("explains how to initialize a missing prefix", () => {
    const error = new ProtonUnavailable("prefix-not-found", "489830");

    expect(error.appId).toBe("489830");
    expect(error.name).toBe("ProtonUnavailable");
    expect(protonUnavailableMessage(error.reason)).toContain("Start the game once from Steam");
  });

  it("explains how to install or select a missing runtime", () => {
    const error = new ProtonUnavailable("runtime-not-found");

    expect(protonUnavailableMessage(error.reason)).toContain("Install or select Proton");
  });
});
