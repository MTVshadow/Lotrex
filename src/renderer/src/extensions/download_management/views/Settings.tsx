import * as path from "path";

import { getErrorMessageOrDefault } from "@vortex/shared";
import PromiseBB from "bluebird";
import * as React from "react";
import {
  Button as BSButton,
  ControlLabel,
  FormControl,
  FormGroup,
  HelpBlock,
  InputGroup,
  Jumbotron,
  Modal,
  ProgressBar,
} from "react-bootstrap";
import type * as Redux from "redux";
import type { ThunkDispatch } from "redux-thunk";

import { showDialog } from "../../../actions/notifications";
import { ComponentEx, connect, translate } from "../../../controls/ComponentEx";
import FlexLayout from "../../../controls/FlexLayout";
import FormInput from "../../../controls/FormInput";
import Icon from "../../../controls/Icon";
import Image from "../../../controls/Image";
import More from "../../../controls/More";
import Spinner from "../../../controls/Spinner";
import Toggle from "../../../controls/Toggle";
import { Button } from "../../../controls/TooltipControls";
import type {
  DialogActions,
  DialogType,
  IDialogContent,
  IDialogResult,
} from "../../../types/IDialog";
import type { IDownload, IState } from "../../../types/IState";
import type { ValidationState } from "../../../types/ITableAttribute";
import {
  CleanupFailedException,
  InsufficientDiskSpace,
  NotFound,
  ProcessCanceled,
  UnsupportedOperatingSystem,
  UserCanceled,
} from "../../../util/CustomErrors";
import { withTrackedActivity } from "../../../util/errorHandling";
import * as fs from "../../../util/fs";
import getNormalizeFunc from "../../../util/getNormalizeFunc";
import getVortexPath from "../../../util/getVortexPath";
import { log } from "../../../util/log";
import { showError } from "../../../util/message";
import opn from "../../../util/opn";
import * as selectors from "../../../util/selectors";
import { getSafe } from "../../../util/storeHelper";
import { cleanFailedTransfer, testPathTransfer, transferPath } from "../../../util/transferPath";
import {
  Campaign,
  ciEqual,
  isChildPath,
  isPathValid,
  isReservedDirectory,
  nexusModsURL,
  Section,
  Content,
} from "../../../util/util";
import { PREMIUM_PATH } from "../../nexus_integration/constants";
import {
  setCopyOnIFF,
  setDownloadPath,
  setMaxBandwidth,
  setMaxDownloads,
  setCollectionConcurrency,
} from "../actions/settings";
import { setTransferDownloads } from "../actions/transactions";
import { DOWNLOADS_DIR_TAG, writeDownloadsTag } from "../util/downloadDirectory";
import getDownloadPath, { getDownloadPathPattern } from "../util/getDownloadPath";

const MB = 1024 * 1024;
const CANCEL_ACTION = "download_management:::settings::actions::cancel";

interface IConnectedProps {
  parallelDownloads: number;
  isPremium: boolean;
  downloadPath: string;
  modsInstallPath: string;
  downloads: { [downloadId: string]: IDownload };
  instanceId: string;
  copyOnIFF: boolean;
  maxBandwidth: number;
  collectionsInstallWhileDownloading: boolean;
}

interface IActionProps {
  onSetDownloadPath: (newPath: string) => void;
  onSetTransfer: (dest: string) => void;
  onSetMaxDownloads: (value: number) => void;
  onShowDialog: (
    type: DialogType,
    title: string,
    content: IDialogContent,
    actions: DialogActions,
  ) => PromiseBB<IDialogResult>;
  onShowError: (
    message: string,
    details: string | Error,
    allowReport: boolean,
    isBBCode?: boolean,
  ) => void;
  onSetCopyOnIFF: (enabled: boolean) => void;
  onSetMaxBandwidth: (bps: number) => void;
  onSetCollectionConcurrency: (enabled: boolean) => void;
}

type IProps = IActionProps & IConnectedProps;

