import { generateLinuxDiagnosticReport } from "@/util/linux/diagnosticReport";

import type { ILinuxProtonIssue } from "../types";

export function generateLinuxIssueReport(issue: ILinuxProtonIssue, severity: string): string {
  return generateLinuxDiagnosticReport({
    game: {
      gameName: issue.gameName,
      gamePath: issue.executablePath
        ? issue.executablePath.replace(/[\\/][^\\/]+$/, "")
        : issue.path,
    },
    issues: [
      {
        code: issue.reason,
        message: issue.message ?? issue.remediation ?? "No additional diagnostic message",
        severity: issue.severity ?? severity,
      },
    ],
    steam: {
      prefixPath: issue.prefixPath,
      steamPath: issue.steamPath,
    },
  });
}
