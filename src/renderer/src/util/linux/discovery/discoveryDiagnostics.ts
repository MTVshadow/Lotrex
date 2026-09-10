import * as os from "node:os";

import { redactTokensAndSecrets, redactUserPaths } from "../diagnosticReport";
import type { IDiscoveredResource } from "./contracts";
import type { IUserApprovedCustomRoot } from "./customRootsRegistry";
import type { IDiscoveryExecutionReport } from "./resourceDiscoveryEngine";

export interface IDiscoveryReportGeneratorOptions {
  homeDir?: string;
  userName?: string;
  hostPackaging?: string;
  customRoots?: IUserApprovedCustomRoot[];
  lastRefresh?: number;
}

export interface IRedactedResourceEntry {
  id: string;
  kind: string;
  provider: string;
  canonicalPath: string;
  packagingFormat: string;
  sandboxVisibility: string;
  confidence: string;
  validationStatus: string;
  validationReasons?: string[];
  evidenceCount: number;
  evidenceSources: Array<{ sourceType: string; sourcePath: string }>;
  remediation?: { code: string; message: string; command?: string };
}

export interface IRedactedDiscoverySummary {
  generatedAt: string;
  lastRefresh?: string;
  hostPackaging: string;
  scannedSourcesCount: number;
  totalResources: number;
  byKind: Record<string, number>;
  byProvider: Record<string, number>;
  byConfidence: Record<string, number>;
  customRoots: Array<{ id: string; path: string; scope: string; validated: boolean }>;
  resources: IRedactedResourceEntry[];
  errors: Array<{ provider: string; message: string }>;
}

/**
 * Generates a privacy-safe, redacted discovery diagnostics data structure.
 *
 * Educational comment:
 * Strips usernames, paths, and secrets before exporting or rendering diagnostics.
 * Prevents accidental disclosure of user tokens, API keys, or system credentials.
 */
export function buildRedactedDiscoverySummary(
  report: IDiscoveryExecutionReport,
  options: IDiscoveryReportGeneratorOptions = {},
): IRedactedDiscoverySummary {
  const homeDir = options.homeDir ?? os.homedir();
  const userName = options.userName ?? (os.userInfo?.()?.username || process.env.USER);

  const clean = (val?: string) => {
    if (!val) return "";
    let cleaned = redactUserPaths(val, homeDir, userName);
    if (userName && userName.length > 2) {
      cleaned = cleaned.replace(new RegExp(`\\b${userName}\\b`, "g"), "<user>");
    }
    return redactTokensAndSecrets(cleaned);
  };

  const byKind: Record<string, number> = {};
  const byProvider: Record<string, number> = {};
  const byConfidence: Record<string, number> = {};

  const resources: IRedactedResourceEntry[] = report.resources.map((res) => {
    byKind[res.kind] = (byKind[res.kind] || 0) + 1;
    byProvider[res.provider] = (byProvider[res.provider] || 0) + 1;
    byConfidence[res.confidence] = (byConfidence[res.confidence] || 0) + 1;

    return {
      id: res.id,
      kind: res.kind,
      provider: res.provider,
      canonicalPath: clean(res.canonicalPath),
      packagingFormat: res.packagingContext.format,
      sandboxVisibility: res.packagingContext.sandboxVisibility || "direct",
      confidence: res.confidence,
      validationStatus: res.validationState.status,
      validationReasons: res.validationState.reasons?.map((r) => clean(r)),
      evidenceCount: res.evidence.length,
      evidenceSources: res.evidence.map((e) => ({
        sourceType: e.sourceType,
        sourcePath: clean(e.sourcePath),
      })),
      remediation: res.remediation
        ? {
            code: res.remediation.code,
            message: clean(res.remediation.message),
            command: res.remediation.command ? clean(res.remediation.command) : undefined,
          }
        : undefined,
    };
  });

  const customRoots = (options.customRoots || []).map((root) => ({
    id: root.id,
    path: clean(root.path),
    scope: root.scope,
    validated: root.validated,
  }));

  const errors = (report.errors || []).map((err) => ({
    provider: err.provider,
    message: clean(err.message),
  }));

  return {
    generatedAt: new Date().toISOString(),
    lastRefresh: options.lastRefresh ? new Date(options.lastRefresh).toISOString() : undefined,
    hostPackaging: options.hostPackaging || "native",
    scannedSourcesCount: report.scannedSourcesCount,
    totalResources: report.resources.length,
    byKind,
    byProvider,
    byConfidence,
    customRoots,
    resources,
    errors,
  };
}

