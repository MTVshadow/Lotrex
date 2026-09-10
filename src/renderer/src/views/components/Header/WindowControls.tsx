import { mdiWindowClose, mdiWindowMaximize, mdiWindowMinimize, mdiWindowRestore } from "@mdi/js";
import React, { type ButtonHTMLAttributes, type FC } from "react";
import { useTranslation } from "react-i18next";

import { close, minimize, toggleMaximize, useIsMaximized } from "@/hooks";
import { Icon } from "@/ui/components/icon/Icon";
import { Tooltip } from "@/ui/components/tooltip/Tooltip";
import { TooltipDelayGroup } from "@/ui/components/tooltip/TooltipDelayGroup";
import { joinClasses } from "@/ui/utils/joinClasses";

interface WindowControlButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  className?: string;
  iconPath: string;
  title: string;
}

const WindowControlButton: FC<React.PropsWithChildren<WindowControlButtonProps>> = ({
  className,
  iconPath,
  title,
  ...props
}) => (
  <Tooltip content={title} placement="bottom">
    <button
      aria-label={title}
      className={joinClasses([
        "flex h-11 w-8.5 items-center justify-center text-neutral-subdued -outline-offset-2 transition-colors hover:text-neutral-strong",
        className,
      ])}
      {...props}
    >
      <Icon path={iconPath} size="sm" />
    </button>
  </Tooltip>
);

export const WindowControls: FC<React.PropsWithChildren<unknown>> = () => {
  const { t } = useTranslation();
  const isMaximized = useIsMaximized();

  // Семантичні підказки елементів керування вікном для реактивного перемикання мови
  return (
    <TooltipDelayGroup as="div" className="flex">
      <WindowControlButton
        className="hover:bg-surface-mid"
        iconPath={mdiWindowMinimize}
        title={t("navigation::window::minimize")}
        onClick={minimize}
      />

      <WindowControlButton
        className="hover:bg-surface-mid"
        iconPath={isMaximized ? mdiWindowRestore : mdiWindowMaximize}
        title={isMaximized ? t("navigation::window::restore") : t("navigation::window::maximize")}
        onClick={toggleMaximize}
      />

      <WindowControlButton
        className="w-9 hover:bg-danger-subdued"
        iconPath={mdiWindowClose}
        title={t("navigation::window::close")}
        onClick={close}
      />
    </TooltipDelayGroup>
  );
};
