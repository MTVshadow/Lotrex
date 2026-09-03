import * as path from "path";

import { actions, fs, log, selectors, types, util } from "@nexusmods/vortex-api";
import I18next from "i18next";
import {} from "redux-thunk";
import IniParser, { IniFile, WinapiFormat } from "vortex-parse-ini";

import { toggleInvalidation } from "./bsaRedirection";
import { REDIRECTION_MOD } from "./constants";
import filesNewer from "./util/filesNewer";
import {
  archiveListKey,
  bsaVersion,
  fileFilter,
  iniPath,
  initGameSupport,
  isSupported,
  targetAge,
} from "./util/gameSupport";
import Settings from "./views/Settings";

/**
 * Автоматична перевірка та встановлення bInvalidateOlderFiles=1
 * для Bethesda ігор (особливо критично під Proton на Linux, де ванільні INI
 * ігнорують розгорнуті loose files).
 */
async function ensureArchiveInvalidation(
  api: types.IExtensionApi,
  gameMode: string,
): Promise<void> {
  if (!isSupported(gameMode)) {
    return;
  }
  const mainIni = iniPath(gameMode);
  const customIniName = gameMode.startsWith("skyrim")
    ? "SkyrimCustom.ini"
    : gameMode.startsWith("fallout4")
      ? "Fallout4Custom.ini"
      : undefined;

  const inisToCheck = [mainIni];
  if (customIniName) {
    inisToCheck.push(path.join(path.dirname(mainIni), customIniName));
  }

  const parser = new IniParser(new WinapiFormat() as any);
  for (const targetPath of inisToCheck) {
    try {
      const exists = await fs
        .statAsync(targetPath)
        .then(() => true)
        .catch(() => false);
      let ini: any;
      if (exists) {
        ini = await parser.read(targetPath);
      } else if (customIniName && targetPath.endsWith(customIniName)) {
        ini = new IniFile({});
        ini.data = {};
      } else {
        continue;
      }

      if (ini.data.Archive === undefined) {
        ini.data.Archive = {};
      }
      const archive = ini.data.Archive;
      const bInvalidate = archive.bInvalidateOlderFiles;
      if (bInvalidate !== 1 && bInvalidate !== "1") {
        archive.bInvalidateOlderFiles = 1;
        if (archive.sResourceDataDirsFinal === undefined) {
          archive.sResourceDataDirsFinal = "";
        }
        await fs.ensureDirAsync(path.dirname(targetPath));
        await parser.write(targetPath, ini);
        log("info", "Automatically ensured bInvalidateOlderFiles=1 in Bethesda game INI", {
          gameMode,
          targetPath,
        });
      }
    } catch (err: any) {
      log("warn", "Failed to auto-configure archive invalidation INI", {
        gameMode,
        targetPath,
        error: err.message,
      });
    }
  }
}

function testArchivesAge(api: types.IExtensionApi) {
  const state: types.IState = api.store.getState();
  const gameId = selectors.activeGameId(state);

  if (!isSupported(gameId)) {
    return Promise.resolve(undefined);
  }

  const gamePath: string = util.getSafe(
    state,
    ["settings", "gameMode", "discovered", gameId, "path"],
    undefined,
  );

  if (gamePath === undefined) {
    // TODO: happened in testing, but how does one get here with no path configured?
    return Promise.resolve(undefined);
  }

  const game = util.getGame(gameId);
  const dataPath = game.getModPaths(gamePath)[""];

  const age = targetAge(gameId);
  if (age === undefined) {
    return Promise.resolve(undefined);
  }

  const t = api.translate;
  return filesNewer(dataPath, fileFilter(gameId), age)
    .then((files: string[]) => {
      if (files.length === 0) {
        return Promise.resolve(undefined);
      }
      return Promise.all(
        files.map((file) =>
          fs.utimesAsync(path.join(dataPath, file), age.getTime() / 1000, age.getTime() / 1000),
        ),
      ).then(() => {
        log("info", `Updated timestamps on ${files.length} archive files for game ${gameId}`);
        return Promise.resolve(undefined);
      });
    })
    .catch((err: Error) => {
      const canceled = err instanceof util.ProcessCanceled || err instanceof util.UserCanceled;
      api.showErrorNotification("Failed to read bsa/ba2 files.", err, {
        allowReport: !canceled && !["ENOENT", "EPERM"].includes((err as any).code),
      });
      return Promise.resolve(undefined);
    });
}

function applyIniSettings(
  api: types.IExtensionApi,
  profile: types.IProfile,
  iniFile: IniFile<any>,
) {
  if (iniFile.data.Archive === undefined) {
    iniFile.data.Archive = {};
  }
  iniFile.data.Archive.bInvalidateOlderFiles = 1;
  iniFile.data.Archive.sResourceDataDirsFinal = "";
}

interface IToDoProps {
  gameMode: string;
  mods: { [id: string]: types.IMod };
}

function useBSARedirection(gameMode: string) {
  return isSupported(gameMode) && bsaVersion(gameMode) !== undefined;
}

function init(context: types.IExtensionContext): boolean {
  initGameSupport(context.api);
  context.registerTest(
    "archive-backdate",
    "gamemode-activated",
    () => testArchivesAge(context.api) as any,
  );
  context.registerTest("archive-invalidation-auto", "gamemode-activated", () => {
    const gameMode = selectors.activeGameId(context.api.store.getState());
    return ensureArchiveInvalidation(context.api, gameMode).then(() => undefined) as any;
  });

  context.registerToDo(
    "bsa-redirection",
    "workaround",
    (state: types.IState): IToDoProps => {
      const gameMode = selectors.activeGameId(state);
      return {
        gameMode,
        mods: util.getSafe(state, ["persistent", "mods", gameMode], {}),
      };
    },
    "workaround",
    "Archive Invalidation",
    (props: IToDoProps) => toggleInvalidation(context.api, props.gameMode),
    (props: IToDoProps) => useBSARedirection(props.gameMode),
    (t: typeof I18next.t, props: IToDoProps) =>
      props.mods[REDIRECTION_MOD] !== undefined ? t("Yes") : t("No"),
    undefined,
  );

  (context.registerSettings as any)("Workarounds", Settings, undefined, () =>
    useBSARedirection(selectors.activeGameId(context.api.store.getState())),
  );

  context.once(() => {
    context.api.events.on("did-deploy", (profileId: string) => {
      const state = context.api.store.getState();
      const profile = selectors.profileById(state, profileId);
      if (profile?.gameId) {
        void ensureArchiveInvalidation(context.api, profile.gameId);
      }
    });

    context.api.onAsync(
      "apply-settings",
      (profile: types.IProfile, filePath: string, ini: IniFile<any>) => {
        log("debug", "apply AI settings", { gameId: profile.gameId, filePath });
        if (
          isSupported(profile.gameId) &&
          filePath.toLowerCase() === iniPath(profile.gameId).toLowerCase()
        ) {
          applyIniSettings(context.api, profile, ini);
        }
        return Promise.resolve();
      },
    );
  });

  return true;
}

export default init;
