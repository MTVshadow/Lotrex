import { act, render } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  emit: vi.fn(),
  libraryProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock("react-redux", () => {
  const state = {
    persistent: { profiles: {} },
    session: { gameMode: { known: [] } },
    settings: { gameMode: { discovered: {} } },
  };

  return {
    shallowEqual: () => false,
    useDispatch: () => vi.fn(),
    useSelector: (selector: (value: typeof state) => unknown) => selector(state),
  };
});

vi.mock("../../../ExtensionProvider", () => ({
  useExtensionContext: () => ({ getApi: () => ({ events: { emit: harness.emit } }) }),
}));

vi.mock("../../../views/UnifiedLibraryView", () => ({
  UnifiedLibraryView: (props: Record<string, unknown>) => {
    harness.libraryProps = props;
    return null;
  },
}));

import { UnifiedGameLibraryPage } from "./UnifiedGameLibraryPage";

describe("UnifiedGameLibraryPage navigation visibility", () => {
  beforeEach(() => {
    harness.emit.mockReset();
    harness.libraryProps = undefined;
  });

  it("hides when navigation switches away and becomes visible again when revisited", () => {
    const { container, rerender } = render(
      <UnifiedGameLibraryPage active pageId="lotrex-game-library" />,
    );
    const page = container.querySelector("#page-lotrex-game-library");

    expect(page).toHaveClass("relative", "opacity-100");
    expect(page).not.toHaveClass("invisible");

    rerender(<UnifiedGameLibraryPage active={false} pageId="lotrex-game-library" />);
    expect(page).toHaveClass("invisible", "opacity-0", "pointer-events-none");

    rerender(<UnifiedGameLibraryPage active pageId="lotrex-game-library" />);
    expect(page).toHaveClass("relative", "opacity-100");
    expect(page).not.toHaveClass("invisible");

    rerender(<UnifiedGameLibraryPage active={false} pageId="lotrex-game-library" />);
    expect(page).toHaveClass("invisible", "opacity-0", "pointer-events-none");
  });

  it("surfaces a typed quick-discovery failure inside the library page", () => {
    render(<UnifiedGameLibraryPage active pageId="lotrex-game-library" />);
    const refresh = harness.libraryProps?.onRefresh as () => void;

    act(() => refresh());
    const callback = harness.emit.mock.calls[0][1] as (
      gameIds: string[],
      result: {
        error: { message: string };
        gameIds: string[];
        status: "failed";
      },
    ) => void;
    act(() =>
      callback([], {
        error: { message: "Steam library is unavailable" },
        gameIds: [],
        status: "failed",
      }),
    );

    expect(harness.libraryProps?.error).toBe("Steam library is unavailable");
  });
});
