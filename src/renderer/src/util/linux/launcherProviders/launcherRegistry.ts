import { BottlesLauncherProvider } from "./bottlesProvider";
import {
  type ILauncherLaunchRequest,
  type ILauncherProvider,
  type ILaunchPlan,
  type LauncherType,
} from "./contracts";
import { HeroicLauncherProvider } from "./heroicProvider";
import { LutrisLauncherProvider } from "./lutrisProvider";
import { ManualLauncherProvider } from "./manualProvider";
import { SteamLauncherProvider } from "./steamProvider";

/**
 * Registry coordinating launcher provider adapters (Phase 3).
 * Normalizes launch plans across Steam, Heroic, Lutris, Bottles, and manual installations.
 */
export class LauncherProviderRegistry {
  private readonly mProviders = new Map<LauncherType, ILauncherProvider>();

  constructor() {
    this.registerProvider(new SteamLauncherProvider());
    this.registerProvider(new HeroicLauncherProvider());
    this.registerProvider(new LutrisLauncherProvider());
    this.registerProvider(new BottlesLauncherProvider());
    this.registerProvider(new ManualLauncherProvider());
  }

  public registerProvider(provider: ILauncherProvider): void {
    this.mProviders.set(provider.launcherType, provider);
  }

  public getProvider(type: LauncherType): ILauncherProvider | undefined {
    return this.mProviders.get(type);
  }

  /**
   * Generates a safe, normalized, explainable launch plan using the appropriate launcher provider.
   *
   * Enforces Phase 3 acceptance criteria:
   * 1. Providers discover and launch, but do not own mod semantics.
   * 2. Normalizes native executable, Proton, Wine prefix, environment, working directory,
   *    and structured arguments into one launch plan.
   * 3. Identical UI actions produce safe, explainable plans for native and Windows reference games.
   */
  public async buildLaunchPlan(request: ILauncherLaunchRequest): Promise<ILaunchPlan> {
    const provider = this.getProvider(request.launcher);
    if (!provider) {
      throw new Error(`Unsupported launcher type: '${request.launcher}'`);
    }

    return provider.generateLaunchPlan(request);
  }
}

/**
 * Global singleton launcher provider registry.
 */
export const defaultLauncherRegistry = new LauncherProviderRegistry();

/**
 * Normalizes a launch request into a structured launch plan.
 */
export async function buildNormalizedLaunchPlan(
  request: ILauncherLaunchRequest,
  registry: LauncherProviderRegistry = defaultLauncherRegistry,
): Promise<ILaunchPlan> {
  return registry.buildLaunchPlan(request);
}
