import * as React from "react";
import { ControlLabel, FormGroup, HelpBlock } from "react-bootstrap";
import type * as Redux from "redux";
import type { ThunkDispatch } from "redux-thunk";

import { ComponentEx, connect, translate } from "../../../controls/ComponentEx";
import Toggle from "../../../controls/Toggle";
import { TypographyLink } from "../../../ui/components/typography/TypographyLink";
import opn from "../../../util/opn";
import { setAnalytics } from "../actions/analytics.action";
import { HELP_ARTICLE, PRIVACY_POLICY } from "../constants";

interface IConnectedProps {
  analytics: boolean;
  userInfo: any;
}

interface IActionProps {
  onSetAnalytics: (analytics: boolean) => void;
}

type IProps = IActionProps & IConnectedProps;

class SettingsAnalytics extends ComponentEx<IProps, {}> {
  public render(): JSX.Element {
    const { t, analytics, userInfo } = this.props;
    return (
      <form>
        <FormGroup controlId="analytics">
          <ControlLabel>{t("settings_analytics::title")}</ControlLabel>

          <Toggle checked={analytics} disabled={!userInfo} onToggle={this.toggleAnalytics}>
            {t("settings_analytics::allow_usage_data")}
          </Toggle>

          <HelpBlock>
            {t("settings_analytics::description")}
            <br />
            <br />
            <TypographyLink
              brand="info"
              onClick={() => {
                opn(HELP_ARTICLE).catch(() => undefined);
              }}
            >
              {t("settings_analytics::data_details_link")}
            </TypographyLink>{" "}
            |{" "}
            <TypographyLink
              brand="info"
              onClick={() => {
                opn(PRIVACY_POLICY).catch(() => undefined);
              }}
            >
              {t("settings_analytics::privacy_policy_link")}
            </TypographyLink>
          </HelpBlock>
        </FormGroup>
      </form>
    );
  }

  private toggleAnalytics = () => {
    this.props.onSetAnalytics(!this.props.analytics);
  };
}

function mapStateToProps(state: any): IConnectedProps {
  return {
    analytics: state.settings.analytics.enabled,
    userInfo: state.persistent.nexus.userInfo,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onSetAnalytics: (analytics: boolean): void => {
      dispatch(setAnalytics(analytics));
    },
  };
}

export default translate(["common"])(
  connect(mapStateToProps, mapDispatchToProps)(SettingsAnalytics),
) as React.ComponentClass<{}>;
