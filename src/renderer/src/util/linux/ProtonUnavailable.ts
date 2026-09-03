export type ProtonUnavailableReason = "prefix-not-found" | "runtime-not-found";

export class ProtonUnavailable extends Error {
  public constructor(
    public readonly reason: ProtonUnavailableReason,
    public readonly appId?: string,
  ) {
    super(
      reason === "prefix-not-found"
        ? "The Proton prefix has not been created for this game"
        : "No compatible Proton runtime could be found",
    );
    this.name = "ProtonUnavailable";
  }
}

export function protonUnavailableMessage(reason: ProtonUnavailableReason): string {
  return reason === "prefix-not-found"
    ? "Steam has not created a Proton prefix for this game yet. Start the game once from Steam, close it, then try again."
    : "Vortex could not find the Proton version configured for this game or another installed Proton runtime. Install or select Proton in the game's Steam compatibility settings, then try again.";
}
