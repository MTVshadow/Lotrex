import React from "react";
import { useTranslation } from "react-i18next";

import { severityStyleMap } from "@/extensions/health_check/utils/shared/severityStyles";
import { Button } from "@/ui/components/button/Button";
import { Icon } from "@/ui/components/icon/Icon";
import { Typography } from "@/ui/components/typography/Typography";
import { writeFileAtomic } from "@/util/fsAtomic";

import { LINUX_PROTON_CHECK_ID } from "../../checks/linuxProtonCheck";
import { ListingRow as ListingRowShell } from "../../components/listing_row/ListingRow";
import { linuxProtonCheckResult } from "../../selectors";
import type { ILinuxProtonIssue } from "../../types";
import { generateLinuxIssueReport } from "../../utils/linuxDiagnosticIssueReport";
import type { IDetailViewProps, IHealthCheckContent, IListingRowProps } from "./types";

const issueKey = (issue: ILinuxProtonIssue): string =>
  `${issue.reason}:${issue.path ?? issue.appId ?? "unknown"}`;

const ListingRow = ({ entry, onOpen }: IListingRowProps) => {
  const { t } = useTranslation("health_check");
  const issue = entry.data as ILinuxProtonIssue;
  const translationOptions = {
    appId: issue.appId,
    fsType: issue.fsType,
    mountPoint: issue.mountPoint,
    path: issue.path,
  };

  return (
    <ListingRowShell
      detail={issue.path ?? issue.executablePath ?? issue.steamPath ?? ""}
      entryActions={null}
      severity={entry.severity}
      summary={t(`linux_proton::issues::${issue.reason}::summary`, translationOptions)}
      title={t("linux_proton::title", { gameName: issue.gameName })}
      onOpen={onOpen}
    />
  );
};

const DetailView = ({ api, entry }: IDetailViewProps) => {
  const { t } = useTranslation("health_check");
  const issue = entry.data as ILinuxProtonIssue;
  const severity = severityStyleMap[entry.severity];
  const translationOptions = {
    appId: issue.appId,
    fsType: issue.fsType,
    mountPoint: issue.mountPoint,
    path: issue.path,
  };
  const diagnostics = [
    [t("linux_proton::diagnostics::app_id"), issue.appId],
    [t("linux_proton::diagnostics::executable"), issue.executablePath],
    [t("linux_proton::diagnostics::steam"), issue.steamPath],
    [t("linux_proton::diagnostics::prefix"), issue.prefixPath],
    [t("linux_proton::diagnostics::path"), issue.path],
    [t("linux_proton::diagnostics::mount"), issue.mountPoint],
    [t("linux_proton::diagnostics::filesystem"), issue.fsType],
    [t("linux_proton::diagnostics::command"), issue.command],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  const report = React.useMemo(
    () => generateLinuxIssueReport(issue, entry.severity),
    [entry.severity, issue],
  );
  const [copyStatus, setCopyStatus] = React.useState("");

  const copyReport = () => {
    window.api.clipboard.writeText(report);
    setCopyStatus(t("linux_proton::report::copied"));
  };
  const saveReport = async () => {
    try {
      const outputPath = await api.saveFile({
        defaultPath: "vortex-linux-diagnostic.md",
        filters: [{ extensions: ["md"], name: "Markdown" }],
        title: t("linux_proton::report::save_title"),
      });
      if (outputPath !== undefined) await writeFileAtomic(outputPath, report);
    } catch (err) {
      api.showErrorNotification(t("linux_proton::report::save_failed"), err);
    }
  };

  return (
    <div
      aria-labelledby="linux-proton-detail-title"
      className="rounded-lg border border-stroke-weak"
      role="region"
    >
      <div className="flex items-center gap-x-2 border-b border-stroke-weak p-4">
        <Icon className={severity.textClassName} path={severity.iconPath} />
        <Typography as="h3" className="font-semibold" id="linux-proton-detail-title">
          {t(`linux_proton::issues::${issue.reason}::title`, translationOptions)}
        </Typography>
      </div>

      <div className="space-y-4 p-6">
        <Typography appearance="subdued" as="p">
          {t(`linux_proton::issues::${issue.reason}::details`, translationOptions)}
        </Typography>

        {issue.remediation && (
          <Typography as="p">
            {t(`linux_proton::issues::${issue.reason}::remediation`, translationOptions)}
          </Typography>
        )}

        {diagnostics.length > 0 && (
          <dl
            aria-label={t("linux_proton::diagnostics::title")}
            className="space-y-2 rounded-sm bg-surface-low p-4"
          >
            {diagnostics.map(([label, value]) => (
              <div className="grid grid-cols-[10rem_1fr] gap-x-3" key={label}>
                <dt>
                  <Typography appearance="subdued" typographyType="body-sm">
                    {label}
                  </Typography>
                </dt>
                <dd>
                  <Typography className="break-all" typographyType="body-sm">
                    {value}
                  </Typography>
                </dd>
              </div>
            ))}
          </dl>
        )}

        <details className="rounded-sm bg-surface-low p-4">
          <summary className="cursor-pointer">
            <Typography>{t("linux_proton::report::preview")}</Typography>
          </summary>
          <pre
            aria-label={t("linux_proton::report::preview")}
            className="mt-4 max-h-80 overflow-auto text-sm whitespace-pre-wrap"
            tabIndex={0}
          >
            {report}
          </pre>
          <div className="mt-4 flex gap-2">
            <Button appearance="subdued" onClick={copyReport}>
              {t("linux_proton::report::copy")}
            </Button>
            <Button appearance="subdued" onClick={saveReport}>
              {t("linux_proton::report::save")}
            </Button>
          </div>
          <div aria-live="polite" className="sr-only" role="status">
            {copyStatus}
          </div>
        </details>
      </div>
    </div>
  );
};

export const linuxProtonContent: IHealthCheckContent = {
  DetailView,
  ListingRow,
  selectEntries: (state) => {
    const metadata = linuxProtonCheckResult(state);
    const issues = metadata?.issues ?? (metadata?.issue ? [metadata.issue] : []);
    return issues.map((issue) => ({
      checkId: LINUX_PROTON_CHECK_ID,
      data: issue,
      id: issueKey(issue),
      resolutionType: "configure",
      severity: issue.severity ?? "warning",
    }));
  },
};
