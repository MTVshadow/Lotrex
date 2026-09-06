import { describe, expect, it } from "vitest";

import { supportsPlatform } from "./platform";

describe("Ubisoft store platform gate", () => {
  it("supports only Windows", () => {
    expect(supportsPlatform("win32")).toBe(true);
    expect(supportsPlatform("linux")).toBe(false);
    expect(supportsPlatform("darwin")).toBe(false);
  });
});
