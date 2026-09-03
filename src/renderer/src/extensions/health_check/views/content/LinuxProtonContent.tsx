import React from "react";
import { useTranslation } from "react-i18next";

import { severityStyleMap } from "@/extensions/health_check/utils/shared/severityStyles";
import { Icon } from "@/ui/components/icon/Icon";
import { Typography } from "@/ui/components/typography/Typography";

import { LINUX_PROTON_CHECK_ID } from "../../checks/linuxProtonCheck";
import { ListingRow as ListingRowShell } from "../../components/listing_row/ListingRow";
import { linuxProtonCheckResult } from "../../selectors";
import type { ILinuxProtonIssue } from "../../types";
import type { IDetailViewProps, IHealthCheckContent, IListingRowProps } from "./types";

const issueKey = (issue: ILinuxProtonIssue): string =>
  `${issue.reason}:${issue.appId ?? "unknown"}`;

const ListingRow = ({ entry, onOpen }: IListingRowProps) => {
  const { t } = useTranslation("health_check");
  const issue = entry.data as ILinuxProtonIssue;

  return (
    <ListingRowShell
      detail={issue.executablePath ?? issue.steamPath ?? ""}
      entryActions={null}
      severity={entry.severity}
      summary={t(`linux_proton::issues::${issue.reason}::summary`)}
      title={t("linux_proton::title", { gameName: issue.gameName })}
      onOpen={onOpen}
    />
  );
};

const DetailView = ({ entry }: IDetailViewProps) => {
  const { t } = useTranslation("health_check");
  const issue = entry.data as ILinuxProtonIssue;
  const severity = severityStyleMap[entry.severity];
  const diagnostics = [
    [t("linux_proton::diagnostics::app_id"), issue.appId],
    [t("linux_proton::diagnostics::executable"), issue.executablePath],
    [t("linux_proton::diagnostics::steam"), issue.steamPath],
    [t("linux_proton::diagnostics::prefix"), issue.prefixPath],
  ].filter((item): item is [string, string] => Boolean(item[1]));

  return (
    <div className="rounded-lg border border-stroke-weak">
      <div className="flex items-center gap-x-2 border-b border-stroke-weak p-4">
        <Icon className={severity.textClassName} path={severity.iconPath} />
        <Typography className="font-semibold">
          {t(`linux_proton::issues::${issue.reason}::title`)}
        </Typography>
      </div>

      <div className="space-y-4 p-6">
        <Typography appearance="subdued" as="p">
          {t(`linux_proton::issues::${issue.reason}::details`)}
        </Typography>

        {diagnostics.length > 0 && (
          <dl className="space-y-2 rounded-sm bg-surface-low p-4">
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
      </div>
    </div>
  );
};

export const linuxProtonContent: IHealthCheckContent = {
  DetailView,
  ListingRow,
  selectEntries: (state) => {
    const issue = linuxProtonCheckResult(state)?.issue;
    return issue
      ? [
          {
            checkId: LINUX_PROTON_CHECK_ID,
            data: issue,
            id: issueKey(issue),
            resolutionType: "configure",
            severity: "warning",
          },
        ]
      : [];
  },
};
