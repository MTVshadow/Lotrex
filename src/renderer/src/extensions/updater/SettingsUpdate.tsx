import * as React from "react";
import { FormGroup } from "react-bootstrap";
import type * as Redux from "redux";
import type { ThunkDispatch } from "redux-thunk";

import { ComponentEx, connect, translate } from "../../controls/ComponentEx";
import More from "../../controls/More";
import type { UpdateChannel, IState } from "../../types/IState";
import { UPDATE_CHANNELS } from "../../types/IState";
import type { VortexInstallType } from "../../types/VortexInstallType";
import { Button } from "../../ui/components/button/Button";
import { Picker } from "../../ui/components/picker/Picker";
import { Typography } from "../../ui/components/typography/Typography";
import Debouncer from "../../util/Debouncer";
import { log } from "../../util/log";
import { setUpdateChannel } from "./actions";

interface IConnectedProps {
  updateChannel: UpdateChannel;
  installType: VortexInstallType;
}

interface IActionProps {
  onSetUpdateChannel: (channel: UpdateChannel) => void;
}

interface ISettingsUpdateState {
  checkUpdateButtonDisabled: boolean;
}

type IProps = IActionProps & IConnectedProps;

const CHECK_UPDATE_INTERVAL = 60000;
class SettingsUpdate extends ComponentEx<IProps, ISettingsUpdateState> {
  //static contextType = MainContext

  constructor(props) {
    super(props);

    this.initState({
      checkUpdateButtonDisabled: false,
    });
  }

  private checkUpdateDebouncer = new Debouncer(
    () => {
      this.checkNow();

      setTimeout(() => {
        this.nextState.checkUpdateButtonDisabled = false;
      }, CHECK_UPDATE_INTERVAL);

      return null;
    },
    CHECK_UPDATE_INTERVAL,
    true,
    true,
  );

  private manualUpdateCheck = () => {
    this.nextState.checkUpdateButtonDisabled = true;
    log("info", "manual update check");
    this.checkUpdateDebouncer.schedule();
  };

  private renderCallout(text: string, brand: "info" | "warning" = "info"): JSX.Element {
    const bg = brand === "warning" ? "bg-warning-950" : "bg-info-950";
    const border = brand === "warning" ? "border-warning-weak" : "border-info-weak";
    return (
      <div className={`rounded-lg border ${border} ${bg} p-3`}>
        <Typography brand="neutral-translucent">{text}</Typography>
      </div>
    );
  }

  public render(): JSX.Element {
    const { t, installType, updateChannel } = this.props;

    const { checkUpdateButtonDisabled } = this.state;

    // managed or development
    if (installType === "managed") {
      if (process.env.NODE_ENV === "development" && process.platform !== "win32") {
        return this.renderCallout(t("settings_updater::managed::linux_development"));
      }

      // Managed builds are updated by their package manager. Windows development
      // keeps the updater UI available for testing the installer flow.
      if (process.env.NODE_ENV !== "development" || process.platform !== "win32") {
        return this.renderCallout(t("settings_updater::managed::third_party"));
      }

      // managed and development
    }

    // regular
    return (
      <form>
        <FormGroup controlId="updateChannel">
          <div className="flex flex-col items-start gap-y-2">
            {process.env.NODE_ENV === "development"
              ? this.renderCallout(t("settings_updater::development_mode"))
              : null}

            <Typography as="span">
              {t("settings_updater::label")}

              <More id="more-update-channel" name={t("settings_updater::channel::label")}>
                {t("settings_updater::channel::description")}
              </More>
            </Typography>

            <div className="flex items-center gap-x-2">
              <Picker<UpdateChannel>
                options={[
                  { label: t("settings_updater::channel::stable"), value: "stable" },
                  { label: t("settings_updater::channel::beta"), value: "beta" },
                  { label: t("settings_updater::channel::disabled"), value: "none" },
                ]}
                placement="left"
                value={updateChannel}
                onChange={this.selectChannel}
              />

              <Button
                brand="neutral"
                disabled={checkUpdateButtonDisabled}
                onClick={this.manualUpdateCheck}
              >
                {t("settings_updater::check_now")}
              </Button>
            </div>

            {updateChannel === "next"
              ? this.renderCallout(t("settings_updater::preview_channel"))
              : null}

            {updateChannel === "none"
              ? this.renderCallout(t("settings_updater::disabled_warning"), "warning")
              : null}
          </div>
        </FormGroup>
      </form>
    );
  }

  private checkNow = () => {
    // send what updateChannel you are on, unless it's none, then send stable. manual check as well
    const channel = this.props.updateChannel === "none" ? "stable" : this.props.updateChannel;
    window.api.updater.checkForUpdates(channel, true);
  };

  private selectChannel = (value: UpdateChannel) => {
    if (UPDATE_CHANNELS.includes(value)) {
      const newChannel = value;

      if (newChannel === "beta") {
        this.context.api.showDialog(
          "question",
          "settings_updater::beta_dialog::title",
          {
            text: "settings_updater::beta_dialog::description",
          },
          [
            { label: "settings_updater::actions::cancel" },
            {
              label: "settings_updater::beta_dialog::confirm",
              action: () => this.props.onSetUpdateChannel(newChannel),
            },
          ],
        );
      } else if (newChannel === "stable") {
        // stable or latest
        this.props.onSetUpdateChannel(newChannel);
      } else if (newChannel === "none") {
        // none

        this.context.api.showDialog(
          "question",
          "settings_updater::disable_dialog::title",
          {
            text: "settings_updater::disable_dialog::description",
          },
          [
            { label: "settings_updater::actions::cancel" },
            {
              label: "settings_updater::disable_dialog::confirm",
              action: () => this.props.onSetUpdateChannel(newChannel),
            },
          ],
        );
      }
    } else {
      log("error", "invalid channel", value);
    }
  };
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    updateChannel: state.settings.update.channel,
    installType: state.app.installType,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onSetUpdateChannel: (channel: UpdateChannel): void => {
      dispatch(setUpdateChannel(channel));
    },
  };
}

export default translate(["common"])(
  connect(mapStateToProps, mapDispatchToProps)(SettingsUpdate),
) as React.ComponentClass<{}>;
