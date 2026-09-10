/**
 * Translation Issue Categories for community feedback.
 */
export type TranslationIssueCategory =
  | "typo"
  | "grammar"
  | "glossary_mismatch"
  | "clipping_overflow"
  | "unclear_context"
  | "other";

export interface ITranslationFeedbackInput {
  locale: string;
  namespace: string;
  key: string;
  englishSource: string;
  currentTranslation: string;
  suggestedTranslation: string;
  category: TranslationIssueCategory;
  comment?: string;
  vortexVersion?: string;
  desktopEnvironment?: string;
  scaleFactor?: number;
}

export interface ITranslationFeedbackReport extends ITranslationFeedbackInput {
  id: string;
  timestamp: string;
}

export interface ISuggestionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

const DEFAULT_REPO_URL = "https://github.com/Nexus-Mods/Vortex";

/**
 * Validates a proposed translation suggestion against critical localization constraints.
 *
 * Educational comment:
 * Validates that template placeholders (e.g. {{count}}, {{name}}, <0>...</0>) are not
 * accidentally deleted or renamed by contributors, preventing runtime interpolation crashes.
 * Also checks for Russian characters accidentally introduced into Ukrainian translations.
 */
export function validateTranslationSuggestion(
  original: string,
  suggestion: string,
): ISuggestionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const trimmed = suggestion.trim();
  if (trimmed.length === 0) {
    errors.push("Suggested translation cannot be empty");
    return { valid: false, errors, warnings };
  }

  // 1. Placeholder variable preservation (e.g. {{count}}, {{name}})
  const variableRegex = /\{\{([^}]+)\}\}/g;
  const originalVars = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = variableRegex.exec(original)) !== null) {
    originalVars.add(match[1].trim());
  }

  const suggestionVars = new Set<string>();
  while ((match = variableRegex.exec(suggestion)) !== null) {
    suggestionVars.add(match[1].trim());
  }

  for (const v of originalVars) {
    if (!suggestionVars.has(v)) {
      errors.push(`Missing required interpolation placeholder: {{${v}}}`);
    }
  }

  // 2. Trans component tags preservation (e.g. <0>, </0>, <1>, </1>)
  const tagRegex = /<\/?[0-9]+>/g;
  const originalTags = original.match(tagRegex) || [];
  const suggestionTags = suggestion.match(tagRegex) || [];

  if (originalTags.length !== suggestionTags.length) {
    warnings.push(
      `Mismatch in component tags count (expected ${originalTags.length}, got ${suggestionTags.length})`,
    );
  }

  // 3. Check for disallowed Russian letters (ы, э, ъ, ё) in Ukrainian text
  const disallowedRuLettersRegex = /[ыэъёЫЭЪЁ]/;
  if (disallowedRuLettersRegex.test(suggestion)) {
    errors.push("Suggestion contains non-Ukrainian Cyrillic characters (ы, э, ъ, ё)");
  }

  // 4. Excessive length warning (if suggestion is more than 3x longer than original)
  if (original.length > 5 && suggestion.length > original.length * 3) {
    warnings.push(
      "Suggestion is unusually long compared to the source text and may cause UI clipping",
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Builds a structured translation feedback report.
 */
export function buildTranslationFeedback(
  input: ITranslationFeedbackInput,
): ITranslationFeedbackReport {
  const id = `i18n-${input.locale}-${input.namespace}-${Date.now().toString(36)}`;
  return {
    ...input,
    id,
    timestamp: new Date().toISOString(),
    vortexVersion: input.vortexVersion || "1.13.x",
    desktopEnvironment: input.desktopEnvironment || "Linux",
    scaleFactor: input.scaleFactor || 1.0,
  };
}

/**
 * Formats the feedback report as standardized GitHub Issue Markdown.
 */
export function formatFeedbackMarkdown(report: ITranslationFeedbackReport): string {
  const categoryLabels: Record<TranslationIssueCategory, string> = {
    typo: "Typo / Spelling Error (Орфографічна помилка)",
    grammar: "Grammar / Case Error (Граматика / Відмінки)",
    glossary_mismatch: "Terminology Mismatch (Невідповідність глосарію)",
    clipping_overflow: "UI Clipping / Layout Overflow (Обрізання тексту в інтерфейсі)",
    unclear_context: "Unclear Context / Misleading Meaning (Неточний контекст)",
    other: "Other (Інше)",
  };

  return [
    `### [i18n:${report.locale}] Translation Feedback: ${report.namespace}::${report.key}`,
    "",
    "**Category:** " + (categoryLabels[report.category] || report.category),
    `**Namespace:** \`${report.namespace}\``,
    `**Key:** \`${report.key}\``,
    "",
    "#### Current Content",
    "- **English Source:**",
    `  > ${report.englishSource}`,
    `- **Current Displayed (${report.locale}):**`,
    `  > ${report.currentTranslation}`,
    "",
    "#### Proposed Correction",
    `> ${report.suggestedTranslation}`,
    "",
    report.comment ? `#### Rationale & Context\n${report.comment}\n` : "",
    "#### Environment Details",
    `- **App Version:** ${report.vortexVersion}`,
    `- **Platform / Desktop:** ${report.desktopEnvironment}`,
    `- **Display Scaling:** ${(report.scaleFactor ? report.scaleFactor * 100 : 100).toFixed(0)}%`,
    `- **Report ID:** \`${report.id}\``,
    `- **Timestamp:** ${report.timestamp}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Generates a pre-filled GitHub new issue URL for lightweight community translation submissions.
 */
export function generateGitHubIssueUrl(
  report: ITranslationFeedbackReport,
  repositoryUrl: string = DEFAULT_REPO_URL,
): string {
  const title = `[i18n:${report.locale}] Translation fix for ${report.namespace}::${report.key}`;
  const body = formatFeedbackMarkdown(report);
  const labels = `i18n,ukrainian,translation-feedback`;

  const baseUrl = repositoryUrl.endsWith("/") ? repositoryUrl.slice(0, -1) : repositoryUrl;
  const url = new URL(`${baseUrl}/issues/new`);
  url.searchParams.set("title", title);
  url.searchParams.set("body", body);
  url.searchParams.set("labels", labels);

  return url.toString();
}