/**
 * Generates a redacted Markdown report for clipboard copying (Phase 9).
 *
 * Educational comment:
 * Formats discovery results into a structured, human-readable report.
 * Provides full visibility into sandbox boundaries, duplicate resolution,
 * provider agreement, and custom approved roots without exposing user secrets.
 */
export function generateRedactedDiscoveryReport(
  report: IDiscoveryExecutionReport,
  options: IDiscoveryReportGeneratorOptions = {},
): string {
  const summary = buildRedactedDiscoverySummary(report, options);

  const lines: string[] = [
    "# Unified Linux Resource Discovery — Diagnostic Report",
    `*Generated on: ${summary.generatedAt}*`,
    summary.lastRefresh ? `*Last Refresh: ${summary.lastRefresh}*` : "",
    "",
    "## 1. Environment & Discovery Summary",
    `- **Host Packaging:** \`${summary.hostPackaging}\``,
    `- **Scanned Bounded Sources:** ${summary.scannedSourcesCount}`,
    `- **Total Resources Discovered:** ${summary.totalResources}`,
    "",
    "### Resource Breakdown by Kind",
  ];

  for (const [kind, count] of Object.entries(summary.byKind)) {
    lines.push(`- **${kind}:** ${count}`);
  }

  lines.push("", "### Breakdown by Confidence");
  for (const [conf, count] of Object.entries(summary.byConfidence)) {
    lines.push(`- **${conf}:** ${count}`);
  }

  if (summary.customRoots.length > 0) {
    lines.push("", "## 2. User-Approved Custom Roots");
    for (const root of summary.customRoots) {
      lines.push(
        `- \`${root.path}\` (Scope: ${root.scope}, Validated: ${root.validated ? "Yes" : "No"})`,
      );
    }
  }

  lines.push("", "## 3. Discovered Resources Matrix");
  if (summary.resources.length === 0) {
    lines.push("- *No resources discovered in registered bounded sources.*");
  } else {
    for (const res of summary.resources) {
      lines.push(
        `### [${res.kind.toUpperCase()}] ${res.id}`,
        `- **Provider:** \`${res.provider}\``,
        `- **Canonical Path:** \`${res.canonicalPath}\``,
        `- **Confidence:** \`${res.confidence}\``,
        `- **Packaging / Sandbox:** \`${res.packagingFormat}\` (visibility: \`${res.sandboxVisibility}\`)`,
        `- **Validation:** \`${res.validationStatus}\``,
      );

      if (res.validationReasons && res.validationReasons.length > 0) {
        lines.push(`  - *Reasons:* ${res.validationReasons.join("; ")}`);
      }

      lines.push(
        `- **Duplicate Resolution & Evidence:** ${res.evidenceCount} source(s) corroborating`,
      );
      for (const ev of res.evidenceSources) {
        lines.push(`  - \`${ev.sourceType}\` -> \`${ev.sourcePath}\``);
      }

      if (res.remediation) {
        lines.push(`- **Remediation [${res.remediation.code}]:** ${res.remediation.message}`);
        if (res.remediation.command) {
          lines.push(`  \`\`\`bash\n  ${res.remediation.command}\n  \`\`\``);
        }
      }
      lines.push("");
    }
  }

  if (summary.errors.length > 0) {
    lines.push("## 4. Discovery Warnings & Errors");
    for (const err of summary.errors) {
      lines.push(`- **[${err.provider}]** ${err.message}`);
    }
  }

  return lines.filter(Boolean).join("\n");
}
