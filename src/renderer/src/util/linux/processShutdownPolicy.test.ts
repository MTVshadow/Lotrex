import { describe, expect, it } from "vitest";

import {
  resolveProcessShutdownPolicy,
  shutdownPolicyUsesDetachedProcess,
} from "./processShutdownPolicy";

describe("Linux process shutdown policy", () => {
  it.each([
    ["steam-proton", false, undefined, "managed-tree"],
    ["custom-proton", true, undefined, "detached"],
    ["native", false, undefined, "tracked-child"],
    ["native", false, "close", "detached"],
    ["steam-uri", false, undefined, "launcher-handoff"],
    ["heroic-uri", false, undefined, "launcher-handoff"],
    ["lutris-uri", false, undefined, "launcher-handoff"],
  ] as const)("maps %s to %s", (mode, detach, onStart, expected) => {
    const policy = resolveProcessShutdownPolicy({ detach, mode, onStart });
    expect(policy).toBe(expected);
    expect(shutdownPolicyUsesDetachedProcess(policy)).toBe(expected !== "tracked-child");
  });
});
