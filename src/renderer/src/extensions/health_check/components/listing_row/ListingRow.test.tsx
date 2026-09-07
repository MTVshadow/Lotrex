import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { ListingRow } from "./ListingRow";

function renderRow(onOpen = vi.fn()) {
  render(
    <ListingRow
      action={<button type="button">Resolve</button>}
      detail="Path"
      entryActions={null}
      severity="warning"
      summary="Summary"
      title="Issue"
      onOpen={onOpen}
    />,
  );
  return onOpen;
}

describe("Health Check listing-row keyboard behavior", () => {
  it("opens the row with Enter", () => {
    const onOpen = renderRow();

    fireEvent.keyDown(screen.getByRole("button", { name: /Issue/ }), { key: "Enter" });

    expect(onOpen).toHaveBeenCalledOnce();
  });

  it("does not open the row when Enter comes from a nested action", () => {
    const onOpen = renderRow();

    fireEvent.keyDown(screen.getByRole("button", { name: "Resolve" }), { key: "Enter" });

    expect(onOpen).not.toHaveBeenCalled();
  });
});
