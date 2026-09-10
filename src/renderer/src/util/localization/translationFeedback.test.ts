import { describe, expect, it } from "vitest";

import {
  buildTranslationFeedback,
  formatFeedbackMarkdown,
  generateGitHubIssueUrl,
  validateTranslationSuggestion,
  type ITranslationFeedbackInput,
} from "./translationFeedback";

describe("Phase 9: Community Translation Feedback Mechanism", () => {
  const sampleInput: ITranslationFeedbackInput = {
    locale: "uk",
    namespace: "common",
    key: "install_from_file",
    englishSource: "Install From File",
    currentTranslation: "Установити з файлу",
    suggestedTranslation: "Встановити з файлу",
    category: "glossary_mismatch",
    comment: "Adheres to preferred spelling in Ukrainian style guide for this action.",
    vortexVersion: "1.13.0",
    desktopEnvironment: "Arch Linux / GNOME Wayland",
    scaleFactor: 1.5,
  };

  describe("1. Suggestion Validation", () => {
    it("accepts a valid Ukrainian translation suggestion", () => {
      const res = validateTranslationSuggestion(
        sampleInput.currentTranslation,
        sampleInput.suggestedTranslation,
      );
      expect(res.valid).toBe(true);
      expect(res.errors).toHaveLength(0);
    });

    it("rejects an empty translation suggestion", () => {
      const res = validateTranslationSuggestion("Original", "   ");
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("cannot be empty");
    });

    it("enforces preservation of interpolation placeholders like {{count}}", () => {
      const orig = "{{ count }} active mod";
      const broken = "активних модів";
      const res = validateTranslationSuggestion(orig, broken);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("Missing required interpolation placeholder: {{count}}");

      const fixed = "{{ count }} активних модів";
      const validRes = validateTranslationSuggestion(orig, fixed);
      expect(validRes.valid).toBe(true);
    });

    it("rejects non-Ukrainian Cyrillic characters (e.g. Russian letters)", () => {
      const orig = "Deploy";
      const invalidRussian = "Выполнить"; // contains 'ы'
      const res = validateTranslationSuggestion(orig, invalidRussian);
      expect(res.valid).toBe(false);
      expect(res.errors[0]).toContain("contains non-Ukrainian Cyrillic characters");
    });

    it("warns when Trans component tags are missing or mismatched", () => {
      const orig = "Click <0>here</0> to learn more";
      const missingTag = "Натисніть тут для довідки";
      const res = validateTranslationSuggestion(orig, missingTag);
      expect(res.valid).toBe(true); // warning does not invalidate submission
      expect(res.warnings).toHaveLength(1);
      expect(res.warnings[0]).toContain("Mismatch in component tags count");
    });
  });

  describe("2. Report Building & Formatting", () => {
    it("builds a feedback report with id and timestamp", () => {
      const report = buildTranslationFeedback(sampleInput);
      expect(report.id).toContain("i18n-uk-common-");
      expect(report.timestamp).toBeDefined();
      expect(report.scaleFactor).toBe(1.5);
    });

    it("formats the report into standardized GitHub Issue Markdown", () => {
      const report = buildTranslationFeedback(sampleInput);
      const markdown = formatFeedbackMarkdown(report);

      expect(markdown).toContain("### [i18n:uk] Translation Feedback: common::install_from_file");
      expect(markdown).toContain("**English Source:**");
      expect(markdown).toContain("Install From File");
      expect(markdown).toContain("Встановити з файлу");
      expect(markdown).toContain("Arch Linux / GNOME Wayland");
      expect(markdown).toContain("150%");
    });
  });

  describe("3. GitHub Issue Link Generation", () => {
    it("generates a pre-filled GitHub issue URL with title, body, and labels", () => {
      const report = buildTranslationFeedback(sampleInput);
      const urlString = generateGitHubIssueUrl(report, "https://github.com/Nexus-Mods/Vortex");

      const url = new URL(urlString);
      expect(url.origin).toBe("https://github.com");
      expect(url.pathname).toBe("/Nexus-Mods/Vortex/issues/new");
      expect(url.searchParams.get("title")).toBe(
        "[i18n:uk] Translation fix for common::install_from_file",
      );
      expect(url.searchParams.get("labels")).toBe("i18n,ukrainian,translation-feedback");
      expect(url.searchParams.get("body")).toContain("Install From File");
    });
  });
});