interface IComponentState {
  downloadPath: string;
  busy: string;
  progress: number;
  progressFile: string;
}

const nop = () => null;

class Settings extends ComponentEx<IProps, IComponentState> {
  private mLastFileUpdate: number = 0;
  constructor(props: IProps) {
    super(props);

    this.initState({
      downloadPath: props.downloadPath,
      busy: undefined,
      progress: 0,
      progressFile: undefined,
    });
  }

  public UNSAFE_componentWillReceiveProps(newProps: IProps) {
    if (this.props.downloadPath !== newProps.downloadPath) {
      this.nextState.downloadPath = newProps.downloadPath;
    }
  }

  public render(): JSX.Element {
    const { t, copyOnIFF, downloads, isPremium, maxBandwidth, parallelDownloads } = this.props;
    const { downloadPath, progress, progressFile } = this.state;

    const pathPreview = getDownloadPath(downloadPath);
    const changed = !ciEqual(getDownloadPath(this.props.downloadPath), pathPreview);
    const validationState = this.validateDownloadPath(pathPreview);

    const pathValid = validationState.state !== "error";
    const electricBoltIconPath = "assets/icons/electric-bolt.svg";

    const hasActivity =
      Object.keys(downloads).find((dlId) => downloads[dlId].state === "started") !== undefined;

    return (
      // Supressing default form submission event.
      <form onSubmit={this.submitEvt}>
        <FormGroup validationState={validationState.state}>
          <div id="download-path-form">
            <ControlLabel>
              {t("download_management:::settings::folder::label")}
              <More id="more-paths" name={t("download_management:::settings::folder::label")}>
                {t("download_management:::settings::folder::description")}
              </More>
            </ControlLabel>
            <FlexLayout type="row" fill={false} className="download-path-row">
              <FlexLayout.Fixed>
                <InputGroup>
                  <FormControl
                    className="download-path-input"
                    value={getDownloadPathPattern(downloadPath)}
                    placeholder={t("download_management:::settings::folder::placeholder")}
                    onChange={this.setDownloadPathEvt as any}
                    onKeyPress={changed && pathValid ? this.keyPressEvt : null}
                  />
                  <InputGroup.Button className="inset-btn">
                    <Button
                      tooltip={t("download_management:::settings::folder::browse")}
                      onClick={this.browseDownloadPath}
                    >
                      <Icon name="browse" />
                    </Button>
                  </InputGroup.Button>
                </InputGroup>
              </FlexLayout.Fixed>
              <FlexLayout.Fixed>
                <InputGroup.Button>
                  <BSButton
                    disabled={!changed || validationState.state === "error" || hasActivity}
                    onClick={this.onApply}
                  >
                    {hasActivity ? <Spinner /> : t("download_management:::settings::folder::apply")}
                  </BSButton>
                </InputGroup.Button>
              </FlexLayout.Fixed>
            </FlexLayout>
            <HelpBlock>
              <a data-url={pathPreview} onClick={this.openUrl}>
                {pathPreview}
              </a>
            </HelpBlock>
            {validationState.reason ? (
              <ControlLabel>{t(validationState.reason)}</ControlLabel>
            ) : null}
            <Modal show={this.state.busy !== undefined} onHide={nop}>
              <Modal.Body>
                <Jumbotron>
                  <div className="container">
                    <h2>{this.state.busy}</h2>
                    {progressFile !== undefined ? <p>{progressFile}</p> : null}
                    <ProgressBar style={{ height: "1.5em" }} now={progress} max={100} />
                  </div>
                </Jumbotron>
              </Modal.Body>
            </Modal>
          </div>
        </FormGroup>
        <FormGroup>
          <ControlLabel>
            {t("download_management:::settings::threads::label_with_count", {
              replace: { count: parallelDownloads },
            })}
            <More
              id="more-download-threads"
              name={t("download_management:::settings::threads::label")}
            >
              {t("download_management:::settings::threads::description")}
            </More>
          </ControlLabel>
          <div style={{ display: "flex" }}>
            <FormControl
              type="range"
              value={parallelDownloads}
              min={1}
              max={10}
              onChange={this.onChangeParallelDownloads}
              disabled={!isPremium}
            />
            {!isPremium ? (
              <BSButton id="get-premium-button" onClick={this.goBuyPremium}>
                <Image srcs={[electricBoltIconPath]} />
                {t("download_management:::settings::threads::unlock_speed")}
              </BSButton>
            ) : null}
          </div>
          <div>
            {!isPremium ? (
              <p>{t("download_management:::settings::threads::premium_limit")}</p>
            ) : null}
          </div>
        </FormGroup>
        <FormGroup id="download-bandwidth-limit">
          <ControlLabel>{t("download_management:::settings::bandwidth::label")}</ControlLabel>
          <div style={{ display: "flex", alignItems: "center" }}>
            <FormInput
              value={maxBandwidth > 0 ? (maxBandwidth / MB).toString() : ""}
              placeholder={t("download_management:::settings::bandwidth::unlimited")}
              onChange={this.changeMaxBandwidth}
              type="number"
              min={0}
            />
            {t("download_management:::settings::bandwidth::unit")}
          </div>
        </FormGroup>
        <FormGroup>
          <Toggle
            checked={this.props.collectionsInstallWhileDownloading}
            onToggle={this.toggleCollectionInstallConcurrency}
          >
            {t("download_management:::settings::collections::install_while_downloading")}
          </Toggle>
          <Toggle checked={copyOnIFF} onToggle={this.toggleCopyOnIFF}>
            {t("download_management:::settings::install_from_file::copy_files")}
          </Toggle>
        </FormGroup>
      </form>
    );
  }

