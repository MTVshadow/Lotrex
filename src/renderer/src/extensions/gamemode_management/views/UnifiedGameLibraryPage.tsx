import * as path from "node:path";

import React, { useCallback, useMemo, useReducer } from "react";
import { shallowEqual, useDispatch, useSelector } from "react-redux";

import { useExtensionContext } from "../../../ExtensionProvider";
import type { IState } from "../../../types/IState";
import { buildLegacyUnifiedLibrary } from "../../../util/linux/integration/legacyGameBridge";
import type {
  IManualCorrectionRecord,
  IUnifiedLibraryItem,
} from "../../../util/linux/unifiedLibrary/contracts";
import { UnifiedLibraryService } from "../../../util/linux/unifiedLibrary/unifiedLibraryService";
import { showError } from "../../../util/message";
import StarterInfo from "../../../util/StarterInfo";
import { Page } from "../../../views/components/Page/Page";
import { UnifiedLibraryView } from "../../../views/UnifiedLibraryView";

const selectKnownGames = (state: IState) => state.session.gameMode.known ?? [];
const selectDiscoveredGames = (state: IState) => state.settings.gameMode.discovered ?? {};
const selectProfiles = (state: IState) => state.persistent.profiles ?? {};

/**
 * Production bridge for the experimental Lotrex library. It deliberately consumes the existing
 * Vortex discovery/profile/launch paths while the new contracts mature behind them.
 */
export const UnifiedGameLibraryPage = () => {
  const dispatch = useDispatch();
  const extensions = useExtensionContext();
  const api = extensions.getApi();
  const knownGames = useSelector(selectKnownGames, shallowEqual);
  const discoveredGames = useSelector(selectDiscoveredGames, shallowEqual);
  const profiles = useSelector(selectProfiles, shallowEqual);
  const [correctionRevision, refreshCorrections] = useReducer((value: number) => value + 1, 0);
  const service = useMemo(() => new UnifiedLibraryService(), []);

  const bridge = useMemo(
    () => buildLegacyUnifiedLibrary(knownGames, discoveredGames, profiles),
    [knownGames, discoveredGames, profiles],
  );
  const items = useMemo(
    () => service.buildLibrary(bridge.installations, bridge.adapterRegistry),
    [bridge, correctionRevision, service],
  );

  const launch = useCallback(
    (item: IUnifiedLibraryItem) => {
      const game = knownGames.find((candidate) => candidate.id === item.gameId);
      const discovery = discoveredGames[item.gameId];
      if (!game || !discovery?.path) {
        showError(
          dispatch,
          "Game launch is unavailable",
          "The existing game discovery record is missing.",
          { allowReport: false },
        );
        return;
      }

      try {
        const starter = new StarterInfo(game, discovery);
        if (item.manualCorrection) {
          starter.exePath = item.executablePath;
          starter.workingDirectory = path.dirname(item.executablePath);
          starter.commandLine =
            item.manualCorrection.overrides.customLaunchArgs ?? starter.commandLine;
          starter.environment = {
            ...starter.environment,
            ...(item.prefixPath ? { WINEPREFIX: item.prefixPath } : {}),
            ...(item.runtime.runtimePath ? { VORTEX_PROTON_PATH: item.runtime.runtimePath } : {}),
          };
        }
        StarterInfo.run(starter, api, (message, details, allowReport) =>
          showError(dispatch, message, details, { allowReport }),
        );
      } catch (error) {
        showError(dispatch, "Failed to prepare game launch", error, { allowReport: true });
      }
    },
    [api, discoveredGames, dispatch, knownGames],
  );

  const applyCorrection = useCallback(
    (itemId: string, overrides: IManualCorrectionRecord["overrides"], reason?: string) => {
      const installation = bridge.installations.find(
        (candidate) => candidate.installationId === itemId,
      );
      if (!installation) return;
      service.manualCorrections.applyCorrection(installation, overrides, reason);
      refreshCorrections();
    },
    [bridge.installations, service],
  );

  const revertCorrection = useCallback(
    (itemId: string) => {
      service.manualCorrections.revertCorrection(itemId);
      refreshCorrections();
    },
    [service],
  );

  return (
    <Page isFullWidth pageId="lotrex-game-library">
      <UnifiedLibraryView
        items={items}
        service={service}
        onApplyCorrection={applyCorrection}
        onLaunch={launch}
        onRevertCorrection={revertCorrection}
      />
    </Page>
  );
};
