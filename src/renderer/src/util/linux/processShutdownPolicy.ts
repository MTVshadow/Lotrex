import type { LinuxLaunchMode } from "./unifiedLaunchProvider";

export type ProcessShutdownPolicy =
  | "managed-tree"
  | "tracked-child"
  | "detached"
  | "launcher-handoff";

export interface IProcessShutdownPolicyInput {
  mode: LinuxLaunchMode;
  detach: boolean;
  onStart?: "hide" | "hide_recover" | "close";
}

export function resolveProcessShutdownPolicy(
  input: IProcessShutdownPolicyInput,
): ProcessShutdownPolicy {
  if (["steam-uri", "heroic-uri", "lutris-uri"].includes(input.mode)) {
    return "launcher-handoff";
  }
  if (input.detach || input.onStart === "close") {
    return "detached";
  }
  if (["steam-proton", "custom-proton"].includes(input.mode)) {
    return "managed-tree";
  }
  return "tracked-child";
}

export function shutdownPolicyUsesDetachedProcess(policy: ProcessShutdownPolicy): boolean {
  return policy !== "tracked-child";
}
