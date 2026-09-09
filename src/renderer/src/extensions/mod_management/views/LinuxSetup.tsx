import * as React from "react";
import {
  Alert,
  Button,
  ControlLabel,
  FormControl,
  FormGroup,
  HelpBlock,
  Panel,
  ProgressBar,
} from "react-bootstrap";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import type * as Redux from "redux";
import type { ThunkDispatch } from "redux-thunk";

import { dismissNotification } from "../../../actions/notifications";
import { setOpenMainPage } from "../../../actions/session";
import type { IExtensionApi } from "../../../types/IExtensionContext";
import type { IState } from "../../../types/IState";
import { assessLinuxEnvironment } from "../../../util/linux/environmentAssessment";
import { checkHardlinkCompatibility } from "../../../util/linux/linuxMounts";
import ProtonPaths from "../../../util/linux/ProtonPaths";
import {
  discoverAvailableProtonRuntimesAsync,
  type IProtonRuntimeOption,
} from "../../../util/linux/protonRuntimes";
import {
  type IProtonRuntimePreference,
  resolveProtonRuntimePreference,
} from "../../../util/linux/protonRuntimeSelection";
import {
  discoverLinuxSteamLibrariesAsync,
  getLinuxSteamPaths,
  isValidSteamPath,
} from "../../../util/linux/steamPaths";
import opn from "../../../util/opn";
import * as selectors from "../../../util/selectors";
import { activeGameId } from "../../../util/selectors";
import { getSafe } from "../../../util/storeHelper";
import type { IDiscoveryResult } from "../../gamemode_management/types/IDiscoveryResult";
import type { IGameStored } from "../../gamemode_management/types/IGameStored";
import { suggestStagingPathPattern } from "../../gamemode_management/util/suggestStagingPath";
import { setLinuxSetupCompleted, setProtonRuntimePreference } from "../actions/settings";
import { modPathsForGame } from "../selectors";
import type { IDeploymentMethod } from "../types/IDeploymentMethod";
import { getSupportedActivators } from "../util/deploymentMethods";
import { rankAutomaticDeploymentMethods } from "../util/deploymentRecommendation";
import {
  configurationProblems,
  detectSteamInstallationType,
  runtimePreferenceValue,
} from "../util/linuxSetupModel";

interface IBaseProps {
  activators: IDeploymentMethod[];
  api: IExtensionApi;
}

interface IConnectedProps {
  currentActivator?: string;
  discovery?: IDiscoveryResult;
  game?: IGameStored;
  gameId?: string;
  linuxSetupCompleted: boolean;
  modPaths: string[];
  preference?: IProtonRuntimePreference;
  stagingPath?: string;
  stagingDirectoryName: string;
  supportedActivatorIds: string[];
}

interface IActionProps {
  onComplete: () => void;
  onOpenHealthCheck: () => void;
  onSetPreference: (gameId: string, preference: IProtonRuntimePreference) => void;
}

type IProps = IBaseProps & IConnectedProps & IActionProps;

function LinuxSetup(props: IProps): JSX.Element {
  if (
    process.platform !== "linux" ||
    props.gameId === undefined ||
    props.discovery?.path === undefined
  ) {
    return null;
  }

  return <LinuxSetupContent {...props} />;
}

interface IDiscoveryProgress {
  completed: number;
  labelKey: string;
  total: number;
}