  private changeMaxBandwidth = (input: string) => {
    if (input.length === 0) {
      this.props.onSetMaxBandwidth(0);
    } else {
      this.props.onSetMaxBandwidth(parseFloat(input) * MB);
    }
  };

  private toggleCopyOnIFF = (newValue: boolean) => {
    this.props.onSetCopyOnIFF(newValue);
  };

  private toggleCollectionInstallConcurrency = (newValue: boolean) => {
    this.props.onSetCollectionConcurrency(newValue);
  };

  private isPathSensible(input: string): boolean {
    const sanitizeSep = new RegExp("/", "g");
    const trimTrailingSep = new RegExp(`\\${path.sep}*$`, "g");
    if (process.platform === "win32") {
      // Ensure the user isn't trying to set the partition's root path
      //  as the staging folder.
      input = input.replace(sanitizeSep, path.sep).replace(trimTrailingSep, "");
      const splitInp = input.split(path.sep);
      return splitInp.length > 1
        ? true
        : splitInp[0].length === 2 && splitInp[0][1] === ":"
          ? false
          : true;
    } else {
      // Currently not imposing any restrictions on non-windows platforms.
      return true;
    }
  }

  private validateDownloadPath(input: string): {
    state: ValidationState;
    reason?: string;
  } {
    const { modsInstallPath } = this.props;

    if (modsInstallPath !== undefined) {
      const normalizedInstallPath = path.normalize(modsInstallPath.toLowerCase());
      const normalizedInput = path.normalize(input.toLowerCase());
      if (normalizedInstallPath === normalizedInput || isChildPath(input, modsInstallPath)) {
        return {
          state: "error",
          reason: "download_management:::settings::validation::inside_staging_folder",
        };
      }
    }

    if (isReservedDirectory(input)) {
      return {
        state: "error",
        reason: "download_management:::settings::validation::reserved_directory",
      };
    }

    if (isChildPath(input, getVortexPath("application"))) {
      return {
        state: "error",
        reason: "download_management:::settings::validation::inside_application_folder",
      };
    }

    if (input.length > 100) {
      return {
        state: input.length > 200 ? "error" : "warning",
        reason: "download_management:::settings::validation::path_too_long",
      };
    }

    if (!path.isAbsolute(input)) {
      return {
        state: "error",
        reason: "download_management:::settings::validation::absolute_path_required",
      };
    }

    if (!isPathValid(input)) {
      return {
        state: "error",
        reason: "download_management:::settings::validation::illegal_characters",
      };
    }

    if (!this.isPathSensible(input)) {
      return {
        state: "error",
        reason: "download_management:::settings::validation::partition_root",
      };
    }

    return {
      state: "success",
    };
  }

