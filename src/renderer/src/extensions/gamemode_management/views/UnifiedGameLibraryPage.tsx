import * as path from "node:path";

import { getErrorMessageOrDefault } from "@vortex/shared";
import React, { useCallback, useEffect, useMemo, useReducer, useState } from "react";
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
import { removeUnifiedLibraryCorrection, setUnifiedLibraryCorrection } from "../actions/settings";
import type { IQuickDiscoveryResult } from "../types/IQuickDiscoveryResult";

const EMPTY_CORRECTIONS = {};

const selectKnownGames = (state: IState) => state.session.gameMode.known ?? [];
const selectDiscoveredGames = (state: IState) => state.settings.gameMode.discovered ?? {};
const selectProfiles = (state: IState) => state.persistent.profiles ?? {};
const selectDiscoveryRunning = (state: IState) => state.session.discovery.running;
const selectLibraryCorrections = (state: IState) =>
  state.settings.gameMode.unifiedLibraryCorrections ?? EMPTY_CORRECTIONS;

/**
 * Production bridge for the experimental Lotrex library. It deliberately consumes the existing
 * Vortex discovery/profile/launch paths while the new contracts mature behind them.
 */
export const UnifiedGameLibraryPage = ({
  active,
  pageId,
}: {
  active?: boolean;
  pageId?: string;
}) => {
  const dispatch = useDispatch();
  const extensions = useExtensionContext();
  const api = extensions.getApi();
  const knownGames = useSelector(selectKnownGames, shallowEqual);
  const discoveredGames = useSelector(selectDiscoveredGames, shallowEqual);
  const profiles = useSelector(selectProfiles, shallowEqual);
  const discoveryRunning = useSelector(selectDiscoveryRunning);
  const persistedCorrections = useSelector(selectLibraryCorrections, shallowEqual);
  const [refreshRequested, setRefreshRequested] = useState(false);
  const [refreshError, setRefreshError] = useState<string>();
  const [correctionRevision, refreshCorrections] = useReducer((value: number) => value + 1, 0);
  const service = useMemo(() => new UnifiedLibraryService(), []);

  useEffect(() => {
    service.manualCorrections.replaceCorrections(persistedCorrections);
    refreshCorrections();
  }, [persistedCorrections, service]);

  const bridge = useMemo(
    () => buildLegacyUnifiedLibrary(knownGames, discoveredGames, profiles),
    [knownGames, discoveredGames, profiles],
  );
  const libraryResult = useMemo(() => {
    try {
      return {
        error: undefined,
        items: service.buildLibrary(bridge.installations, bridge.adapterRegistry),
      };
    } catch (error) {
      return {
        error: getErrorMessageOrDefault(error),
        items: [],
      };
    }
  }, [bridge, correctionRevision, service]);

  const refreshLibrary = useCallback(() => {
    setRefreshRequested(true);
    setRefreshError(undefined);
    try {
      api.events.emit(
        "start-quick-discovery",
        (_gameIds: string[], result?: IQuickDiscoveryResult) => {
          setRefreshRequested(false);
          if (result?.status === "failed") {
            setRefreshError(result.error.message);
          }
        },
      );
    } catch (error) {
      setRefreshRequested(false);
      setRefreshError(getErrorMessageOrDefault(error));
      showError(dispatch, "Failed to refresh the game library", error, { allowReport: true });
    }
  }, [api.events, dispatch]);

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
      const persistedRecord = service.manualCorrections.getPersistableCorrection(itemId);
      if (persistedRecord !== null) {
        dispatch(setUnifiedLibraryCorrection(persistedRecord));
      }
      refreshCorrections();
    },
    [bridge.installations, dispatch, service],
  );

  const revertCorrection = useCallback(
    (itemId: string) => {
      service.manualCorrections.revertCorrection(itemId);
      dispatch(removeUnifiedLibraryCorrection(itemId));
      refreshCorrections();
    },
    [dispatch, service],
  );

  return (
    <Page active={active} isFullWidth pageId={pageId ?? "lotrex-game-library"}>
      <UnifiedLibraryView
        error={libraryResult.error ?? refreshError}
        isLoading={(discoveryRunning || refreshRequested) && libraryResult.items.length === 0}
        isRefreshing={(discoveryRunning || refreshRequested) && libraryResult.items.length > 0}
        items={libraryResult.items}
        service={service}
        onApplyCorrection={applyCorrection}
        onLaunch={launch}
        onRefresh={refreshLibrary}
        onRevertCorrection={revertCorrection}
      />
    </Page>
  );
};
