import React, { useState, useMemo } from "react";
import { Alert, Button, ControlLabel, FormControl, FormGroup, Modal } from "react-bootstrap";

import {
  buildTranslationFeedback,
  formatFeedbackMarkdown,
  generateGitHubIssueUrl,
  validateTranslationSuggestion,
  type TranslationIssueCategory,
} from "./translationFeedback";

export interface ITranslationFeedbackDialogProps {
  show: boolean;
  onHide: () => void;
  locale?: string;
  namespace?: string;
  translationKey?: string;
  englishSource?: string;
  currentTranslation?: string;
  onCopySuccess?: (markdown: string) => void;
  onOpenUrl?: (url: string) => void;
}

/**
 * Accessible Modal dialog for collecting lightweight translation issue reports from users.
 *
 * Educational comment:
 * Implements WCAG 2.1 dialog standards with role="dialog", aria-modal="true",
 * aria-labelledby pointing to the title, and live validation of contributions
 * to prevent broken placeholder variables.
 */
export const TranslationFeedbackDialog: React.FC<ITranslationFeedbackDialogProps> = ({
  show,
  onHide,
  locale = "uk",
  namespace = "common",
  translationKey = "",
  englishSource = "",
  currentTranslation = "",
  onCopySuccess,
  onOpenUrl,
}) => {
  const [category, setCategory] = useState<TranslationIssueCategory>("typo");
  const [suggestion, setSuggestion] = useState<string>("");
  const [comment, setComment] = useState<string>("");
  const [copied, setCopied] = useState<boolean>(false);

  const validation = useMemo(() => {
    if (!suggestion) return { valid: false, errors: [], warnings: [] };
    return validateTranslationSuggestion(englishSource, suggestion);
  }, [englishSource, suggestion]);

  const report = useMemo(() => {
    return buildTranslationFeedback({
      locale,
      namespace,
      key: translationKey,
      englishSource,
      currentTranslation,
      suggestedTranslation: suggestion,
      category,
      comment,
    });
  }, [
    locale,
    namespace,
    translationKey,
    englishSource,
    currentTranslation,
    suggestion,
    category,
    comment,
  ]);

  const handleCopy = () => {
    const md = formatFeedbackMarkdown(report);
    if (onCopySuccess) {
      onCopySuccess(md);
    } else if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(md).catch(() => {});
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const handleOpenGitHub = () => {
    const url = generateGitHubIssueUrl(report);
    if (onOpenUrl) {
      onOpenUrl(url);
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <Modal
      show={show}
      onHide={onHide}
      role="dialog"
      aria-modal="true"
      aria-labelledby="translation-feedback-title"
      backdrop="static"
    >
      <Modal.Header closeButton>
        <Modal.Title id="translation-feedback-title">
          Повідомити про проблему перекладу / Translation Feedback
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <FormGroup controlId="fb-meta">
          <ControlLabel>Ключ / Translation Key</ControlLabel>
          <FormControl
            type="text"
            readOnly
            value={`${namespace}::${translationKey || "general"}`}
          />
        </FormGroup>

        {englishSource && (
          <FormGroup controlId="fb-source">
            <ControlLabel>Оригінал (English)</ControlLabel>
            <div className="well well-sm" style={{ marginBottom: 0 }}>
              <code>{englishSource}</code>
            </div>
          </FormGroup>
        )}

        {currentTranslation && (
          <FormGroup controlId="fb-current">
            <ControlLabel>Поточний переклад (Ukrainian)</ControlLabel>
            <div className="well well-sm" style={{ marginBottom: 0 }}>
              <code>{currentTranslation}</code>
            </div>
          </FormGroup>
        )}

        <FormGroup controlId="fb-category">
          <ControlLabel>Категорія проблеми / Issue Category</ControlLabel>
          <FormControl
            componentClass="select"
            value={category}
            onChange={(e: any) => setCategory(e.target.value as TranslationIssueCategory)}
          >
            <option value="typo">Орфографічна помилка / Typo</option>
            <option value="grammar">Граматика / Відмінки / Grammar</option>
            <option value="glossary_mismatch">Невідповідність глосарію / Glossary Mismatch</option>
            <option value="clipping_overflow">Обрізання тексту в UI / Layout Overflow</option>
            <option value="unclear_context">Неточний контекст / Unclear Meaning</option>
            <option value="other">Інше / Other</option>
          </FormControl>
        </FormGroup>

        <FormGroup
          controlId="fb-suggestion"
          validationState={suggestion && !validation.valid ? "error" : undefined}
        >
          <ControlLabel>Запропоноване виправлення / Suggested Fix *</ControlLabel>
          <FormControl
            componentClass="textarea"
            rows={3}
            placeholder="Введіть правильний переклад..."
            value={suggestion}
            onChange={(e: any) => setSuggestion(e.target.value)}
          />
          {validation.errors.map((err, idx) => (
            <Alert
              key={idx}
              bsStyle="danger"
              style={{ marginTop: "6px", marginBottom: "6px", padding: "6px 10px" }}
            >
              {err}
            </Alert>
          ))}
          {validation.warnings.map((warn, idx) => (
            <Alert
              key={idx}
              bsStyle="warning"
              style={{ marginTop: "6px", marginBottom: "6px", padding: "6px 10px" }}
            >
              {warn}
            </Alert>
          ))}
        </FormGroup>

        <FormGroup controlId="fb-comment">
          <ControlLabel>Коментар / Rationale (необов&apos;язково)</ControlLabel>
          <FormControl
            componentClass="textarea"
            rows={2}
            placeholder="Поясніть контекст або причину виправлення..."
            value={comment}
            onChange={(e: any) => setComment(e.target.value)}
          />
        </FormGroup>
      </Modal.Body>

      <Modal.Footer>
        <Button onClick={onHide}>Закрити</Button>
        <Button
          bsStyle="default"
          disabled={!suggestion.trim() || !validation.valid}
          onClick={handleCopy}
        >
          {copied ? "Скопійовано!" : "Скопіювати звіт"}
        </Button>
        <Button
          bsStyle="primary"
          disabled={!suggestion.trim() || !validation.valid}
          onClick={handleOpenGitHub}
        >
          Відкрити на GitHub
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