  private submitEvt = (evt) => {
    evt.preventDefault();
  };

  private keyPressEvt = (evt) => {
    if (evt.which === 13) {
      evt.preventDefault();
      this.onApply();
    }
  };

  private onApply = () => {
    getNormalizeFunc(getDownloadPath(this.state.downloadPath)).then((normalize) =>
      this.apply(normalize),
    );
  };

  private openUrl = (evt) => {
    const url = evt.currentTarget.getAttribute("data-url");
    opn(url).catch((err) => undefined);
  };

  private goBuyPremium = () => {
    opn(
      nexusModsURL(PREMIUM_PATH, {
        section: Section.Users,
        campaign: Campaign.BuyPremium,
        content: Content.SettingsDownloadAd,
      }),
    ).catch(() => null);
  };

  private setDownloadPath = (newPath: string) => {
    this.nextState.downloadPath = newPath;
  };

  private setDownloadPathEvt = (evt) => {
    this.setDownloadPath(evt.currentTarget.value);
  };

  private browseDownloadPath = () => {
    this.context.api.selectDir({}).then((selectedPath: string) => {
      if (selectedPath) {
        this.setDownloadPath(selectedPath);
      }
    });
  };

  private onChangeParallelDownloads = (evt) => {
    const { onSetMaxDownloads } = this.props;
    onSetMaxDownloads(evt.currentTarget.value);
  };

