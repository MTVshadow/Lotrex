import type {
  GameSupportTier,
  IEvaluatedSupportTier,
  ILifecycleEvidence,
  ILifecycleVerificationChecklist,
  IPromotionEligibility,
  ISupportCatalogRecord,
} from "./contracts";

/**
 * Lifecycle checklist fields required for community-tested qualification.
 */
export const COMMUNITY_TESTED_MANDATORY_STEPS: (keyof ILifecycleVerificationChecklist)[] = [
  "discovery",
  "modInstall",
  "deployment",
  "purgeRestoration",
];

/**
 * All 10 lifecycle checklist fields required for supported tier qualification.
 */
export const FULL_LIFECYCLE_STEPS: (keyof ILifecycleVerificationChecklist)[] = [
  "discovery",
  "profileCreation",
  "modInstall",
  "conflictResolution",
  "deployment",
  "loadOrder",
  "toolsExecution",
  "launchPreparation",
  "purgeRestoration",
  "atomicRollback",
];

/**
 * Build composite unique ID for a catalog matrix entry.
 */
export function buildCatalogKeyId(
  gameId: string,
  editionId: string,
  storeId: string,
  platform: string,
): string {
  return `${gameId}:${editionId}:${storeId}:${platform}`;
}

/**
 * Evaluates support tier compliance, checking staleness, reproducible evidence, and limitations.
 *
 * Implements Phase 9 acceptance criteria:
 * Stale evidence automatically downgrades the claim.
 */
export function evaluateSupportTier(
  record: ISupportCatalogRecord,
  currentDate: Date = new Date(),
): IEvaluatedSupportTier {
  const missingCriteria: string[] = [];
  const recommendedActions: string[] = [];

  // 1. Calculate age of last verification
  const lastDate = new Date(record.lastVerificationDate);
  const diffMs = currentDate.getTime() - lastDate.getTime();
  const ageInDays = Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  const isStale = ageInDays > record.staleAfterDays;
  const staleDays = Math.max(0, ageInDays - record.staleAfterDays);

  // 2. Identify blocking limitations
  const blockingLimitations = record.knownLimitations.filter((lim) => lim.severity === "blocking");

  // 3. Inspect latest evidence
  const latestEvidence: ILifecycleEvidence | undefined =
    record.evidenceHistory.length > 0
      ? record.evidenceHistory[record.evidenceHistory.length - 1]
      : undefined;

  let effectiveTier: GameSupportTier = record.declaredTier;
  let downgradeReason: string | undefined;

  if (record.declaredTier === "supported") {
    // Check maintainer requirement
    if (!record.maintainer || record.maintainer.trim().length === 0) {
      missingCriteria.push("Designated maintainer is required for supported tier");
      recommendedActions.push("Assign an active maintainer responsible for updates");
      effectiveTier = "community-tested";
      downgradeReason = "Missing designated maintainer";
    }

    // Check complete 10-stage lifecycle evidence
    if (!latestEvidence) {
      missingCriteria.push("No recorded lifecycle evidence found");
      recommendedActions.push("Perform full 10-stage reproducible verification run");
      effectiveTier = "experimental";
      downgradeReason = "Absence of packaged lifecycle verification evidence";
    } else {
      const missingSteps = FULL_LIFECYCLE_STEPS.filter((step) => !latestEvidence.checklist[step]);
      if (missingSteps.length > 0) {
        missingCriteria.push(
          `Incomplete lifecycle verification (missing: ${missingSteps.join(", ")})`,
        );
        recommendedActions.push(
          `Execute and verify missing lifecycle stages: ${missingSteps.join(", ")}`,
        );
        effectiveTier = "community-tested";
        downgradeReason = `Incomplete lifecycle stages: ${missingSteps.join(", ")}`;
      }
    }

    // Check blocking limitations
    if (blockingLimitations.length > 0) {
      missingCriteria.push(
        `Active blocking limitations: ${blockingLimitations.map((l) => l.summary).join("; ")}`,
      );
      recommendedActions.push("Resolve open blocking bugs before claiming supported tier");
      effectiveTier = "experimental";
      downgradeReason = `Blocking limitations present: ${blockingLimitations[0].summary}`;
    }

    // Check staleness and apply automatic downgrade
    if (isStale) {
      const severeStale = ageInDays > record.staleAfterDays * 2;
      const targetDowngrade: GameSupportTier = severeStale ? "experimental" : "community-tested";
      missingCriteria.push(
        `Verification is stale (${ageInDays} days old, threshold ${record.staleAfterDays} days)`,
      );
      recommendedActions.push(
        `Re-run reproducible regression suite on target matrix to renew verification`,
      );

      // Downgrade to lowest applicable tier
      if (targetDowngrade === "experimental" || effectiveTier === "supported") {
        effectiveTier = targetDowngrade;
        downgradeReason = severeStale
          ? `Severely stale verification (${ageInDays} days without regression test)`
          : `Stale verification (${ageInDays} days old, exceeds ${record.staleAfterDays} days limit)`;
      }
    }
  } else if (record.declaredTier === "community-tested") {
    // Check community requirements: core steps must pass
    if (!latestEvidence) {
      missingCriteria.push("No community verification evidence recorded");
      recommendedActions.push("Record at least one verified community test run");
      effectiveTier = "experimental";
      downgradeReason = "Missing community verification evidence";
    } else {
      const missingSteps = COMMUNITY_TESTED_MANDATORY_STEPS.filter(
        (step) => !latestEvidence.checklist[step],
      );
      if (missingSteps.length > 0) {
        missingCriteria.push(`Missing baseline community steps: ${missingSteps.join(", ")}`);
        effectiveTier = "experimental";
        downgradeReason = `Missing mandatory steps: ${missingSteps.join(", ")}`;
      }
    }

    if (blockingLimitations.length > 0) {
      missingCriteria.push(`Blocking limitation: ${blockingLimitations[0].summary}`);
      effectiveTier = "experimental";
      downgradeReason = `Blocking limitation present: ${blockingLimitations[0].summary}`;
    }

    if (isStale) {
      missingCriteria.push(`Community verification is stale (${ageInDays} days old)`);
      recommendedActions.push("Submit fresh community test evidence to retain tier");
      effectiveTier = "experimental";
      downgradeReason = `Community verification is stale by ${staleDays} days`;
    }
  } else if (record.declaredTier === "experimental") {
    // Experimental requires at least discovery
    if (latestEvidence && !latestEvidence.checklist.discovery) {
      missingCriteria.push("Discovery fails for this game/store/runtime target");
      effectiveTier = "unsupported";
      downgradeReason = "Discovery failure prevents experimental classification";
    }
  }

  const downgraded = effectiveTier !== record.declaredTier;

  return {
    recordId: record.id,
    key: {
      gameId: record.gameId,
      editionId: record.editionId,
      storeId: record.storeId,
      platform: record.platform,
    },
    declaredTier: record.declaredTier,
    effectiveTier,
    isStale,
    staleDays,
    downgraded,
    downgradeReason,
    blockingLimitations,
    missingCriteria,
    recommendedActions,
  };
}

