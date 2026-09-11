import React, { useState, useMemo } from "react";

import type {
  ILibraryFilterCriteria,
  IManualCorrectionRecord,
  IUnifiedLibraryItem,
} from "../util/linux/unifiedLibrary/contracts";
import { UnifiedLibraryService } from "../util/linux/unifiedLibrary/unifiedLibraryService";

export interface IUnifiedLibraryViewProps {
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
}

/**
 * Unified Library UI View (Phase 4).
 *
 * Renders a deduplicated library with origin, install state, runtime environment,
 * compatibility status, active mod profile, adapter support tier, launch readiness,
 * explainable duplicate status, and non-destructive manual corrections.
 */
export const UnifiedLibraryView: React.FC<IUnifiedLibraryViewProps> = ({
  items,
  service = new UnifiedLibraryService(),
  onLaunch,
  onApplyCorrection,
  onRevertCorrection,
  onRequestDiagnostics,
}) => {
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

  // Filtered items
  const filteredItems = useMemo(() => {
    return service.filterLibrary(items, filterCriteria);
  }, [items, service, filterCriteria]);

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
        <h1 className="mb-2 text-2xl font-bold tracking-tight">Unified Game Library</h1>
        <p className="text-sm text-slate-400">
          Deduplicated game library across Steam, Heroic, Lutris, Bottles, and manual installs with
          runtime compatibility and mod readiness.
        </p>

        {/* Filters */}
        <div className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-700/60 bg-slate-800/60 p-4 md:grid-cols-4 lg:grid-cols-7">
          {/* Search Query */}
          <div className="col-span-1 md:col-span-2">
            <label
              htmlFor="search-input"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              Search Games
            </label>
            <input
              id="search-input"
              type="text"
              data-testid="library-search-input"
              placeholder="Filter by title, edition, path..."
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
              Launcher
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
              <option value="all">All Launchers</option>
              <option value="steam">Steam</option>
              <option value="heroic">Heroic</option>
              <option value="lutris">Lutris</option>
              <option value="bottles">Bottles</option>
              <option value="manual">Manual / Standalone</option>
            </select>
          </div>

          {/* Runtime Filter */}
          <div>
            <label
              htmlFor="runtime-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              Runtime
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
              <option value="all">All Runtimes</option>
              <option value="linux-native">Native Linux</option>
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
              Mod Support
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
              <option value="all">All Levels</option>
              <option value="supported">Supported</option>
              <option value="community-tested">Community</option>
              <option value="experimental">Experimental</option>
              <option value="unsupported">Unsupported</option>
            </select>
          </div>

          {/* Launch Status Filter */}
          <div>
            <label
              htmlFor="launch-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              Launch Readiness
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
              <option value="all">All States</option>
              <option value="canLaunch">Ready to Launch</option>
              <option value="blocked">Launch Blocked</option>
            </select>
          </div>

          {/* Duplicate Filter */}
          <div>
            <label
              htmlFor="duplicate-filter-select"
              className="mb-1 block text-xs font-semibold text-slate-400"
            >
              Duplicates
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
              <option value="all">All Entries</option>
              <option value="duplicates-only">Duplicates Only</option>
              <option value="unique-only">Unique Only</option>
            </select>
          </div>
        </div>
      </header>

      {/* Library Content Items */}
      {filteredItems.length === 0 ? (
        <div
          data-testid="empty-library-placeholder"
          className="rounded-lg border border-dashed border-slate-700 bg-slate-800/40 py-16 text-center"
        >
          <p className="font-medium text-slate-400">No games match the specified criteria.</p>
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
            Reset all filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4" data-testid="library-grid">
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
                        title={item.duplicateSummary.explanation}
                      >
                        {item.duplicateSummary.category === "multi-install"
                          ? `Duplicate (${item.duplicateSummary.duplicateIndex}/${item.duplicateSummary.totalInGroup})`
                          : "Multi-Launcher"}
                      </span>
                    )}

                    {/* Isolated Edition Note */}
                    {item.duplicateSummary.category === "distinct-edition" && (
                      <span
                        data-testid={`edition-isolation-badge-${item.id}`}
                        className="rounded border border-indigo-800 bg-indigo-950 px-2 py-0.5 text-xs text-indigo-300"
                        title={item.duplicateSummary.explanation}
                      >
                        Isolated Edition
                      </span>
                    )}

                    {/* Manual Correction Indicator */}
                    {item.manualCorrection && (
                      <span
                        data-testid={`manual-correction-badge-${item.id}`}
                        className="rounded border border-emerald-800 bg-emerald-950 px-2 py-0.5 text-xs font-medium text-emerald-300"
                      >
                        User Override Active
                      </span>
                    )}
                  </div>

                  {/* Path & Details */}
                  <div className="mt-2 truncate font-mono text-xs text-slate-400">
                    <span className="text-slate-500">Path:</span> {item.installPath}
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
                      <span>{canLaunch ? "Launch Ready" : "Launch Blocked"}</span>
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
                      <span>Modding: {item.adapterSupport.supportLevel.toUpperCase()}</span>
                    </div>

                    {/* Install State */}
                    <div data-testid={`install-state-${item.id}`} className="text-slate-400">
                      State: {item.installState}
                    </div>

                    {/* Profile */}
                    <div
                      data-testid={`mod-profile-${item.id}`}
                      className="max-w-xs truncate text-slate-400"
                    >
                      Profile: {item.activeModProfile.profileName}
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
                    Diagnostics
                  </button>

                  {/* Manual Correction Button */}
                  <button
                    data-testid={`manual-correction-button-${item.id}`}
                    onClick={() => handleOpenCorrection(item)}
                    className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600"
                  >
                    Correct
                  </button>

                  {/* Launch Button */}
                  <button
                    data-testid={`launch-button-${item.id}`}
                    disabled={!canLaunch}
                    onClick={() => onLaunch?.(item)}
                    title={
                      canLaunch ? "Start game execution" : item.launchAvailability.launchExplanation
                    }
                    className={`rounded px-4 py-1.5 text-xs font-semibold transition ${
                      canLaunch
                        ? "cursor-pointer bg-blue-600 text-white hover:bg-blue-500"
                        : "cursor-not-allowed bg-slate-700/50 text-slate-500"
                    }`}
                  >
                    Launch
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
          <div className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-2xl">
            <h3 className="mb-1 text-xl font-bold text-slate-100">
              Diagnostic Report: {selectedDiagnosticItem.displayName}
            </h3>
            <p className="mb-4 text-xs text-slate-400">
              Comprehensive explanation of launch availability and mod acceptance.
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
                <span className="text-sm font-semibold">Launch Availability</span>
              </div>
              <p data-testid="diagnostic-launch-explanation" className="text-xs text-slate-300">
                {selectedDiagnosticItem.launchAvailability.launchExplanation}
              </p>
              {selectedDiagnosticItem.launchAvailability.blockingReasons.length > 0 && (
                <ul className="mt-2 list-inside list-disc space-y-1 text-xs text-rose-300">
                  {selectedDiagnosticItem.launchAvailability.blockingReasons.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
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
                <span className="text-sm font-semibold">Mod Acceptance Status</span>
              </div>
              <p data-testid="diagnostic-mod-explanation" className="text-xs text-slate-300">
                {selectedDiagnosticItem.adapterSupport.canAcceptMods
                  ? `Compatible adapter '${selectedDiagnosticItem.adapterSupport.adapterName}' active. All required capabilities supported.`
                  : (selectedDiagnosticItem.adapterSupport.modRejectionReason ??
                    "Cannot accept mods.")}
              </p>
              {selectedDiagnosticItem.adapterSupport.unsupportedCapabilities.length > 0 && (
                <div className="mt-2">
                  <span className="text-xs font-semibold text-amber-400">
                    Declared Unsupported Capabilities:
                  </span>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs text-slate-400">
                    {selectedDiagnosticItem.adapterSupport.unsupportedCapabilities.map(
                      (cap, idx) => (
                        <li key={idx}>
                          <span className="font-mono text-amber-300">{cap.kind}</span>: {cap.reason}
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}
            </div>

            {/* Duplicate Analysis Section */}
            <div className="mb-4 rounded border border-slate-700/60 bg-slate-900/70 p-3">
              <span className="mb-1 block text-sm font-semibold">Deduplication & Provenance</span>
              <p data-testid="diagnostic-duplicate-explanation" className="text-xs text-slate-300">
                {selectedDiagnosticItem.duplicateSummary.explanation}
              </p>
            </div>

            <div className="flex justify-end">
              <button
                data-testid="btn-close-diagnostics"
                onClick={() => setSelectedDiagnosticItem(null)}
                className="rounded bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-600"
              >
                Close
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
          <div className="w-full max-w-xl rounded-lg border border-slate-700 bg-slate-800 p-6 shadow-2xl">
            <h3 className="mb-1 text-xl font-bold text-slate-100">
              Manual Correction: {selectedCorrectionItem.displayName}
            </h3>
            <p className="mb-4 text-xs text-amber-400">
              Non-destructive configuration overlay. Launcher source files (VDF, SQLite, JSON) and
              discovery records are NEVER modified.
            </p>

            {/* Form Fields */}
            <div className="space-y-3 text-xs">
              <div>
                <label
                  htmlFor="override-exec-input"
                  className="mb-1 block font-semibold text-slate-300"
                >
                  Executable Path Override
                </label>
                <div className="mb-1 font-mono text-slate-500">
                  Discovered: {selectedCorrectionItem.primaryInstallation.executablePath}
                </div>
                <input
                  id="override-exec-input"
                  type="text"
                  data-testid="input-override-executable"
                  placeholder="Enter custom absolute executable path..."
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
                  Proton / Wine Prefix Override
                </label>
                <div className="mb-1 font-mono text-slate-500">
                  Discovered: {selectedCorrectionItem.primaryInstallation.prefixPath ?? "None"}
                </div>
                <input
                  id="override-prefix-input"
                  type="text"
                  data-testid="input-override-prefix"
                  placeholder="Enter custom prefix directory..."
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
                  Runtime Version Override
                </label>
                <div className="mb-1 font-mono text-slate-500">
                  Discovered: {selectedCorrectionItem.primaryInstallation.runtime ?? "Default"}
                </div>
                <input
                  id="override-runtime-input"
                  type="text"
                  data-testid="input-override-runtime"
                  placeholder="e.g. GE-Proton9-11, proton-9.0..."
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
                  Custom Launch Arguments (space-separated)
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
                  Correction Reason (for audit log)
                </label>
                <input
                  id="override-reason-input"
                  type="text"
                  data-testid="input-override-reason"
                  placeholder="e.g. Relocated to secondary NVMe drive..."
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
                Revert to Launcher Data
              </button>

              <div className="flex items-center gap-2">
                <button
                  data-testid="btn-close-modal"
                  onClick={() => setSelectedCorrectionItem(null)}
                  className="rounded bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-600"
                >
                  Cancel
                </button>
                <button
                  data-testid="btn-save-correction"
                  onClick={handleSaveCorrection}
                  className="rounded bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-blue-500"
                >
                  Save Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