  private apply = (normalize: (input: string) => string) => {
    const { t, onSetDownloadPath, onShowDialog, onShowError, onSetTransfer } = this.props;
    const newPath: string = getDownloadPath(this.state.downloadPath);
    const oldPath: string = getDownloadPath(this.props.downloadPath);

    const vortexPath = getVortexPath("application");

    try {
      const statNew = fs.statSync(newPath, { bigint: true });
      const statOld = fs.statSync(oldPath, { bigint: true });
      if (statNew.ino === statOld.ino) {
        return onShowDialog(
          "error",
          "download_management:::settings::transfer::invalid_path::title",
          {
            text: "download_management:::settings::transfer::invalid_path::same_directory",
          },
          [{ label: "download_management:::settings::actions::close" }],
        );
      }
    } catch (err) {
      // new directory doesn't exist. good
    }

    if (isReservedDirectory(newPath)) {
      return onShowDialog(
        "error",
        "download_management:::settings::transfer::invalid_path::title",
        {
          text: "download_management:::settings::transfer::invalid_path::reserved_directory",
        },
        [{ label: "download_management:::settings::actions::close" }],
      );
    }

    if (!path.isAbsolute(newPath) || isChildPath(newPath, vortexPath, normalize)) {
      return onShowDialog(
        "error",
        "download_management:::settings::transfer::invalid_path::title",
        {
          text: "download_management:::settings::transfer::invalid_path::application_directory",
        },
        [{ label: "download_management:::settings::actions::close" }],
      );
    }

    if (isChildPath(oldPath, newPath, normalize)) {
      return onShowDialog(
        "error",
        "download_management:::settings::transfer::invalid_path::title",
        {
          text: "download_management:::settings::transfer::invalid_path::parent_of_old_folder",
        },
        [{ label: "download_management:::settings::actions::close" }],
      );
    }

    const notEnoughDiskSpace = () => {
      return onShowDialog(
        "error",
        "download_management:::settings::transfer::disk_space::title",
        {
          text: "download_management:::settings::transfer::disk_space::description",
        },
        [{ label: "download_management:::settings::actions::close" }],
      );
    };

    let deleteOldDestination = true;
    this.nextState.progress = 0;
    this.nextState.busy = t("download_management:::settings::transfer::progress::moving");
    return withTrackedActivity(
      "vortex.downloads",
      "downloads.transfer",
      {
        "downloads.transfer.from": oldPath,
        "downloads.transfer.to": newPath,
      },
      (_setAttribute, _setError) =>
        testPathTransfer(oldPath, newPath)
          .then(() => fs.ensureDirWritableAsync(newPath, this.confirmElevate))
          .then(() => this.checkTargetEmpty(oldPath, newPath))
          .then(() => {
            if (oldPath !== newPath) {
              this.nextState.busy = t(
                "download_management:::settings::transfer::progress::moving_folder",
              );
              return this.transferPath().then(() => writeDownloadsTag(this.context.api, newPath));
            } else {
              return PromiseBB.resolve();
            }
          })
          .then(() => {
            onSetTransfer(undefined);
            onSetDownloadPath(this.state.downloadPath);
            this.context.api.events.emit("did-move-downloads");
          })
          .catch(UserCanceled, () => null)
          .catch(CleanupFailedException, (err) => {
            deleteOldDestination = false;
            onSetTransfer(undefined);
            onSetDownloadPath(this.state.downloadPath);
            this.context.api.events.emit("did-move-downloads");
            onShowDialog(
              "info",
              "download_management:::settings::transfer::cleanup::title",
              {
                bbcode: t(
                  "download_management:::settings::transfer::cleanup::old_folder_retained",
                  { replace: { thePath: oldPath } },
                ),
              },
              [
                {
                  label: "download_management:::settings::actions::close",
                  action: () => PromiseBB.resolve(),
                },
              ],
            );

            if (!(err.errorObject instanceof UserCanceled)) {
              this.context.api.showErrorNotification(
                "download_management:::settings::transfer::cleanup::title",
                err.errorObject,
              );
            }
          })
          .catch(InsufficientDiskSpace, () => notEnoughDiskSpace())
          .catch(UnsupportedOperatingSystem, () =>
            onShowError(
              "download_management:::settings::transfer::errors::unsupported_os_title",
              "download_management:::settings::transfer::errors::unsupported_os_description",
              false,
            ),
          )
          .catch(NotFound, () =>
            onShowError(
              "download_management:::settings::transfer::errors::invalid_destination_title",
              "download_management:::settings::transfer::errors::invalid_destination_description",
              false,
            ),
          )
          .catch((err) => {
            if (err !== null) {
              if (err.code === "EPERM") {
                onShowError(
                  "download_management:::settings::transfer::errors::directories_locked",
                  err,
                  false,
                );
              } else if (err.code === "EINVAL") {
                onShowError(
                  "download_management:::settings::transfer::errors::invalid_path",
                  err.message,
                  false,
                );
              } else if (err.code === "EIO") {
                // Input/Output file operations have been interrupted.
                //  this is not a bug in Vortex but rather a hardware/networking
                //  issue (depending on the user's setup).
                onShowError(
                  "download_management:::settings::transfer::errors::io_interrupted_title",
                  "download_management:::settings::transfer::errors::io_interrupted_description",
                  false,
                  true,
                );
              } else if (err.code === "UNKNOWN" && err?.["nativeCode"] === 1392) {
                // The file or directory is corrupted and unreadable.
                onShowError(
                  "download_management:::settings::transfer::errors::move_failed",
                  t("download_management:::settings::transfer::errors::corrupted_entry", {
                    replace: { culprit: err.path },
                  }),
                  false,
                );
              } else {
                onShowError(
                  "download_management:::settings::transfer::errors::move_failed",
                  err,
                  !(err instanceof ProcessCanceled),
                );
              }
            }
          })
          .finally(() => {
            const state = this.context.api.store.getState();
            // Any transfers would've completed at this point.
            //  Check if we still have the transfer state populated,
            //  if it is - that means that the user has cancelled the transfer,
            //  we need to cleanup.
            const pendingTransfer: string[] = [
              "persistent",
              "transactions",
              "transfer",
              "downloads",
            ];
            if (getSafe(state, pendingTransfer, undefined) !== undefined && deleteOldDestination) {
              return cleanFailedTransfer(newPath)
                .then(() => {
                  onSetTransfer(undefined);
                  this.nextState.busy = undefined;
                })
                .catch(UserCanceled, () => {
                  this.nextState.busy = undefined;
                })
                .catch((err) => {
                  this.nextState.busy = undefined;
                  if (err.code === "ENOENT") {
                    // Folder is already gone, that's fine.
                    onSetTransfer(undefined);
                  } else if (err.code === "EPERM") {
                    onShowError(
                      "download_management:::settings::transfer::cleanup::not_writable_title",
                      "download_management:::settings::transfer::cleanup::not_writable_description",
                      false,
                    );
                  } else {
                    onShowError(
                      "download_management:::settings::transfer::cleanup::failed",
                      err,
                      true,
                    );
                  }
                });
            } else {
              this.nextState.busy = undefined;
            }
          }),
      {},
    );
  };

