import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";
import { describe, expect, it, vi } from "vitest";

import { TranslationFeedbackDialog } from "./TranslationFeedbackDialog";

describe("Phase 9: TranslationFeedbackDialog Component", () => {
  it("renders translation details and handles validation", () => {
    const onHide = vi.fn();
    const onCopySuccess = vi.fn();
    const onOpenUrl = vi.fn();

    const { rerender } = render(
      <TranslationFeedbackDialog
        show={true}
        onHide={onHide}
        locale="uk"
        namespace="common"
        translationKey="install_from_file"
        englishSource="Install From File {{count}}"
        currentTranslation="Установити з файлу {{count}}"
        onCopySuccess={onCopySuccess}
        onOpenUrl={onOpenUrl}
      />,
    );

    // Assert dialog title and contents
    expect(screen.getByText(/Translation Feedback/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue("common::install_from_file")).toBeInTheDocument();
    expect(screen.getByText("Install From File {{count}}")).toBeInTheDocument();

    // Initially, buttons are disabled because suggestion is empty
    const copyBtn = screen.getByRole("button", { name: /Скопіювати звіт/i });
    const ghBtn = screen.getByRole("button", { name: /Відкрити на GitHub/i });
    expect(copyBtn).toBeDisabled();
    expect(ghBtn).toBeDisabled();

    // Type suggestion missing required placeholder {{count}}
    const suggestionInput = screen.getByPlaceholderText(/Введіть правильний переклад/i);
    fireEvent.change(suggestionInput, { target: { value: "Встановити з файлу" } });

    // Validation error should appear
    expect(
      screen.getByText(/Missing required interpolation placeholder: {{count}}/i),
    ).toBeInTheDocument();
    expect(copyBtn).toBeDisabled();

    // Fix suggestion to include {{count}}
    fireEvent.change(suggestionInput, {
      target: { value: "Встановити з файлу {{count}}" },
    });

    // Error is gone, buttons become enabled
    expect(
      screen.queryByText(/Missing required interpolation placeholder/i),
    ).not.toBeInTheDocument();
    expect(copyBtn).not.toBeDisabled();
    expect(ghBtn).not.toBeDisabled();

    // Trigger copy
    fireEvent.click(copyBtn);
    expect(onCopySuccess).toHaveBeenCalledTimes(1);
    expect(onCopySuccess).toHaveBeenCalledWith(
      expect.stringContaining("### [i18n:uk] Translation Feedback: common::install_from_file"),
    );

    // Trigger GitHub URL open
    fireEvent.click(ghBtn);
    expect(onOpenUrl).toHaveBeenCalledTimes(1);
    expect(onOpenUrl).toHaveBeenCalledWith(
      expect.stringContaining("https://github.com/Nexus-Mods/Vortex/issues/new"),
    );

    // Close button
    const closeBtn = screen.getByRole("button", { name: "Закрити" });
    fireEvent.click(closeBtn);
    expect(onHide).toHaveBeenCalledTimes(1);
  });
});