function LinuxSetupContent(props: IProps): JSX.Element {
  const { t } = props as IProps & { t: (key: string, options?: any) => string };

  const proton = ProtonPaths.resolve({
    discovery: props.discovery,
    game: props.game as any,
    gameMode: props.gameId,
  });
  const [runtimes, setRuntimes] = React.useState<IProtonRuntimeOption[]>([]);
  const [steamLibraries, setSteamLibraries] = React.useState<string[]>([]);
  const [discoveryError, setDiscoveryError] = React.useState<string>();
  const [discoveryProgress, setDiscoveryProgress] = React.useState<IDiscoveryProgress>();
  const discoveryController = React.useRef<AbortController>();
  const steamInstallations = React.useMemo(() => getLinuxSteamPaths().filter(isValidSteamPath), []);
  const startDiscovery = React.useCallback(() => {
    discoveryController.current?.abort();
    const controller = new AbortController();
    discoveryController.current = controller;
    setDiscoveryError(undefined);
    setDiscoveryProgress({
      completed: 0,
      labelKey: "mod_management:::linux_setup::discovery_libraries_label",
      total: steamInstallations.length,
    });

    const librariesPromise = (async () => {
      const discovered: string[] = [];
      for (const [index, steamPath] of steamInstallations.entries()) {
        const libraries = await discoverLinuxSteamLibrariesAsync(steamPath, {
          signal: controller.signal,
        });
        discovered.push(...libraries);
        setDiscoveryProgress({
          completed: index + 1,
          labelKey: "mod_management:::linux_setup::discovery_libraries_label",
          total: steamInstallations.length,
        });
      }
      return Array.from(new Set(discovered));
    })();
    const runtimesPromise = discoverAvailableProtonRuntimesAsync(proton?.steamPath, {
      onProgress: ({ completed, total }) =>
        setDiscoveryProgress({
          completed,
          labelKey: "mod_management:::linux_setup::discovery_runtimes_label",
          total,
        }),
      signal: controller.signal,
    });

    void Promise.all([librariesPromise, runtimesPromise])
      .then(([libraries, discoveredRuntimes]) => {
        if (controller.signal.aborted) return;
        setSteamLibraries(libraries);
        setRuntimes(discoveredRuntimes);
      })
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ECANCELED") {
          setDiscoveryError(error.message);
        }
      })
      .finally(() => {
        if (discoveryController.current === controller) {
          discoveryController.current = undefined;
          setDiscoveryProgress(undefined);
        }
      });
  }, [proton?.steamPath, steamInstallations]);

  React.useEffect(() => {
    startDiscovery();
    return () => discoveryController.current?.abort();
  }, [startDiscovery]);

  const resolvedRuntime = resolveProtonRuntimePreference(
    props.preference,
    proton?.protonPath,
    runtimes,
  );
  const steamType = detectSteamInstallationType(proton?.steamPath);
  const supported = props.activators
    .filter((activator) => props.supportedActivatorIds.includes(activator.id))
    .map((activator) => ({ activator, errors: [], warnings: [] }));
  const recommendation = rankAutomaticDeploymentMethods(
    supported,
    "linux",
    props.game?.capabilities?.deployment,
  );
  const stagingIsCompatible =
    props.stagingPath !== undefined &&
    checkHardlinkCompatibility(props.stagingPath, props.discovery.path) === undefined;
  const recommendedStagingPath = stagingIsCompatible
    ? props.stagingPath
    : suggestStagingPathPattern("linux", false, props.discovery.path, props.stagingDirectoryName);

  const preferenceValue = runtimePreferenceValue(props.preference);
  const effectiveRuntimePath = resolvedRuntime.path ?? proton?.protonPath;

  const selectRuntime = (event: React.ChangeEvent<any>) => {
    const value = String(event.target.value);
    if (value.startsWith("runtime:")) {
      const runtime = runtimes.find(
        (candidate) => candidate.path === value.slice("runtime:".length),
      );
      if (runtime !== undefined) {
        props.onSetPreference(props.gameId, {
          approvedPath: runtime.type === "custom" ? runtime.path : undefined,
          path: runtime.path,
          type: runtime.type,
        });
      }
    } else {
      props.onSetPreference(props.gameId, { type: value as IProtonRuntimePreference["type"] });
    }
  };

  const browseRuntime = async () => {
    const selected = await props.api.selectDir({ defaultPath: props.preference?.path });
    if (selected) {
      props.onSetPreference(props.gameId, {
        approvedPath: selected,
        path: selected,
        type: "custom",
      });
    }
  };

  const checkConfiguration = async () => {
    const assessment = assessLinuxEnvironment({
      deploymentMethodId: props.currentActivator,
      deploymentPaths: props.modPaths,
      gamePath: props.discovery.path,
      platform: "linux",
      prefixPath: proton?.prefixPath,
      stagingPath: props.stagingPath,
      steamPath: proton?.steamPath,
    });
    const problems = configurationProblems(
      assessment.issues,
      proton?.prefixPath,
      resolvedRuntime.error,
    );
    const healthCheckLabel = t("mod_management:::linux_setup::open_health_check");
    const closeLabel = t("mod_management:::linux_setup::close");
    const result = await props.api.showDialog(
      assessment.blocking || problems.some((problem) => problem.startsWith("ERROR"))
        ? "error"
        : "info",
      t("mod_management:::linux_setup::assessment_dialog_title"),
      {
        text:
          problems.length > 0
            ? problems.join("\n")
            : t("mod_management:::linux_setup::assessment_passed"),
      },
      [{ label: healthCheckLabel }, { label: closeLabel }],
    );
    if (result.action === healthCheckLabel) props.onOpenHealthCheck();
  };

  const steamTypeKey = {
    Flatpak: "mod_management:::linux_setup::steam_type::flatpak",
    Native: "mod_management:::linux_setup::steam_type::native",
    "Not detected": "mod_management:::linux_setup::steam_type::not_detected",
    Snap: "mod_management:::linux_setup::steam_type::snap",
  }[steamType];

  return (
    <Panel aria-labelledby="linux-setup-heading" id="linux-setup-assistant" role="region">
      <Panel.Body>
        <ControlLabel id="linux-setup-heading">
          {t("mod_management:::linux_setup::assistant_title")}
        </ControlLabel>
        {!props.linuxSetupCompleted ? (
          <Alert aria-live="polite" bsStyle="info">
            {t("mod_management:::linux_setup::review_alert")}
          </Alert>
        ) : null}
        <dl aria-label={t("mod_management:::linux_setup::detected_configuration")}>
          <dt>{t("mod_management:::linux_setup::steam_installation")}</dt>
          <dd>{t(steamTypeKey)}</dd>
          <dt>{t("mod_management:::linux_setup::discovered_libraries")}</dt>
          <dd>{steamLibraries.join(", ") || t("mod_management:::linux_setup::none")}</dd>
          <dt>{t("mod_management:::linux_setup::staging_path")}</dt>
          <dd>{props.stagingPath || t("mod_management:::linux_setup::not_configured")}</dd>
          <dt>{t("mod_management:::linux_setup::recommended_staging_path")}</dt>
          <dd>{recommendedStagingPath}</dd>
          <dt>{t("mod_management:::linux_setup::recommended_deployment_method")}</dt>
          <dd>
            {recommendation.activator
              ? t(recommendation.activator.name)
              : t("mod_management:::linux_setup::none")}{" "}
            — {t(recommendation.reason)}
          </dd>
          <dt>{t("mod_management:::linux_setup::proton_prefix")}</dt>
          <dd>{proton?.prefixPath || t("mod_management:::linux_setup::not_detected")}</dd>
        </dl>
        {discoveryProgress !== undefined ? (
          <FormGroup aria-atomic="true" aria-busy="true" aria-live="polite" role="status">
            <ControlLabel id="linux-discovery-progress-label">
              {t("mod_management:::linux_setup::discovering_environment")}
            </ControlLabel>
            <ProgressBar
              aria-labelledby="linux-discovery-progress-label"
              id="linux-discovery-progress"
              label={`${t(discoveryProgress.labelKey)}: ${discoveryProgress.completed}/${discoveryProgress.total}`}
              max={Math.max(discoveryProgress.total, 1)}
              now={discoveryProgress.completed}
            />
            <Button
              aria-controls="linux-discovery-progress"
              onClick={() => discoveryController.current?.abort()}
            >
              {t("mod_management:::linux_setup::cancel")}
            </Button>
          </FormGroup>
        ) : null}
        {discoveryError !== undefined ? (
          <Alert aria-atomic="true" aria-live="assertive" bsStyle="warning" role="alert">
            {t("mod_management:::linux_setup::discovery_failed")}: {discoveryError}{" "}
            <Button onClick={startDiscovery}>{t("mod_management:::linux_setup::retry")}</Button>
          </Alert>
        ) : null}
        <FormGroup validationState={resolvedRuntime.error ? "error" : undefined}>
          <ControlLabel htmlFor="linux-proton-runtime">
            {t("mod_management:::linux_setup::proton_runtime")}
          </ControlLabel>
          <FormControl
            aria-describedby={resolvedRuntime.error ? "linux-proton-runtime-error" : undefined}
            componentClass="select"
            id="linux-proton-runtime"
            value={preferenceValue}
            onChange={selectRuntime}
          >
            <option value="auto">{t("mod_management:::linux_setup::runtime_auto")}</option>
            <option value="steam-selected">
              {t("mod_management:::linux_setup::runtime_steam_selected")}
            </option>
            {runtimes.map((runtime) => (
              <option
                disabled={!runtime.isUsable}
                key={runtime.path}
                value={`runtime:${runtime.path}`}
              >
                {runtime.name} ({runtime.source})
                {runtime.isUsable
                  ? ""
                  : ` — ${t("mod_management:::linux_setup::runtime_not_executable")}`}
              </option>
            ))}
            {props.preference?.type === "custom" &&
            props.preference.path !== undefined &&
            !runtimes.some((runtime) => runtime.path === props.preference.path) ? (
              <option value={`runtime:${props.preference.path}`}>
                {t("mod_management:::linux_setup::runtime_custom")}: {props.preference.path}
              </option>
            ) : null}
          </FormControl>
          {resolvedRuntime.error && discoveryProgress === undefined ? (
            <HelpBlock id="linux-proton-runtime-error" role="alert">
              {t(resolvedRuntime.error)}
            </HelpBlock>
          ) : null}
          <Button onClick={browseRuntime}>
            {t("mod_management:::linux_setup::choose_custom_runtime")}
          </Button>{" "}
          <Button
            disabled={effectiveRuntimePath === undefined}
            onClick={() => {
              if (effectiveRuntimePath !== undefined) {
                void opn(effectiveRuntimePath).catch((err) =>
                  props.api.showErrorNotification(
                    t("mod_management:::linux_setup::open_runtime_dir_failed"),
                    err,
                  ),
                );
              }
            }}
          >
            {t("mod_management:::linux_setup::open_runtime_dir")}
          </Button>
        </FormGroup>
        <HelpBlock>{t("mod_management:::linux_setup::hardlinks_symlinks_hint")}</HelpBlock>
        <Button onClick={checkConfiguration}>
          {t("mod_management:::linux_setup::check_configuration")}
        </Button>{" "}
        {!props.linuxSetupCompleted ? (
          <Button onClick={props.onComplete}>
            {t("mod_management:::linux_setup::mark_setup_complete")}
          </Button>
        ) : null}
      </Panel.Body>
    </Panel>
  );
}