  private confirmElevate = (): PromiseBB<void> => {
    const { onShowDialog } = this.props;
    return onShowDialog(
      "question",
      "download_management:::settings::transfer::elevation::title",
      {
        text: "download_management:::settings::transfer::elevation::description",
      },
      [
        { label: CANCEL_ACTION },
        { label: "download_management:::settings::transfer::elevation::create_with_elevation" },
      ],
    ).then((result) =>
      result.action === CANCEL_ACTION ? PromiseBB.reject(new UserCanceled()) : PromiseBB.resolve(),
    );
  };

  private checkTargetEmpty(oldDownloadPath: string, newDownloadPath: string) {
    let queue = PromiseBB.resolve();
    let fileCount = 0;
    let hasDownloadTag: boolean = false;
    let tagInstance: string;
    if (oldDownloadPath !== newDownloadPath) {
      queue = queue
        .then(() => fs.readdirAsync(newDownloadPath))
        .then((files) => {
          fileCount += files.length;
          if (!hasDownloadTag && files.includes(DOWNLOADS_DIR_TAG)) {
            hasDownloadTag = true;
          }
        })
        .then(() => {
          if (hasDownloadTag) {
            const downloadTagPath = path.join(newDownloadPath, DOWNLOADS_DIR_TAG);
            return fs.readFileAsync(downloadTagPath).then((tagData) => {
              try {
                tagInstance = JSON.parse(tagData).instance;
              } catch (err) {
                log("warn", "failed to parse download tag file", {
                  downloadTagPath,
                  error: getErrorMessageOrDefault(err),
                });
              }
            });
          }
        });
    }
    // ensure the destination directories are empty
    return queue.then(
      () =>
        new PromiseBB((resolve, reject) => {
          if (fileCount > 0 && tagInstance !== this.props.instanceId) {
            if (tagInstance !== undefined) {
              return this.props.onShowDialog(
                "question",
                "download_management:::settings::transfer::existing_folder::title",
                {
                  text: "download_management:::settings::transfer::existing_folder::description",
                },
                [
                  {
                    label: CANCEL_ACTION,
                    action: () => reject(new UserCanceled()),
                    default: true,
                  },
                  {
                    label: "download_management:::settings::actions::continue",
                    action: () => resolve(),
                  },
                ],
              );
            } else {
              this.props.onShowDialog(
                "info",
                "download_management:::settings::transfer::empty_destination::title",
                {
                  text: "download_management:::settings::transfer::empty_destination::description",
                },
                [
                  {
                    label: "download_management:::settings::actions::ok",
                    action: () => reject(new UserCanceled()),
                    default: true,
                  },
                ],
              );
            }
          } else {
            resolve();
          }
        }),
    );
  }

