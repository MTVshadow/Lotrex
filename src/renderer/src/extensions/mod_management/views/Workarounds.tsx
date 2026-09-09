import * as React from "react";
import { ControlLabel, FormGroup, HelpBlock } from "react-bootstrap";
import { withTranslation } from "react-i18next";
import { connect } from "react-redux";
import type * as Redux from "redux";
import type { ThunkDispatch } from "redux-thunk";

import { ComponentEx } from "../../../controls/ComponentEx";
import Toggle from "../../../controls/Toggle";
import type { IState } from "../../../types/IState";
import { setCleanupOnDeploy } from "../actions/settings";

export interface IBaseProps {}

interface IConnectedProps {
  cleanupOnDeploy: boolean;
}

interface IActionProps {
  onSetCleanupOnDeploy: (enable: boolean) => void;
}

type IProps = IBaseProps & IActionProps & IConnectedProps;

class Settings extends ComponentEx<IProps, {}> {
  public render(): JSX.Element {
    const { t, cleanupOnDeploy } = this.props;

    return (
      <form>
        <FormGroup controlId="cleanup-on-deploy">
          <ControlLabel>{t("mod_management:::settings::workarounds::cleanup::title")}</ControlLabel>
          <Toggle checked={cleanupOnDeploy} onToggle={this.toggle}>
            {t("mod_management:::settings::workarounds::cleanup::toggle")}
          </Toggle>
          <HelpBlock>{t("mod_management:::settings::workarounds::cleanup::description")}</HelpBlock>
        </FormGroup>
      </form>
    );
  }

  private toggle = (enabled: boolean) => {
    const { onSetCleanupOnDeploy } = this.props;
    onSetCleanupOnDeploy(enabled);
  };
}

function mapStateToProps(state: IState): IConnectedProps {
  return {
    cleanupOnDeploy: state.settings.mods.cleanupOnDeploy,
  };
}

function mapDispatchToProps(dispatch: ThunkDispatch<any, null, Redux.Action>): IActionProps {
  return {
    onSetCleanupOnDeploy: (enable: boolean) => dispatch(setCleanupOnDeploy(enable)),
  };
}

export default withTranslation(["common"])(
  connect(mapStateToProps, mapDispatchToProps)(Settings) as any,
) as React.ComponentClass<{}>;