function mapStateToProps(state: IState): IConnectedProps {
  const gameId = activeGameId(state);
  return {
    currentActivator: getSafe(state, ["settings", "mods", "activator", gameId], undefined),
    discovery: gameId ? selectors.discoveryByGame(state, gameId) : undefined,
    game: gameId ? selectors.gameById(state, gameId) : undefined,
    gameId,
    linuxSetupCompleted: state.settings.mods.linuxSetupCompleted,
    modPaths: gameId ? Object.values(modPathsForGame(state, gameId)).filter(Boolean) : [],
    preference: gameId ? state.settings.mods.protonRuntime?.[gameId] : undefined,
    stagingPath: gameId ? selectors.installPathForGame(state, gameId) : undefined,
    stagingDirectoryName: state.settings.mods.suggestInstallPathDirectory,
    supportedActivatorIds: getSupportedActivators(state).map((activator) => activator.id),
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onComplete: () => {
      dispatch(setLinuxSetupCompleted(true));
      dispatch(dismissNotification("linux-first-run-setup"));
    },
    onOpenHealthCheck: () => dispatch(setOpenMainPage("health", false)),
    onSetPreference: (gameId, preference) =>
      dispatch(setProtonRuntimePreference(gameId, preference)),
  };
}

export default withTranslation(["common", "health_check", "mod_management"])(
  connect(mapStateToProps, mapDispatchToProps)(LinuxSetup),
) as React.ComponentClass<IBaseProps>;
