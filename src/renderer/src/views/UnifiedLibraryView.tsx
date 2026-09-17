import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type {
  ILibraryFilterCriteria,
  IManualCorrectionRecord,
  IUnifiedLibraryItem,
} from "../util/linux/unifiedLibrary/contracts";
import { UnifiedLibraryService } from "../util/linux/unifiedLibrary/unifiedLibraryService";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function useModalFocus(isOpen: boolean, onClose: () => void) {
  const modalRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const modal = modalRef.current;
    const initialFocus = modal?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ?? modal;
    initialFocus?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || modal === null) return;

      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        modal.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      const returnTarget = returnFocusRef.current;
      window.requestAnimationFrame(() => {
        if (returnTarget?.isConnected) returnTarget.focus();
      });
    };
  }, [isOpen, onClose]);

  return modalRef;
}

export interface IUnifiedLibraryViewProps {
  error?: string;
  isLoading?: boolean;
  isRefreshing?: boolean;
  items: IUnifiedLibraryItem[];
  service?: UnifiedLibraryService;
  onLaunch?: (item: IUnifiedLibraryItem) => void;
  onApplyCorrection?: (
    itemId: string,
    overrides: IManualCorrectionRecord["overrides"],
    reason?: string,
  ) => void;
  onRevertCorrection?: (itemId: string) => void;
  onRequestDiagnostics?: (item: IUnifiedLibraryItem) => void;
  onRefresh?: () => void;
}

/**
 * Unified Library UI View (Phase 4).
 *
 * Renders a deduplicated library with origin, install state, runtime environment,
 * compatibility status, active mod profile, adapter support tier, launch readiness,
 * explainable duplicate status, and non-destructive manual corrections.
 */