  private transferPath() {
    const { onSetTransfer, onShowDialog } = this.props;
    const oldPath = getDownloadPath(this.props.downloadPath);
    const newPath = getDownloadPath(this.state.downloadPath);

    this.context.api.events.emit("will-move-downloads");
    let sourceIsMissing = false;
    return fs
      .statAsync(oldPath)
      .catch((err) => {
        // The initial downloads folder is missing! this may be a valid case if:
        //  1. HDD or removable media is faulty or has become unseated and is
        //  no longer detectable by the OS.
        //  2. Source folder was located on a network drive which is no longer available.
        //  3. User has changed drive letter for whatever reason.
        //
        //  Currently we have confirmed that the error code will be set to "UNKNOWN"
        //  for all these cases, but we may have to add other error codes if different
        //  error cases pop up.
        sourceIsMissing = ["ENOENT", "UNKNOWN"].indexOf(err.code) !== -1;
        log("warn", "Transfer failed - missing source directory", err);
        return sourceIsMissing ? PromiseBB.resolve(undefined) : PromiseBB.reject(err);
      })
      .then((stats) => {
        const queryReset =
          stats !== undefined
            ? PromiseBB.resolve()
            : onShowDialog(
                "question",
                "download_management:::settings::transfer::missing_source::title",
                {
                  bbcode: "download_management:::settings::transfer::missing_source::description",
                },
                [
                  { label: CANCEL_ACTION },
                  {
                    label: "download_management:::settings::transfer::missing_source::reinitialize",
                  },
                ],
              ).then((result) =>
                result.action === CANCEL_ACTION
                  ? PromiseBB.reject(new UserCanceled())
                  : PromiseBB.resolve(),
              );

        return queryReset.then(() => {
          onSetTransfer(newPath);
          return transferPath(oldPath, newPath, (from: string, to: string, progress: number) => {
            log("debug", "transfer downloads", { from, to });
            if (progress > this.state.progress) {
              this.nextState.progress = progress;
            }
            if (this.state.progressFile !== from && Date.now() - this.mLastFileUpdate > 1000) {
              this.nextState.progressFile = path.basename(from);
            }
          }).catch((err) =>
            sourceIsMissing && err.path === oldPath ? PromiseBB.resolve() : PromiseBB.reject(err),
          );
        });
      });
  }
}

function mapStateToProps(state: IState): IConnectedProps {
  const modsInstallPath = selectors.installPath(state);
  const isPremium = getSafe(state, ["persistent", "nexus", "userInfo", "isPremium"], false);
  return {
    parallelDownloads: isPremium ? state.settings.downloads.maxParallelDownloads : 1,
    // TODO: this breaks encapsulation
    isPremium,
    downloadPath: state.settings.downloads.path,
    downloads: state.persistent.downloads.files,
    modsInstallPath,
    instanceId: state.app.instanceId,
    copyOnIFF: state.settings.downloads.copyOnIFF,
    maxBandwidth: state.settings.downloads.maxBandwidth,
    collectionsInstallWhileDownloading: state.settings.downloads.collectionsInstallWhileDownloading,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onSetDownloadPath: (newPath: string) => dispatch(setDownloadPath(newPath)),
    onSetMaxDownloads: (value: number) => dispatch(setMaxDownloads(value)),
    onSetTransfer: (dest: string) => dispatch(setTransferDownloads(dest)),
    onShowDialog: (type, title, content, actions) =>
      dispatch(showDialog(type, title, content, actions)),
    onShowError: (
      message: string,
      details: string | Error,
      allowReport: boolean,
      isBBCode?: boolean,
    ): void => showError(dispatch, message, details, { allowReport, isBBCode }),
    onSetCopyOnIFF: (enabled: boolean) => dispatch(setCopyOnIFF(enabled)),
    onSetMaxBandwidth: (bps: number) => dispatch(setMaxBandwidth(bps)),
    onSetCollectionConcurrency: (enabled: boolean) => dispatch(setCollectionConcurrency(enabled)),
  };
}

export default translate(["common"])(
  connect(mapStateToProps, mapDispatchToProps)(Settings),
) as React.ComponentClass<{}>;
