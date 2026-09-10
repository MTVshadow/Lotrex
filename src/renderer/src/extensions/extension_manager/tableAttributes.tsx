import type { EndorsedStatus } from "@nexusmods/nexus-api";
import type { TFunction } from "i18next";
import * as React from "react";

import TableTextFilter from "../../controls/table/TextFilter";
import type { IExtensionWithState } from "../../types/extensions";
import type { IExtensionLoadFailure } from "../../types/IState";
import type { ITableAttribute } from "../../types/ITableAttribute";
import { SITE_ID } from "../gamemode_management/constants";
import type { EndorseMod } from "../nexus_integration/attributes";
import EndorseModButton from "../nexus_integration/views/EndorseModButton";

interface IAttributesContext {
  onSetExtensionEnabled: (extensionName: string, enabled: boolean) => void;
  onToggleExtensionEnabled: (extensionName: string) => void;
  onEndorseMod: (gameId: string, modId: string, endorsed: EndorsedStatus) => void;
}

function renderLoadFailure(t: TFunction, fail: IExtensionLoadFailure) {
  // Семантична локалізація діагностики помилок завантаження розширень
  if (fail.id === "unsupported-version") {
    return t("extension_manager:::table::errors::not_compatible");
  }

  if (fail.id === "unsupported-api") {
    return t("extension_manager:::table::errors::unsupported_api");
  }

  if (fail.id === "exception") {
    return t("extension_manager:::table::errors::failed_to_load", { replace: fail.args });
  }

  if (fail.id === "dependency") {
    if (fail.args.version) {
      return t("extension_manager:::table::errors::depends_on_version", { replace: fail.args });
    }

    return t("extension_manager:::table::errors::depends_on", { replace: fail.args });
  }

  const id = fail.id satisfies never;
  return t("extension_manager:::table::errors::unknown_error", { replace: { id } });
}

function createEndorsedIcon(ext: IExtensionWithState, onEndorse: EndorseMod, t: TFunction) {
  const endorsed: string = ext.endorsed || "Undecided";
  return (
    <EndorseModButton
      endorsedStatus={endorsed}
      t={t}
      gameId={SITE_ID}
      modId={ext.modId.toString()}
      onEndorseMod={onEndorse}
    />
  );
}

function getTableAttributes(
  context: IAttributesContext,
  t?: TFunction,
): Array<ITableAttribute<IExtensionWithState>> {
  // Резолвер семантичних ключів з fallback для підтримки динамічного перезавантаження без перезапуску
  const tr = (key: string, fallbackText: string) => (t ? t(key) : fallbackText);

  return [
    {
      id: "enabled",
      name: tr("extension_manager:::table::status::name", "Status"),
      description: tr("extension_manager:::table::status::description", "Is the extension enabled"),
      icon: "check-o",
      calc: (extension, tFunc) => {
        const trans = tFunc ?? t;
        switch (extension.enabled) {
          case true:
            return trans ? trans("extension_manager:::table::status::enabled") : "Enabled";
          case false:
            return trans ? trans("extension_manager:::table::status::disabled") : "Disabled";
          case "failed":
            return trans ? trans("extension_manager:::table::status::failed") : "Failed";
        }
      },
      placement: "table",
      isToggleable: false,
      edit: {
        inline: true,
        choices: () => [
          {
            key: "enabled",
            text: tr("extension_manager:::table::status::enabled", "Enabled"),
          },
          {
            key: "disabled",
            text: tr("extension_manager:::table::status::disabled", "Disabled"),
          },
          {
            key: "failed",
            text: tr("extension_manager:::table::status::failed", "Failed"),
            visible: false,
          },
        ],
        onChangeValue: (extension: IExtensionWithState, value: string) =>
          value === undefined
            ? context.onToggleExtensionEnabled(extension.name)
            : context.onSetExtensionEnabled(extension.name, value === "enabled"),
      },
      isSortable: false,
      isGroupable: true,
    },
    {
      id: "name",
      name: tr("extension_manager:::table::name::name", "Name"),
      description: tr("extension_manager:::table::name::description", "Extension Name"),
      icon: "quotes",
      calc: (extension) => extension.name,
      placement: "table",
      isToggleable: false,
      edit: {},
      isSortable: true,
      filter: new TableTextFilter(true),
    },
    {
      id: "endorsed",
      name: tr("extension_manager:::table::endorsed::name", "Endorsed"),
      description: tr(
        "extension_manager:::table::endorsed::description",
        "Endorsement state on Nexus",
      ),
      icon: "star",
      calc: (extension) => extension.endorsed,
      customRenderer: (extension: IExtensionWithState, detail: boolean, t: TFunction) =>
        !!extension.modId ? createEndorsedIcon(extension, context.onEndorseMod, t) : null,
      placement: "table",
      isToggleable: true,
      edit: {},
      isSortable: true,
      isGroupable: true,
    },
    {
      id: "author",
      name: tr("extension_manager:::table::author::name", "Author"),
      description: tr("extension_manager:::table::author::description", "Extension Author"),
      icon: "a-edit",
      calc: (extension) => extension.author,
      placement: "table",
      isToggleable: true,
      edit: {},
      isSortable: true,
      isGroupable: true,
    },
    {
      id: "description",
      name: tr("extension_manager:::table::description::name", "Description"),
      description: tr(
        "extension_manager:::table::description::description",
        "Extension Description",
      ),
      placement: "detail",
      customRenderer: (extension: IExtensionWithState) => (
        <textarea className="textarea-details" value={extension.description} readOnly={true} />
      ),
      calc: (extension) => extension.description,
      edit: {},
    },
    {
      id: "version",
      name: tr("extension_manager:::table::version::name", "Version"),
      description: tr("extension_manager:::table::version::description", "Extension Version"),
      icon: "cake",
      placement: "table",
      calc: (extension) => extension.version,
      isToggleable: true,
      edit: {},
      isSortable: false,
    },
    {
      id: "errors",
      name: tr("extension_manager:::table::errors::name", "Load Errors"),
      description: tr(
        "extension_manager:::table::errors::description",
        "Errors when loading this extension",
      ),
      icon: "bug",
      placement: "detail",
      calc: (extension, tFunc) =>
        extension.loadFailures.map((fail) => renderLoadFailure(tFunc ?? t, fail)).join("\n"),
      customRenderer: (extension: IExtensionWithState, detailCell: boolean, tFunc: TFunction) => (
        <textarea
          className="textarea-details"
          value={extension.loadFailures
            .map((fail) => renderLoadFailure(tFunc ?? t, fail))
            .join("\n")}
          readOnly={true}
        />
      ),
      edit: {},
    },
  ];
}

export default getTableAttributes;
