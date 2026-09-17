import { describe, expect, it } from "vitest";

import { normalizeStoreQuery } from "./GameStoreHelper";

describe("normalizeStoreQuery", () => {
  it("normalizes a single app ID", () => {
    expect(normalizeStoreQuery("2870")).toEqual([{ id: "2870" }]);
  });

  it("normalizes legacy arrays of app IDs", () => {
    expect(normalizeStoreQuery(["39500", "65600"])).toEqual([{ id: "39500" }, { id: "65600" }]);
  });

  it("preserves arrays of store query objects", () => {
    expect(normalizeStoreQuery([{ id: "2870" }, { name: "X Rebirth" }])).toEqual([
      { id: "2870" },
      { name: "X Rebirth" },
    ]);
  });
});
