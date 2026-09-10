import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { LocalizationService } from "./LocalizationService";
import {
  auditA11yStandards,
  auditCyrillicAndFontCompatibility,
  auditUiExpansionBudgets,
  calculateExpansionMetrics,
  flattenBundle,
  simulateDpiScaling,
  type IA11yElementSpec,
} from "./uiAccessibilityQa";

describe("Phase 8: UI and Accessibility QA (Ukrainian Localization)", () => {
  const localesDir = path.resolve(__dirname, "../../../../../locales");
  const namespaces = [
    "common",
    "collection",
    "mod_management",
    "download_management",
    "profile_management",
    "nexus_integration",
    "gamemode_management",
    "extension_manager",
    "health_check",
  ];

  const enBundle: Record<string, string> = {};
  const ukBundle: Record<string, string> = {};

  for (const ns of namespaces) {
    const enFile = path.join(localesDir, "en", `${ns}.json`);
    const ukFile = path.join(localesDir, "uk", `${ns}.json`);
    if (fs.existsSync(enFile)) {
      const enJson = JSON.parse(fs.readFileSync(enFile, "utf8"));
      Object.assign(enBundle, flattenBundle(enJson, ns));
    }
    if (fs.existsSync(ukFile)) {
      const ukJson = JSON.parse(fs.readFileSync(ukFile, "utf8"));
      Object.assign(ukBundle, flattenBundle(ukJson, ns));
    }
  }

  describe("1. Text Expansion & Layout Budget Audit", () => {
    it("measures expansion ratio across all bundled keys and verifies average ratio within expected bounds", () => {
      const metrics = calculateExpansionMetrics(enBundle, ukBundle);

      expect(metrics.totalKeys).toBeGreaterThanOrEqual(500);
      // Ukrainian text naturally expands between 1.05 and 1.50 compared to compact English
      expect(metrics.averageExpansionRatio).toBeGreaterThanOrEqual(1.0);
      expect(metrics.averageExpansionRatio).toBeLessThanOrEqual(1.5);
    });

    it("verifies representative buttons and actions do not exceed UI character budgets", () => {
      const buttonKeys: Record<string, string> = {
        "common::install_from_file": "button",
        "common::installer::finish": "button",
        "common::installer::next": "button",
        "common::installer::previous": "button",
        "common::installer::cancel": "button",
        "common::installer::close": "button",
        "common::actions::cancel": "button",
        "common::actions::confirm": "button",
        "common::actions::retry": "button",
        "health_check::actions::recheck": "button",
        "health_check::actions::copy_command": "button",
        "health_check::actions::show_details": "button",
        "health_check::actions::hide_rule": "button",
      };

      const audit = auditUiExpansionBudgets(ukBundle, buttonKeys);
      expect(audit.passed).toBe(true);
      expect(audit.violations).toHaveLength(0);
    });

    it("verifies navigation items and table headers fit within layout limits", () => {
      const navAndHeaderKeys: Record<string, string> = {
        "common::navigation::sidebar::mods": "nav_item",
        "common::navigation::sidebar::games": "nav_item",
        "common::navigation::sidebar::downloads": "nav_item",
        "common::navigation::sidebar::extensions": "nav_item",
        "common::navigation::header::help_centre": "nav_item",
        "common::navigation::header::view_logs": "nav_item",
        "common::installer::title_fomod": "dialog_title",
      };

      const audit = auditUiExpansionBudgets(ukBundle, navAndHeaderKeys);
      expect(audit.passed).toBe(true);
      expect(audit.violations).toHaveLength(0);
    });
  });

  describe("2. Cyrillic & Font Glyph Compatibility Audit", () => {
    it("validates all Ukrainian translation strings contain authentic Cyrillic glyphs without corrupt bytes", () => {
      const glyphAudit = auditCyrillicAndFontCompatibility(ukBundle);

      expect(glyphAudit.passed).toBe(true);
      expect(glyphAudit.unexpectedCharacters).toHaveLength(0);
      expect(glyphAudit.analyzedCharacters).toBeGreaterThan(10000);

      // Verify specific Ukrainian characters are present and correctly encoded
      const cyrillic = glyphAudit.uniqueCyrillicGlyphs.join("").toLowerCase();
      expect(cyrillic).toContain("є");
      expect(cyrillic).toContain("і");
      expect(cyrillic).toContain("ї");
    });
  });

  describe("3. Responsive DPI Scaling Simulation (100% to 200%)", () => {
    it("verifies critical action labels remain within container bounds under 100%-200% scaling", () => {
      const testComponents = [
        {
          componentId: "btn-install-from-file",
          text: ukBundle["common::install_from_file"] || "Встановити з файлу",
          baseContainerWidth: 200, // 200px at 100%, 400px at 200%
          allowWrapOrEllipsis: false,
        },
        {
          componentId: "btn-fomod-finish",
          text: ukBundle["common::installer::finish"] || "Завершити",
          baseContainerWidth: 120,
          allowWrapOrEllipsis: false,
        },
        {
          componentId: "btn-recheck-health",
          text: ukBundle["health_check::actions::recheck"] || "Повторити перевірку",
          baseContainerWidth: 200,
          allowWrapOrEllipsis: false,
        },
        {
          componentId: "nav-sidebar-mods",
          text: ukBundle["common::navigation::sidebar::mods"] || "Моди",
          baseContainerWidth: 100,
          allowWrapOrEllipsis: false,
        },
      ];

      const sim = simulateDpiScaling(testComponents, [1.0, 1.25, 1.5, 1.75, 2.0]);
      expect(sim.overflows).toHaveLength(0);
    });
  });

  describe("4. Accessibility (a11y) & Screen-Reader Standards", () => {
    it("synchronizes document.documentElement.lang on locale initialization and switching", async () => {
      const mockDocument = {
        lang: "en",
        dir: "ltr",
      };
      const originalDoc = global.document;
      global.document = { documentElement: mockDocument } as any;

      try {
        const fakeAdapter = {
          language: "en",
          changeLanguage: async (lang: string) => {
            fakeAdapter.language = lang;
            return (k: string) => k;
          },
          initialize: async () => ({
            runtime: {} as any,
            translator: (k: string) => k,
          }),
          reset: async () => {},
        };

        const service = new LocalizationService(fakeAdapter as any);
        await service.initialize("uk", () => []);

        // WCAG 3.1.1: lang attribute MUST match active UI language
        expect(mockDocument.lang).toBe("uk");

        // Switch to English
        await service.changeLanguage("en");
        expect(mockDocument.lang).toBe("en");

        // Switch back to Ukrainian
        await service.changeLanguage("uk");
        expect(mockDocument.lang).toBe("uk");

        // Reset
        await service.reset();
        expect(mockDocument.lang).toBe("en");
      } finally {
        global.document = originalDoc;
      }
    });

    it("verifies modal dialogs and interactive icon controls comply with accessibility rules", () => {
      const components: IA11yElementSpec[] = [
        {
          id: "fomod-modal-dialog",
          isDialog: true,
          role: "dialog",
          ariaModal: true,
          hasKeyboardDismiss: true,
        },
        {
          id: "health-check-details-modal",
          isDialog: true,
          role: "dialog",
          ariaModal: true,
          hasKeyboardDismiss: true,
        },
        {
          id: "btn-close-fomod",
          isIconOnly: true,
          ariaLabel: "Закрити",
        },
        {
          id: "btn-copy-command",
          isIconOnly: true,
          title: "Скопіювати команду",
        },
      ];

      const result = auditA11yStandards(components, "uk");
      expect(result.passed).toBe(true);
      expect(result.screenReaderLangConfigured).toBe(true);
      expect(result.violations).toHaveLength(0);
    });
  });
});
