import * as React from "react";
import { FormControl } from "react-bootstrap";

import type { IFilterProps, ITableFilter } from "../../types/ITableAttribute";

export class TextFilterComponent extends React.Component<IFilterProps, {}> {
  public render(): JSX.Element {
    let { filter } = this.props;
    if (typeof filter !== "string") {
      filter = undefined;
    }
    return (
      <FormControl
        className="form-field-compact"
        type="text"
        value={filter || ""}
        onChange={this.changeFilter}
        inputRef={this.props.domRef}
      />
    );
  }

  private changeFilter = (evt) => {
    const { attributeId, onSetFilter } = this.props;
    onSetFilter(attributeId, evt.currentTarget.value);
  };
}

function normalizeFilterText(text: string): string {
  // Нормалізація Unicode (NFC) та різновидів апострофів для точного пошуку українських назв
  return (text ?? "").normalize("NFC").replace(/[\u2018\u2019\u02BC\u0060]/g, "'");
}

class TextFilter implements ITableFilter {
  public component = TextFilterComponent;
  public raw = false;

  private mCaseInsensitive: boolean;

  constructor(ignoreCase: boolean) {
    this.mCaseInsensitive = ignoreCase;
  }

  public matches(filter: any, value: any): boolean {
    if (typeof filter !== "string") {
      // filter of the wrong type doesn't filter at all
      return true;
    }
    if (typeof value !== "string") {
      return false;
    }
    const normValue = normalizeFilterText(value);
    const normFilter = normalizeFilterText(filter);

    if (this.mCaseInsensitive) {
      return normValue.toLocaleLowerCase().indexOf(normFilter.toLocaleLowerCase()) !== -1;
    } else {
      return normValue.indexOf(normFilter) !== -1;
    }
  }
}

export default TextFilter;
