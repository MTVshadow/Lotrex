import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Interface representing metrics for language text expansion.
 *
 * Educational comment:
 * In localization engineering, target languages (like Ukrainian) routinely expand
 * by 20-40% compared to compact English source strings. Measuring expansion
 * ratios prevents UI element overflow, button truncation, and layout breakage.
 */
export interface ITextExpansionMetrics {
  totalKeys: number;
  averageExpansionRatio: number;
  maxExpansionRatio: number;
  maxExpansionKey: string;
  minExpansionRatio: number;
  highExpansionKeys: Array<{
    key: string;
    enLength: number;
    ukLength: number;
    ratio: number;
  }>;
}

export interface IUIBudgetViolation {
  key: string;
  length: number;
  limit: number;
  category: string;
  text: string;
}

export interface IUIBudgetAuditResult {
  passed: boolean;
  violations: IUIBudgetViolation[];
}

export interface IGlyphAuditResult {
  passed: boolean;
  analyzedCharacters: number;
  uniqueCyrillicGlyphs: string[];
  unexpectedCharacters: Array<{
    char: string;
    codePoint: string;
    key: string;
    context: string;
  }>;
}

export interface IScalingSimulationResult {
  scaleFactors: number[];
  testedItemsCount: number;
  overflows: Array<{
    componentId: string;
    scale: number;
    estimatedTextWidthPx: number;
    containerWidthPx: number;
    text: string;
  }>;
}

export interface IA11yElementSpec {
  id: string;
  role?: string;
  ariaLabel?: string;
  title?: string;
  hasVisibleText?: boolean;
  isIconOnly?: boolean;
  isDialog?: boolean;
  ariaModal?: boolean;
  hasKeyboardDismiss?: boolean;
}

export interface IA11yAuditResult {
  passed: boolean;
  screenReaderLangConfigured: boolean;
  screenReaderLang: string;
  violations: string[];
}

/**
 * Standard UI character budgets by category before overflow or wrapping occurs.
 */
export const DEFAULT_UI_BUDGETS: Record<string, number> = {
  button: 36,
  nav_item: 30,
  table_header: 35,
  badge_label: 25,
  dialog_title: 70,
};

/**
 * Extracts a flattened dictionary of string keys and values from nested JSON structures.
 */
export function flattenBundle(
  obj: Record<string, unknown>,
  prefix: string = "",
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}::${k}` : k;
    if (typeof v === "string") {
      result[key] = v;
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(result, flattenBundle(v as Record<string, unknown>, key));
    }
  }
  return result;
}

/**
 * Calculates text expansion statistics between English source and Ukrainian translations.
 */
export function calculateExpansionMetrics(
  enFlat: Record<string, string>,
  ukFlat: Record<string, string>,
  highExpansionThreshold: number = 2.0,
): ITextExpansionMetrics {
  const ratios: Array<{ key: string; enLength: number; ukLength: number; ratio: number }> = [];

  for (const [key, enText] of Object.entries(enFlat)) {
    const ukText = ukFlat[key];
    if (!ukText) continue;

    const enLen = enText.trim().length;
    const ukLen = ukText.trim().length;
    if (enLen === 0) continue;

    const ratio = ukLen / enLen;
    ratios.push({ key, enLength: enLen, ukLength: ukLen, ratio });
  }

  if (ratios.length === 0) {
    return {
      totalKeys: 0,
      averageExpansionRatio: 1.0,
      maxExpansionRatio: 1.0,
      maxExpansionKey: "",
      minExpansionRatio: 1.0,
      highExpansionKeys: [],
    };
  }

  let sum = 0;
  let maxRatio = 0;
  let maxKey = "";
  let minRatio = Infinity;
  const highExpansionKeys: Array<{
    key: string;
    enLength: number;
    ukLength: number;
    ratio: number;
  }> = [];

  for (const item of ratios) {
    sum += item.ratio;
    if (item.ratio > maxRatio) {
      maxRatio = item.ratio;
      maxKey = item.key;
    }
    if (item.ratio < minRatio) {
      minRatio = item.ratio;
    }
    if (item.ratio >= highExpansionThreshold && item.ukLength > 15) {
      highExpansionKeys.push(item);
    }
  }

  return {
    totalKeys: ratios.length,
    averageExpansionRatio: Number((sum / ratios.length).toFixed(2)),
    maxExpansionRatio: Number(maxRatio.toFixed(2)),
    maxExpansionKey: maxKey,
    minExpansionRatio: Number(minRatio.toFixed(2)),
    highExpansionKeys,
  };
}

/**
 * Audits UI strings against specified maximum character budgets.
 */
export function auditUiExpansionBudgets(
  bundle: Record<string, string>,
  categorizedKeys: Record<string, string>, // key -> category
  budgets: Record<string, number> = DEFAULT_UI_BUDGETS,
): IUIBudgetAuditResult {
  const violations: IUIBudgetViolation[] = [];

  for (const [key, category] of Object.entries(categorizedKeys)) {
    const text = bundle[key];
    if (!text) continue;

    const limit = budgets[category];
    if (limit && text.length > limit) {
      violations.push({
        key,
        length: text.length,
        limit,
        category,
        text,
      });
    }
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}

/**
 * Validates that Ukrainian translation strings contain only legitimate Ukrainian Cyrillic glyphs,
 * allowed apostrophes, digits, standard punctuation, and known Latin brand/technical names.
 */
export function auditCyrillicAndFontCompatibility(
  ukFlat: Record<string, string>,
): IGlyphAuditResult {
  // Ukrainian Cyrillic unicode range: \u0400-\u04FF
  // Specifically: А-Я, а-я, Ґ, ґ, Є, є, І, і, Ї, ї
  const cyrillicRegex = /[\u0400-\u04FF]/;
  // Allowed punctuation, symbols, brackets, whitespace, and apostrophes (' ’ ʼ `)
  const allowedSymbolsRegex =
    /^[\s\d\p{P}\p{S}a-zA-Z\u0400-\u04FF’ʼ'«»–—•…“”/\\():;,.!?[\]{}<>=+*#%@&~|_\-^\x60]+$/u;

  const unexpectedCharacters: Array<{
    char: string;
    codePoint: string;
    key: string;
    context: string;
  }> = [];

  const cyrillicGlyphsSet = new Set<string>();
  let analyzedCharacters = 0;

  for (const [key, text] of Object.entries(ukFlat)) {
    for (const char of text) {
      analyzedCharacters++;
      if (cyrillicRegex.test(char)) {
        cyrillicGlyphsSet.add(char);
      } else if (!allowedSymbolsRegex.test(char)) {
        unexpectedCharacters.push({
          char,
          codePoint: `U+${char.codePointAt(0)?.toString(16).toUpperCase().padStart(4, "0")}`,
          key,
          context: text.substring(0, 40),
        });
      }
    }
  }

  return {
    passed: unexpectedCharacters.length === 0,
    analyzedCharacters,
    uniqueCyrillicGlyphs: Array.from(cyrillicGlyphsSet).sort(),
    unexpectedCharacters,
  };
}

