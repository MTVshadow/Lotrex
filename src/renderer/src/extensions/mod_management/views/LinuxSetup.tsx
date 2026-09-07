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
  label: string;
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
      label: "Steam libraries",
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
          label: "Steam libraries",
          total: steamInstallations.length,
        });
      }
      return Array.from(new Set(discovered));
    })();
    const runtimesPromise = discoverAvailableProtonRuntimesAsync(proton?.steamPath, {
      onProgress: ({ completed, total }) =>
        setDiscoveryProgress({ completed, label: "Proton runtimes", total }),
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
    const result = await props.api.showDialog(
      assessment.blocking || problems.some((problem) => problem.startsWith("ERROR"))
        ? "error"
        : "info",
      "Linux configuration assessment",
      { text: problems.length > 0 ? problems.join("\n") : "Configuration checks passed." },
      [{ label: "Open Health Check" }, { label: "Close" }],
    );
    if (result.action === "Open Health Check") props.onOpenHealthCheck();
  };

  return (
    <Panel aria-labelledby="linux-setup-heading" id="linux-setup-assistant" role="region">
      <Panel.Body>
        <ControlLabel id="linux-setup-heading">{t("Linux setup assistant")}</ControlLabel>
        {!props.linuxSetupCompleted ? (
          <Alert aria-live="polite" bsStyle="info">
            {t("Review this configuration before your first deployment.")}
          </Alert>
        ) : null}
        <dl aria-label={t("Detected Linux configuration")}>
          <dt>{t("Steam installation")}</dt>
          <dd>{t(steamType)}</dd>
          <dt>{t("Discovered Steam libraries")}</dt>
          <dd>{steamLibraries.join(", ") || t("None")}</dd>
          <dt>{t("Staging path")}</dt>
          <dd>{props.stagingPath || t("Not configured")}</dd>
          <dt>{t("Recommended staging path")}</dt>
          <dd>{recommendedStagingPath}</dd>
          <dt>{t("Recommended deployment method")}</dt>
          <dd>
            {recommendation.activator ? t(recommendation.activator.name) : t("None")} —{" "}
            {t(recommendation.reason)}
          </dd>
          <dt>{t("Proton prefix")}</dt>
          <dd>{proton?.prefixPath || t("Not detected")}</dd>
        </dl>
        {discoveryProgress !== undefined ? (
          <FormGroup aria-atomic="true" aria-busy="true" aria-live="polite" role="status">
            <ControlLabel id="linux-discovery-progress-label">
              {t("Discovering Linux environment")}
            </ControlLabel>
            <ProgressBar
              aria-labelledby="linux-discovery-progress-label"
              id="linux-discovery-progress"
              label={`${t(discoveryProgress.label)}: ${discoveryProgress.completed}/${discoveryProgress.total}`}
              max={Math.max(discoveryProgress.total, 1)}
              now={discoveryProgress.completed}
            />
            <Button
              aria-controls="linux-discovery-progress"
              onClick={() => discoveryController.current?.abort()}
            >
              {t("Cancel")}
            </Button>
          </FormGroup>
        ) : null}
        {discoveryError !== undefined ? (
          <Alert aria-atomic="true" aria-live="assertive" bsStyle="warning" role="alert">
            {t("Linux environment discovery failed")}: {discoveryError}{" "}
            <Button onClick={startDiscovery}>{t("Retry")}</Button>
          </Alert>
        ) : null}
        <FormGroup validationState={resolvedRuntime.error ? "error" : undefined}>
          <ControlLabel htmlFor="linux-proton-runtime">{t("Proton runtime")}</ControlLabel>
          <FormControl
            aria-describedby={resolvedRuntime.error ? "linux-proton-runtime-error" : undefined}
            componentClass="select"
            id="linux-proton-runtime"
            value={preferenceValue}
            onChange={selectRuntime}
          >
            <option value="auto">{t("Automatic")}</option>
            <option value="steam-selected">{t("Steam-selected")}</option>
            {runtimes.map((runtime) => (
              <option
                disabled={!runtime.isUsable}
                key={runtime.path}
                value={`runtime:${runtime.path}`}
              >
                {runtime.name} ({runtime.source})
                {runtime.isUsable ? "" : ` — ${t("Not executable")}`}
              </option>
            ))}
            {props.preference?.type === "custom" &&
            props.preference.path !== undefined &&
            !runtimes.some((runtime) => runtime.path === props.preference.path) ? (
              <option value={`runtime:${props.preference.path}`}>
                {t("Custom")}: {props.preference.path}
              </option>
            ) : null}
          </FormControl>
          {resolvedRuntime.error && discoveryProgress === undefined ? (
            <HelpBlock id="linux-proton-runtime-error" role="alert">
              {t(resolvedRuntime.error)}
            </HelpBlock>
          ) : null}
          <Button onClick={browseRuntime}>{t("Choose custom runtime")}</Button>{" "}
          <Button
            disabled={effectiveRuntimePath === undefined}
            onClick={() => {
              if (effectiveRuntimePath !== undefined) {
                void opn(effectiveRuntimePath).catch((err) =>
                  props.api.showErrorNotification("Failed to open Proton runtime directory", err),
                );
              }
            }}
          >
            {t("Open runtime directory")}
          </Button>
        </FormGroup>
        <HelpBlock>
          {t(
            "Hardlinks are fastest and require staging and the game on the same filesystem. Symlinks can cross filesystems but may be restricted by the destination or sandbox.",
          )}
        </HelpBlock>
        <Button onClick={checkConfiguration}>{t("Check configuration")}</Button>{" "}
        {!props.linuxSetupCompleted ? (
          <Button onClick={props.onComplete}>{t("Mark setup complete")}</Button>
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

export default withTranslation(["common", "health_check"])(
  connect(mapStateToProps, mapDispatchToProps)(LinuxSetup),
) as React.ComponentClass<IBaseProps>;
