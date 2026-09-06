import { describe, expect, it } from "vitest";

import { diffDirectorySnapshots, isWatcherLimitError } from "./directoryPolling";

describe("directory polling fallback", () => {
  it("recognizes Linux watcher exhaustion without treating unrelated errors as limits", () => {
    expect(isWatcherLimitError(Object.assign(new Error(), { code: "ENOSPC" }))).toBe(true);
    expect(isWatcherLimitError(Object.assign(new Error(), { code: "EMFILE" }))).toBe(true);
    expect(isWatcherLimitError(Object.assign(new Error(), { code: "EACCES" }))).toBe(false);
  });

  it("reports added, removed, and modified files from bounded snapshots", () => {
    const previous = new Map([
      ["changed.zip", "10:1"],
      ["removed.zip", "20:1"],
    ]);
    const current = new Map([
      ["added.zip", "30:1"],
      ["changed.zip", "11:2"],
    ]);

    expect(diffDirectorySnapshots(previous, current)).toEqual([
      { event: "rename", fileName: "added.zip" },
      { event: "update", fileName: "changed.zip" },
      { event: "rename", fileName: "removed.zip" },
    ]);
  });
});