/**
 * Simulates DPI scaling (100% to 200%) on representative UI elements.
 *
 * Educational comment:
 * On Linux Wayland/X11 desktops, users frequently configure 125%, 150%, or 200% fractional
 * or integer scaling. Estimating character widths against container constraints ensures
 * fixed-width elements do not clip translated text.
 */
export function simulateDpiScaling(
  items: Array<{
    componentId: string;
    text: string;
    baseContainerWidth: number;
    baseFontSize?: number;
    allowWrapOrEllipsis?: boolean;
  }>,
  scaleFactors: number[] = [1.0, 1.25, 1.5, 1.75, 2.0],
): IScalingSimulationResult {
  const overflows: IScalingSimulationResult["overflows"] = [];

  for (const scale of scaleFactors) {
    for (const item of items) {
      const fontSize = (item.baseFontSize || 14) * scale;
      const containerWidth = item.baseContainerWidth * scale;

      // Inter font average character advance width is approximately 0.56 * fontSize
      const estimatedTextWidth = item.text.length * fontSize * 0.56;

      if (!item.allowWrapOrEllipsis && estimatedTextWidth > containerWidth) {
        overflows.push({
          componentId: item.componentId,
          scale,
          estimatedTextWidthPx: Math.round(estimatedTextWidth),
          containerWidthPx: Math.round(containerWidth),
          text: item.text,
        });
      }
    }
  }

  return {
    scaleFactors,
    testedItemsCount: items.length,
    overflows,
  };
}

/**
 * Audits accessibility standards (WCAG 2.1 Level A/AA) for components and screen-reader support.
 */
export function auditA11yStandards(
  components: IA11yElementSpec[],
  currentDocumentLang?: string,
): IA11yAuditResult {
  const violations: string[] = [];

  const lang =
    currentDocumentLang || (typeof document !== "undefined" ? document.documentElement?.lang : "");
  const screenReaderLangConfigured = Boolean(lang && (lang === "uk" || lang === "en"));

  if (!screenReaderLangConfigured) {
    violations.push(
      "Document root element does not declare an active 'lang' attribute for screen readers",
    );
  }

  for (const comp of components) {
    // 1. Icon-only action buttons must have an accessible name
    if (comp.isIconOnly && !comp.ariaLabel && !comp.title && !comp.hasVisibleText) {
      violations.push(
        `Interactive icon button '${comp.id}' lacks an accessible name (aria-label or title)`,
      );
    }

    // 2. Dialogs must declare modal role and support keyboard dismiss
    if (comp.isDialog) {
      if (comp.role !== "dialog" && comp.role !== "alertdialog") {
        violations.push(
          `Modal element '${comp.id}' must declare role='dialog' or role='alertdialog'`,
        );
      }
      if (!comp.ariaModal) {
        violations.push(
          `Modal dialog '${comp.id}' must set aria-modal='true' to restrict tab focus`,
        );
      }
      if (!comp.hasKeyboardDismiss) {
        violations.push(`Dialog '${comp.id}' must support keyboard dismissal via Escape key`);
      }
    }
  }

  return {
    passed: violations.length === 0,
    screenReaderLangConfigured,
    screenReaderLang: lang || "undefined",
    violations,
  };
}
