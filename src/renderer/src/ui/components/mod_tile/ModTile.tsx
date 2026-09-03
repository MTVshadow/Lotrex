/**
 * ModTile Component
 * Displays a mod card with image, metadata, statistics, and action buttons.
 * Follows the Vortex design system used in CollectionTile.
 */

import { mdiDownload, mdiOpenInNew, mdiThumbUp } from "@mdi/js";
import numeral from "numeral";
import React, { type ComponentType, type PropsWithChildren, useState } from "react";

import type { IModListItem } from "@/extensions/news_dashlet/types";
import type { IExtensionApi } from "@/types/IExtensionContext";
import { Button } from "@/ui/components/button/Button";
import { Icon } from "@/ui/components/icon/Icon";
import { Image } from "@/ui/components/image/Image";
import { Typography } from "@/ui/components/typography/Typography";
import { joinClasses } from "@/ui/utils/joinClasses";

export interface IModTileProps {
  api: IExtensionApi;
  mod: IModListItem;
  gameDomainName: string;
  isLoggedIn?: boolean;
  onDownloadMod?: (mod: IModListItem) => void;
  onViewPage?: () => void;
  className?: string;
}

const Stat = ({ children, iconPath }: PropsWithChildren<{ iconPath: string }>) => (
  <div className="flex items-center gap-x-1">
    <Icon className="text-neutral-subdued" path={iconPath} size="sm" />
    <Typography appearance="moderate" typographyType="body-sm">
      {children}
    </Typography>
  </div>
);

export const ModTile: ComponentType<IModTileProps> = ({
  api,
  mod,
  gameDomainName,
  isLoggedIn = true,
  onDownloadMod,
  onViewPage,
  className,
}) => {
  const [downloading, setDownloading] = useState(false);

  // Отримуємо збережені метрики (лайки, завантаження) з додаткових даних мода
  const endorsements = mod.extra?.find((e) => e.id === "endorsements")?.value ?? 0;
  const downloads = mod.extra?.find((e) => e.id === "downloads")?.value ?? 0;

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await onDownloadMod?.(mod);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      className={joinClasses(["w-full rounded-md bg-surface-mid", className])}
      data-testid="mod-tile"
    >
      <div className="flex items-start gap-x-3.5 p-3">
        <Image
          alt={mod.name}
          className="w-full max-w-35 rounded-xs"
          fit="cover"
          imageType="mod"
          src={mod.imageUrl}
        />

        <div className="flex min-w-0 grow flex-col gap-y-1.5">
          <div className="flex flex-col gap-y-1">
            <Typography className="truncate font-semibold wrap-break-word" typographyType="body-lg">
              {mod.name}
            </Typography>

            <Typography
              appearance="moderate"
              className="flex items-center gap-x-1"
              typographyType="body-sm"
            >
              <span>By {mod.author || "Unknown"}</span>
              {mod.version && (
                <span className="rounded bg-surface-translucent-low px-1 py-0.5 text-xs text-neutral-subdued">
                  v{mod.version}
                </span>
              )}
            </Typography>
          </div>

          {mod.category && (
            <div className="flex items-center gap-x-1.5 border-t border-stroke-weak pt-1.5">
              <Typography brand="info" typographyType="body-sm">
                {mod.category}
              </Typography>
            </div>
          )}

          <div className="flex items-center gap-x-5 border-t border-stroke-weak pt-1.5">
            <Stat iconPath={mdiThumbUp}>{numeral(endorsements).format("0 a")}</Stat>
            <Stat iconPath={mdiDownload}>{numeral(downloads).format("0 a")}</Stat>
          </div>

          <Typography
            appearance="subdued"
            className="line-clamp-3 border-t border-stroke-weak pt-1.5 wrap-break-word"
            typographyType="body-sm"
          >
            {mod.summary}
          </Typography>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-x-2 rounded-b bg-surface-translucent-low px-3 py-2">
        <Button
          brand="primary"
          disabled={downloading}
          leftIconPath={mdiDownload}
          size="sm"
          onClick={handleDownload}
        >
          {downloading ? "Downloading..." : "Download"}
        </Button>

        <Button
          appearance="weak"
          brand="neutral"
          leftIconPath={mdiOpenInNew}
          size="sm"
          onClick={onViewPage}
        >
          View page
        </Button>
      </div>
    </div>
  );
};