/**
 * Validates whether new evidence qualifies a record for promotion to a target tier.
 *
 * Implements rule: "Promotion requires reproducible evidence."
 */
export function checkPromotionEligibility(
  record: ISupportCatalogRecord,
  targetTier: GameSupportTier,
  evidence: ILifecycleEvidence,
): IPromotionEligibility {
  const reasons: string[] = [];
  const missingSteps: (keyof ILifecycleVerificationChecklist)[] = [];

  if (targetTier === "unsupported") {
    return { targetTier, eligible: true, reasons: [], missingLifecycleSteps: [] };
  }

  if (targetTier === "experimental") {
    if (!evidence.checklist.discovery) {
      reasons.push("Experimental tier requires at least executable discovery verification.");
      missingSteps.push("discovery");
    }
    return {
      targetTier,
      eligible: reasons.length === 0,
      reasons,
      missingLifecycleSteps: missingSteps,
    };
  }

  if (targetTier === "community-tested") {
    for (const step of COMMUNITY_TESTED_MANDATORY_STEPS) {
      if (!evidence.checklist[step]) {
        reasons.push(`Mandatory step '${step}' was not verified in submitted evidence.`);
        missingSteps.push(step);
      }
    }

    const hasBlocking = record.knownLimitations.some((l) => l.severity === "blocking");
    if (hasBlocking) {
      reasons.push(
        "Cannot promote to community-tested while unmitigated blocking limitations exist.",
      );
    }

    return {
      targetTier,
      eligible: reasons.length === 0,
      reasons,
      missingLifecycleSteps: missingSteps,
    };
  }

  if (targetTier === "supported") {
    // 1. Maintainer
    if (!record.maintainer || record.maintainer.trim().length === 0) {
      reasons.push("Supported tier requires a dedicated maintainer.");
    }

    // 2. All 10 lifecycle steps
    for (const step of FULL_LIFECYCLE_STEPS) {
      if (!evidence.checklist[step]) {
        reasons.push(`All 10 lifecycle steps required. Missing: '${step}'.`);
        missingSteps.push(step);
      }
    }

    // 3. No blocking limitations
    const hasBlocking = record.knownLimitations.some((l) => l.severity === "blocking");
    if (hasBlocking) {
      reasons.push("Cannot promote to supported while unmitigated blocking limitations exist.");
    }

    // 4. Matrix checks
    if (!record.distroMatrix || record.distroMatrix.length === 0) {
      reasons.push("Supported tier requires at least one verified Linux distro target.");
    }

    if (!record.deploymentMatrix || record.deploymentMatrix.length === 0) {
      reasons.push("Supported tier requires at least one verified deployment method.");
    }

    return {
      targetTier,
      eligible: reasons.length === 0,
      reasons,
      missingLifecycleSteps: missingSteps,
    };
  }

  return {
    targetTier,
    eligible: false,
    reasons: ["Unknown target tier"],
    missingLifecycleSteps: [],
  };
}