export const UnifiedLibraryView: React.FC<IUnifiedLibraryViewProps> = ({
  error,
  isLoading = false,
  isRefreshing = false,
  items,
  service = new UnifiedLibraryService(),
  onLaunch,
  onApplyCorrection,
  onRevertCorrection,
  onRequestDiagnostics,
  onRefresh,
}) => {
  const { t } = useTranslation(["gamemode_management", "common"]);
  const localizeMessage = (
    message: { key: string; values?: Record<string, number | string> } | undefined,
    fallback: string,
  ) => (message === undefined ? fallback : t(message.key, message.values));
  // Filter state
  const [filterCriteria, setFilterCriteria] = useState<ILibraryFilterCriteria>({
    searchQuery: "",
    launcherFilter: "all",
    runtimeFilter: "all",
    supportLevelFilter: "all",
    launchStatusFilter: "all",
    modReadinessFilter: "all",
    duplicateFilter: "all",
    installStateFilter: "all",
  });

  // Modal states
  const [selectedDiagnosticItem, setSelectedDiagnosticItem] = useState<IUnifiedLibraryItem | null>(
    null,
  );
  const [selectedCorrectionItem, setSelectedCorrectionItem] = useState<IUnifiedLibraryItem | null>(
    null,
  );

  // Manual correction form state
  const [correctionExec, setCorrectionExec] = useState("");
  const [correctionPrefix, setCorrectionPrefix] = useState("");
  const [correctionRuntime, setCorrectionRuntime] = useState("");
  const [correctionArgs, setCorrectionArgs] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const closeDiagnostics = useCallback(() => setSelectedDiagnosticItem(null), []);
  const closeCorrection = useCallback(() => setSelectedCorrectionItem(null), []);
  const diagnosticsModalRef = useModalFocus(selectedDiagnosticItem !== null, closeDiagnostics);
  const correctionModalRef = useModalFocus(selectedCorrectionItem !== null, closeCorrection);

  // Filtered items
  const filteredItems = useMemo(() => {
    return service.filterLibrary(items, filterCriteria);
  }, [items, service, filterCriteria]);
  const selectedDiagnosticReport = useMemo(
    () =>
      selectedDiagnosticItem === null ? null : service.getDiagnosticReport(selectedDiagnosticItem),
    [selectedDiagnosticItem, service],
  );

  // Open correction modal with existing data
  const handleOpenCorrection = (item: IUnifiedLibraryItem) => {
    setSelectedCorrectionItem(item);
    setCorrectionExec(item.manualCorrection?.overrides.executablePath ?? "");
    setCorrectionPrefix(item.manualCorrection?.overrides.prefixPath ?? "");
    setCorrectionRuntime(item.manualCorrection?.overrides.runtime ?? "");
    setCorrectionArgs(item.manualCorrection?.overrides.customLaunchArgs?.join(" ") ?? "");
    setCorrectionReason(item.manualCorrection?.reason ?? "");
  };

  const handleSaveCorrection = () => {
    if (!selectedCorrectionItem) return;

    const overrides: IManualCorrectionRecord["overrides"] = {};
    if (correctionExec.trim() !== "") {
      overrides.executablePath = correctionExec.trim();
    }
    if (correctionPrefix.trim() !== "") {
      overrides.prefixPath = correctionPrefix.trim();
    }
    if (correctionRuntime.trim() !== "") {
      overrides.runtime = correctionRuntime.trim();
    }
    if (correctionArgs.trim() !== "") {
      overrides.customLaunchArgs = correctionArgs.trim().split(/\s+/).filter(Boolean);
    }

    if (onApplyCorrection) {
      onApplyCorrection(selectedCorrectionItem.id, overrides, correctionReason.trim() || undefined);
    } else {
      service.manualCorrections.applyCorrection(
        selectedCorrectionItem.primaryInstallation,
        overrides,
        correctionReason.trim() || undefined,
      );
    }

    setSelectedCorrectionItem(null);
  };

  const handleRevertCorrection = () => {
    if (!selectedCorrectionItem) return;

    if (onRevertCorrection) {
      onRevertCorrection(selectedCorrectionItem.id);
    } else {
      service.manualCorrections.revertCorrection(selectedCorrectionItem.id);
    }

    setSelectedCorrectionItem(null);
  };

  return (
    <div
      className="min-h-screen bg-slate-900 p-6 text-slate-100"
      data-testid="unified-library-view"
    >
      {/* Header and Filter Toolbar */}
      <header className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-2 text-2xl font-bold tracking-tight">
              {t("unified_library::header::title")}
            </h1>
            <p className="text-sm text-slate-400">{t("unified_library::header::description")}</p>
          </div>
          {onRefresh && (
            <button
              aria-busy={isRefreshing || isLoading}
              className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600 disabled:cursor-wait disabled:opacity-60"
              data-testid="library-refresh-button"
              disabled={isRefreshing || isLoading}
              onClick={onRefresh}
            >
              {isRefreshing || isLoading
                ? t("unified_library::actions::refreshing")
                : t("unified_library::actions::refresh")}
            </button>
          )}
        </div>

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-700/60 bg-slate-800/60 p-4 md:grid-cols-4 lg:grid-cols-7">
          {/* Search Query */}
          <div className="col-span-1 md:col-span-2">
            <label
              htmlFor="search-input"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              {t("unified_library::filters::search_label")}
            </label>
            <input
              id="search-input"
              type="text"
              data-testid="library-search-input"
              placeholder={t("unified_library::filters::search_placeholder")}
              value={filterCriteria.searchQuery ?? ""}
              onChange={(e) =>
                setFilterCriteria({
                  ...filterCriteria,
                  searchQuery: e.target.value,
                })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Launcher Filter */}
          <div>
            <label
              htmlFor="launcher-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              {t("unified_library::filters::launcher_label")}
            </label>
            <select
              id="launcher-filter-select"
              data-testid="library-launcher-filter"
              value={filterCriteria.launcherFilter ?? "all"}
              onChange={(e) =>
                setFilterCriteria({
                  ...filterCriteria,
                  launcherFilter: e.target.value as any,
                })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
            >
              <option value="all">{t("unified_library::filters::all_launchers")}</option>
              <option value="steam">Steam</option>
              <option value="heroic">Heroic</option>
              <option value="lutris">Lutris</option>
              <option value="bottles">Bottles</option>
              <option value="manual">{t("unified_library::filters::manual_launcher")}</option>
            </select>
          </div>

          {/* Runtime Filter */}
          <div>
            <label
              htmlFor="runtime-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              {t("unified_library::filters::runtime_label")}
            </label>
            <select
              id="runtime-filter-select"
              data-testid="library-runtime-filter"
              value={filterCriteria.runtimeFilter ?? "all"}
              onChange={(e) =>
                setFilterCriteria({
                  ...filterCriteria,
                  runtimeFilter: e.target.value as any,
                })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
            >
              <option value="all">{t("unified_library::filters::all_runtimes")}</option>
              <option value="linux-native">{t("unified_library::filters::native_linux")}</option>
              <option value="windows-proton">Proton</option>
              <option value="windows-wine">Wine</option>
            </select>
          </div>

          {/* Adapter Support Filter */}
          <div>
            <label
              htmlFor="support-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              {t("unified_library::filters::mod_support_label")}
            </label>
            <select
              id="support-filter-select"
              data-testid="library-support-filter"
              value={filterCriteria.supportLevelFilter ?? "all"}
              onChange={(e) =>
                setFilterCriteria({
                  ...filterCriteria,
                  supportLevelFilter: e.target.value as any,
                })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
            >
              <option value="all">{t("unified_library::filters::all_levels")}</option>
              <option value="supported">{t("unified_library::support::supported")}</option>
              <option value="community-tested">
                {t("unified_library::support::community_tested")}
              </option>
              <option value="experimental">{t("unified_library::support::experimental")}</option>
              <option value="unsupported">{t("unified_library::support::unsupported")}</option>
            </select>
          </div>

          {/* Launch Status Filter */}
          <div>
            <label
              htmlFor="launch-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              {t("unified_library::filters::launch_readiness_label")}
            </label>
            <select
              id="launch-filter-select"
              data-testid="library-launch-filter"
              value={filterCriteria.launchStatusFilter ?? "all"}
              onChange={(e) =>
                setFilterCriteria({
                  ...filterCriteria,
                  launchStatusFilter: e.target.value as any,
                })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
            >
              <option value="all">{t("unified_library::filters::all_states")}</option>
              <option value="canLaunch">{t("unified_library::status::ready_to_launch")}</option>
              <option value="blocked">{t("unified_library::status::launch_blocked")}</option>
            </select>
          </div>

          {/* Duplicate Filter */}
          <div>
            <label
              htmlFor="duplicate-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              {t("unified_library::filters::duplicates_label")}
            </label>
            <select
              id="duplicate-filter-select"
              data-testid="library-duplicate-filter"
              value={filterCriteria.duplicateFilter ?? "all"}
              onChange={(e) =>
                setFilterCriteria({
                  ...filterCriteria,
                  duplicateFilter: e.target.value as any,
                })
              }
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-sm text-slate-200"
            >
              <option value="all">{t("unified_library::filters::all_entries")}</option>
              <option value="duplicates-only">
                {t("unified_library::filters::duplicates_only")}
              </option>
              <option value="unique-only">{t("unified_library::filters::unique_only")}</option>
            </select>
          </div>
        </div>
      </header>

      {/* Library Content Items */}
      {error !== undefined ? (
        <div
          className="rounded-lg border border-rose-800 bg-rose-950/50 p-6 text-center"
          data-testid="library-error-placeholder"
          role="alert"
        >
          <p className="font-semibold text-rose-200">{t("unified_library::error::title")}</p>
          <p className="mt-1 text-sm text-rose-300">{t("unified_library::error::description")}</p>
          <p className="mt-2 font-mono text-xs text-rose-400">{error}</p>
          {onRefresh && (
            <button
              className="mt-4 rounded bg-rose-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-700"
              onClick={onRefresh}
            >
              {t("unified_library::actions::try_again")}
            </button>
          )}
        </div>
      ) : isLoading ? (
        <div
          aria-live="polite"
          className="rounded-lg border border-slate-700 bg-slate-800/40 py-16 text-center"
          data-testid="library-loading-placeholder"
        >
          <p className="font-medium text-slate-300">{t("unified_library::loading::title")}</p>
          <p className="mt-1 text-sm text-slate-400">
            {t("unified_library::loading::description")}
          </p>
        </div>
      ) : items.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-slate-700 bg-slate-800/40 py-16 text-center"
          data-testid="empty-library-placeholder"
        >
          <p className="font-medium text-slate-400">{t("unified_library::empty::no_games")}</p>
          <p className="mt-1 text-sm text-slate-500">
            {t("unified_library::empty::no_games_description")}
          </p>
          {onRefresh && (
            <button className="mt-3 text-xs text-blue-400 hover:underline" onClick={onRefresh}>
              {t("unified_library::actions::refresh")}
            </button>
          )}
        </div>
      ) : filteredItems.length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-slate-700 bg-slate-800/40 py-16 text-center"
          data-testid="no-filter-results-placeholder"
        >
          <p className="font-medium text-slate-400">{t("unified_library::empty::no_matches")}</p>
          <button
            onClick={() =>
              setFilterCriteria({
                searchQuery: "",
                launcherFilter: "all",
                runtimeFilter: "all",
                supportLevelFilter: "all",
                launchStatusFilter: "all",
                modReadinessFilter: "all",
                duplicateFilter: "all",
                installStateFilter: "all",
              })
            }
            className="mt-3 text-xs text-blue-400 hover:underline"
          >
            {t("unified_library::empty::reset_filters")}
          </button>
        </div>
      ) : (
        <div aria-busy={isRefreshing} className="grid grid-cols-1 gap-4" data-testid="library-grid">
          {isRefreshing && (
            <div
              aria-live="polite"
              className="rounded border border-blue-800 bg-blue-950/50 px-3 py-2 text-xs text-blue-200"
              data-testid="library-refreshing-status"
            >
              {t("unified_library::loading::refreshing")}
            </div>
          )}
          {filteredItems.map((item) => {
            const canLaunch = item.launchAvailability.canLaunch;
            const canAcceptMods = item.adapterSupport.canAcceptMods;

            return (
              <div
                key={item.id}
                data-testid={`library-item-${item.id}`}
                className="flex flex-col justify-between gap-4 rounded-lg border border-slate-700 bg-slate-800/80 p-4 transition hover:border-slate-600 md:flex-row md:items-center"
              >
                {/* Left Section: Info and Badges */}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-semibold text-slate-100">
                      {item.displayName}
                    </h2>

                    {/* Edition Badge */}
                    <span
                      data-testid={`edition-badge-${item.id}`}
                      className="rounded border border-purple-700/60 bg-purple-900/60 px-2 py-0.5 text-xs font-medium text-purple-200"
                    >
                      {item.editionId}
                    </span>

                    {/* Platform & Runtime */}
                    <span
                      data-testid={`runtime-info-${item.id}`}
                      className="rounded bg-slate-700 px-2 py-0.5 font-mono text-xs text-slate-300"
                    >
                      {item.runtime.runtimeName}
                    </span>

                    {/* Origins */}
                    {item.origins.map((origin, idx) => (
                      <span
                        key={idx}
                        data-testid={`origin-badge-${item.id}-${origin.launcher}`}
                        className="rounded border border-blue-800 bg-blue-950 px-2 py-0.5 text-xs text-blue-300"
                      >
                        {origin.launcher.toUpperCase()}
                      </span>
                    ))}

                    {/* Duplicate Badge */}
                    {item.duplicateSummary.isDuplicate && (
                      <span
                        data-testid={`duplicate-badge-${item.id}`}
                        className={`rounded px-2 py-0.5 text-xs font-semibold ${
                          item.duplicateSummary.category === "multi-install"
                            ? "border border-amber-800 bg-amber-950 text-amber-300"
                            : "border border-cyan-800 bg-cyan-950 text-cyan-300"
                        }`}
                        title={localizeMessage(
                          item.duplicateSummary.explanationMessage,
                          item.duplicateSummary.explanation,
                        )}
                      >
                        {item.duplicateSummary.category === "multi-install"
                          ? t("unified_library::badges::duplicate", {
                              current: item.duplicateSummary.duplicateIndex,
                              total: item.duplicateSummary.totalInGroup,
                            })
                          : t("unified_library::badges::multi_launcher")}
                      </span>
                    )}

                    {/* Isolated Edition Note */}
                    {item.duplicateSummary.category === "distinct-edition" && (
                      <span
                        data-testid={`edition-isolation-badge-${item.id}`}
                        className="rounded border border-indigo-800 bg-indigo-950 px-2 py-0.5 text-xs text-indigo-300"
                        title={localizeMessage(
                          item.duplicateSummary.explanationMessage,
                          item.duplicateSummary.explanation,
                        )}
                      >
                        {t("unified_library::badges::isolated_edition")}
                      </span>
                    )}

                    {/* Manual Correction Indicator */}
                    {item.manualCorrection && (
                      <span
                        data-testid={`manual-correction-badge-${item.id}`}
                        className="rounded border border-emerald-800 bg-emerald-950 px-2 py-0.5 text-xs font-medium text-emerald-300"
                      >
                        {t("unified_library::badges::user_override_active")}
                      </span>
                    )}
                  </div>

                  {/* Path & Details */}
                  <div className="mt-2 truncate font-mono text-xs text-slate-400">
                    <span className="text-slate-500">{t("unified_library::labels::path")}:</span>{" "}
                    {item.installPath}
                  </div>

                  {/* Status indicators */}
                  <div className="mt-2 flex items-center gap-4 text-xs">
                    {/* Launch Status */}
                    <div
                      data-testid={`launch-status-${item.id}`}
                      className={`flex items-center gap-1.5 font-medium ${
                        canLaunch ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          canLaunch ? "bg-emerald-400" : "bg-rose-400"
                        }`}
                      />
                      <span>
                        {canLaunch
                          ? t("unified_library::status::launch_ready")
                          : t("unified_library::status::launch_blocked")}
                      </span>
                    </div>

                    {/* Mod Support Status */}
                    <div
                      data-testid={`adapter-support-${item.id}`}
                      className={`flex items-center gap-1.5 font-medium ${
                        canAcceptMods ? "text-cyan-400" : "text-amber-400"
                      }`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          canAcceptMods ? "bg-cyan-400" : "bg-amber-400"
                        }`}
                      />
                      <span>
                        {t("unified_library::labels::modding")}:{" "}
                        {t(
                          `unified_library::support::${item.adapterSupport.supportLevel.replace("-", "_")}`,
                        )}
                      </span>
                    </div>

                    {/* Install State */}
                    <div data-testid={`install-state-${item.id}`} className="text-slate-400">
                      {t("unified_library::labels::state")}: {item.installState}
                    </div>

                    {/* Profile */}
                    <div
                      data-testid={`mod-profile-${item.id}`}
                      className="max-w-xs truncate text-slate-400"
                    >
                      {t("unified_library::labels::profile")}: {item.activeModProfile.profileName}
                    </div>
                  </div>
                </div>

                {/* Right Section: Actions */}
                <div className="flex shrink-0 items-center gap-2 self-end md:self-center">
                  {/* Diagnostics Button */}
                  <button
                    data-testid={`diagnostics-button-${item.id}`}
                    onClick={() => {
                      if (onRequestDiagnostics) {
                        onRequestDiagnostics(item);
                      }
                      setSelectedDiagnosticItem(item);
                    }}
                    className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600"
                  >
                    {t("unified_library::actions::diagnostics")}
                  </button>

                  {/* Manual Correction Button */}
                  <button
                    data-testid={`manual-correction-button-${item.id}`}
                    onClick={() => handleOpenCorrection(item)}
                    className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600"
                  >
                    {t("unified_library::actions::correct")}
                  </button>

                  {/* Launch Button */}
                  <button
                    data-testid={`launch-button-${item.id}`}
                    disabled={!canLaunch}
                    onClick={() => onLaunch?.(item)}
                    title={
                      canLaunch
                        ? t("unified_library::actions::launch_tooltip")
                        : localizeMessage(
                            item.launchAvailability.launchExplanationMessage,
                            item.launchAvailability.launchExplanation,
                          )
                    }
                    className={`rounded px-4 py-1.5 text-xs font-semibold transition ${
                      canLaunch
                        ? "cursor-pointer bg-blue-600 text-white hover:bg-blue-500"
                        : "cursor-not-allowed bg-slate-700/50 text-slate-500"
                    }`}
                  >
                    {t("unified_library::actions::launch")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Diagnostics Modal */}
      {selectedDiagnosticItem && (
        <div
          data-testid="diagnostics-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            ref={diagnosticsModalRef}
            aria-modal="true"
            aria-labelledby="unified-library-diagnostics-title"
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-2xl"
            role="dialog"
            tabIndex={-1}
          >
            <h3
              id="unified-library-diagnostics-title"
              className="mb-1 text-xl font-bold text-slate-100"
            >
              {t("unified_library::diagnostics::title", {
                game: selectedDiagnosticItem.displayName,
              })}
            </h3>
            <p className="mb-4 text-xs text-slate-400">
              {t("unified_library::diagnostics::description")}
            </p>

            {/* Launch Status Section */}
            <div className="mb-4 rounded border border-slate-700/60 bg-slate-900/70 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${
                    selectedDiagnosticItem.launchAvailability.canLaunch
                      ? "bg-emerald-400"
                      : "bg-rose-500"
                  }`}
                />
                <span className="text-sm font-semibold">
                  {t("unified_library::diagnostics::launch_availability")}
                </span>
              </div>
              <p data-testid="diagnostic-launch-explanation" className="text-xs text-slate-300">
                {localizeMessage(
                  selectedDiagnosticItem.launchAvailability.launchExplanationMessage,
                  selectedDiagnosticItem.launchAvailability.launchExplanation,
                )}
              </p>
              {selectedDiagnosticItem.launchAvailability.blockingReasons.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-rose-300">
                  {selectedDiagnosticItem.launchAvailability.blockingReasons.map((reason, idx) => (
                    <li key={idx}>
                      {localizeMessage(
                        selectedDiagnosticItem.launchAvailability.blockingReasonMessages?.[idx],
                        reason,
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Mod Support Section */}
            <div className="mb-4 rounded border border-slate-700/60 bg-slate-900/70 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className={`h-3 w-3 rounded-full ${
                    selectedDiagnosticItem.adapterSupport.canAcceptMods
                      ? "bg-cyan-400"
                      : "bg-amber-500"
                  }`}
                />
                <span className="text-sm font-semibold">
                  {t("unified_library::diagnostics::mod_acceptance")}
                </span>
              </div>
              <p data-testid="diagnostic-mod-explanation" className="text-xs text-slate-300">
                {selectedDiagnosticItem.adapterSupport.canAcceptMods
                  ? t("unified_library::diagnostics::compatible_adapter", {
                      adapter: selectedDiagnosticItem.adapterSupport.adapterName,
                    })
                  : localizeMessage(
                      selectedDiagnosticItem.adapterSupport.modRejectionMessage,
                      selectedDiagnosticItem.adapterSupport.modRejectionReason ??
                        t("unified_library::diagnostics::cannot_accept_mods"),
                    )}
              </p>
              {selectedDiagnosticItem.adapterSupport.unsupportedCapabilities.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-semibold text-amber-400">
                    {t("unified_library::diagnostics::unsupported_capabilities")}:
                  </span>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-400">
                    {selectedDiagnosticItem.adapterSupport.unsupportedCapabilities.map(
                      (cap, idx) => (
                        <li key={idx}>
                          <span className="font-mono text-amber-300">{cap.kind}</span>: {cap.reason}
                          <span className="sr-only">
                            {t("unified_library::diagnostics::adapter_authored_reason")}
                          </span>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* Duplicate Analysis Section */}
            <div className="mb-4 rounded border border-slate-700/60 bg-slate-900/70 p-3">
              <span className="mb-1 block text-sm font-semibold">
                {t("unified_library::diagnostics::deduplication")}
              </span>
              <p data-testid="diagnostic-duplicate-explanation" className="text-xs text-slate-300">
                {localizeMessage(
                  selectedDiagnosticItem.duplicateSummary.explanationMessage,
                  selectedDiagnosticItem.duplicateSummary.explanation,
                )}
              </p>
            </div>

            {selectedDiagnosticReport && (
              <section
                aria-labelledby="unified-library-full-report-title"
                className="mb-4 rounded border border-slate-700/60 bg-slate-900/70 p-3"
                data-testid="diagnostic-full-report"
              >
                <h4
                  id="unified-library-full-report-title"
                  className="mb-3 text-sm font-semibold text-slate-100"
                >
                  {t("unified_library::diagnostics::full_report")}
                </h4>
                <div className="space-y-2">
                  {selectedDiagnosticReport.checks.map((check) => (
                    <div
                      key={`${check.domain}:${check.check}`}
                      className="rounded border border-slate-700 bg-slate-800/70 p-3"
                      data-testid={`diagnostic-check-${check.domain}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-slate-200">
                          {localizeMessage(check.checkDescriptor, check.check)}
                        </span>
                        <span
                          className={`text-xs font-semibold ${
                            check.passed ? "text-emerald-400" : "text-rose-400"
                          }`}
                        >
                          {check.passed
                            ? t("unified_library::diagnostics::passed")
                            : t("unified_library::diagnostics::failed")}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-slate-300">
                        {localizeMessage(check.messageDescriptor, check.message)}
                      </p>
                      {check.resolutionHint && (
                        <p className="mt-2 text-xs text-amber-300">
                          <span className="font-semibold">
                            {t("unified_library::diagnostics::recommendation")}:
                          </span>{" "}
                          {localizeMessage(check.resolutionDescriptor, check.resolutionHint)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <p
                  aria-live="polite"
                  className="mt-3 border-t border-slate-700 pt-3 text-xs font-medium text-slate-200"
                  data-testid="diagnostic-report-summary"
                >
                  {localizeMessage(
                    selectedDiagnosticReport.summaryDescriptor,
                    selectedDiagnosticReport.summary,
                  )}
                </p>
              </section>
            )}

            <div className="flex justify-end">
              <button
                data-testid="btn-close-diagnostics"
                onClick={closeDiagnostics}
                className="rounded bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-600"
              >
                {t("unified_library::actions::close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Correction Modal */}
      {selectedCorrectionItem && (
        <div
          data-testid="manual-correction-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div
            ref={correctionModalRef}
            aria-modal="true"
            aria-labelledby="unified-library-correction-title"
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-2xl"
            role="dialog"
            tabIndex={-1}
          >
            <h3
              id="unified-library-correction-title"
              className="mb-1 text-xl font-bold text-slate-100"
            >
              {t("unified_library::correction::title", {
                game: selectedCorrectionItem.displayName,
              })}
            </h3>
            <p className="mb-4 text-xs text-amber-400">
              {t("unified_library::correction::description")}
            </p>

            {/* Form Fields */}
            <div className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="override-exec-input"
                  className="mb-1 block font-semibold text-slate-300"
                >
                  {t("unified_library::correction::executable_label")}
                </label>
                <div className="mb-1 font-mono text-slate-500">
                  {t("unified_library::correction::discovered")}:{" "}
                  {selectedCorrectionItem.primaryInstallation.executablePath}
                </div>
                <input
                  id="override-exec-input"
                  type="text"
                  data-testid="input-override-executable"
                  placeholder={t("unified_library::correction::executable_placeholder")}
                  value={correctionExec}
                  onChange={(e) => setCorrectionExec(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
                />
              </div>

              <div>
                <label
                  htmlFor="override-prefix-input"
                  className="mb-1 block font-semibold text-slate-300"
                >
                  {t("unified_library::correction::prefix_label")}
                </label>
                <div className="mb-1 font-mono text-slate-500">
                  {t("unified_library::correction::discovered")}:{" "}
                  {selectedCorrectionItem.primaryInstallation.prefixPath ??
                    t("unified_library::values::none")}
                </div>
                <input
                  id="override-prefix-input"
                  type="text"
                  data-testid="input-override-prefix"
                  placeholder={t("unified_library::correction::prefix_placeholder")}
                  value={correctionPrefix}
                  onChange={(e) => setCorrectionPrefix(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
                />
              </div>

              <div>
                <label
                  htmlFor="override-runtime-input"
                  className="mb-1 block font-semibold text-slate-300"
                >
                  {t("unified_library::correction::runtime_label")}
                </label>
                <div className="mb-1 font-mono text-slate-500">
                  {t("unified_library::correction::discovered")}:{" "}
                  {selectedCorrectionItem.primaryInstallation.runtime ??
                    t("unified_library::values::default")}
                </div>
                <input
                  id="override-runtime-input"
                  type="text"
                  data-testid="input-override-runtime"
                  placeholder={t("unified_library::correction::runtime_placeholder")}
                  value={correctionRuntime}
                  onChange={(e) => setCorrectionRuntime(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
                />
              </div>

              <div>
                <label
                  htmlFor="override-args-input"
                  className="mb-1 block font-semibold text-slate-300"
                >
                  {t("unified_library::correction::arguments_label")}
                </label>
                <input
                  id="override-args-input"
                  type="text"
                  data-testid="input-override-args"
                  placeholder="-skipintro -novid +fps_max 144"
                  value={correctionArgs}
                  onChange={(e) => setCorrectionArgs(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 font-mono text-slate-200"
                />
              </div>

              <div>
                <label
                  htmlFor="override-reason-input"
                  className="mb-1 block font-semibold text-slate-300"
                >
                  {t("unified_library::correction::reason_label")}
                </label>
                <input
                  id="override-reason-input"
                  type="text"
                  data-testid="input-override-reason"
                  placeholder={t("unified_library::correction::reason_placeholder")}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  className="w-full rounded border border-slate-700 bg-slate-950 px-3 py-1.5 text-slate-200"
                />
              </div>
            </div>

            {/* Buttons */}
            <div className="mt-6 flex items-center justify-between">
              <button
                data-testid="btn-revert-correction"
                onClick={handleRevertCorrection}
                className="rounded border border-rose-700/60 bg-rose-900/60 px-3 py-1.5 text-xs font-medium text-rose-200 transition hover:bg-rose-800"
              >
                {t("unified_library::actions::revert")}
              </button>

              <div className="flex items-center gap-2">
                <button
                  data-testid="btn-close-modal"
                  onClick={closeCorrection}
                  className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600"
                >
                  {t("unified_library::actions::cancel")}
                </button>
                <button
                  data-testid="btn-save-correction"
                  onClick={handleSaveCorrection}
                  className="rounded bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                  {t("unified_library::actions::save_override")}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
