import React from "react";
import {
  Alert,
  Badge,
  Button,
  ButtonGroup,
  ControlLabel,
  FormControl,
  FormGroup,
  Label,
  Table,
} from "react-bootstrap";

import type { DiscoveredResourceKind, DiscoveryConfidence } from "./contracts";
import {
  CustomRootsRegistry,
  validateCustomRootCandidate,
  type CustomRootScope,
  type IUserApprovedCustomRoot,
} from "./customRootsRegistry";
import { generateRedactedDiscoveryReport } from "./discoveryDiagnostics";
import {
  runUnifiedResourceDiscovery,
  type IDiscoveryExecutionReport,
} from "./resourceDiscoveryEngine";

export interface IDiscoveryDiagnosticsViewProps {
  initialReport?: IDiscoveryExecutionReport;
  customRootsRegistry?: CustomRootsRegistry;
  onRescan?: () => Promise<IDiscoveryExecutionReport>;
}

/**
 * Discovery Diagnostics and Custom Roots UI (Phases 8 & 9).
 *
 * Educational comment:
 * Renders an interactive diagnostic dashboard displaying discovered Linux resources,
 * confidence assessments, sandbox permissions, and corroborating evidence.
 * Allows safe rescan operations, copying privacy-redacted reports, and managing
 * user-approved custom directory roots without unbounded filesystem crawling.
 */
export const DiscoveryDiagnosticsView: React.FC<IDiscoveryDiagnosticsViewProps> = ({
  initialReport = { scannedSourcesCount: 0, resources: [], errors: [] },
  customRootsRegistry = new CustomRootsRegistry(),
  onRescan,
}) => {
  const [activeTab, setActiveTab] = React.useState<"resources" | "custom-roots">("resources");
  const [report, setReport] = React.useState<IDiscoveryExecutionReport>(initialReport);
  const [isScanning, setIsScanning] = React.useState<boolean>(false);
  const [lastRefresh, setLastRefresh] = React.useState<number>(Date.now());
  const [copied, setCopied] = React.useState<boolean>(false);

  // Filter state
  const [kindFilter, setKindFilter] = React.useState<string>("all");
  const [confidenceFilter, setConfidenceFilter] = React.useState<string>("all");
  const [searchQuery, setSearchQuery] = React.useState<string>("");

  // Custom roots management state
  const [customRoots, setCustomRoots] = React.useState<IUserApprovedCustomRoot[]>(
    customRootsRegistry.getRoots(),
  );
  const [newRootPath, setNewRootPath] = React.useState<string>("");
  const [newRootScope, setNewRootScope] = React.useState<CustomRootScope>("all");
  const [newRootLabel, setNewRootLabel] = React.useState<string>("");
  const [customRootError, setCustomRootError] = React.useState<string | null>(null);

  const handleRescan = React.useCallback(async () => {
    setIsScanning(true);
    try {
      if (onRescan) {
        const result = await onRescan();
        setReport(result);
      } else {
        const customRootsList = customRootsRegistry.getRoots().map((r) => r.path);
        const result = await runUnifiedResourceDiscovery({
          customRoots: customRootsList,
        });
        setReport(result);
      }
      setLastRefresh(Date.now());
    } finally {
      setIsScanning(false);
    }
  }, [onRescan, customRootsRegistry]);

  const handleCopyReport = React.useCallback(() => {
    const markdown = generateRedactedDiscoveryReport(report, {
      customRoots: customRootsRegistry.getRoots(),
      lastRefresh,
    });
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(markdown).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
      });
    }
  }, [report, customRootsRegistry, lastRefresh]);

  const handleAddRoot = React.useCallback(() => {
    setCustomRootError(null);
    const validation = validateCustomRootCandidate(newRootPath, customRootsRegistry.getRoots());
    if (!validation.isValid) {
      setCustomRootError(validation.error || "Invalid directory path");
      return;
    }

    try {
      customRootsRegistry.addRoot(newRootPath, newRootScope, newRootLabel);
      setCustomRoots(customRootsRegistry.getRoots());
      setNewRootPath("");
      setNewRootLabel("");
      setCustomRootError(null);
    } catch (err) {
      setCustomRootError(err instanceof Error ? err.message : "Failed to add root");
    }
  }, [newRootPath, newRootScope, newRootLabel, customRootsRegistry]);

  const handleRemoveRoot = React.useCallback(
    (id: string) => {
      customRootsRegistry.removeRoot(id);
      setCustomRoots(customRootsRegistry.getRoots());
    },
    [customRootsRegistry],
  );

  const handleResetRoots = React.useCallback(() => {
    customRootsRegistry.resetRoots();
    setCustomRoots([]);
  }, [customRootsRegistry]);

  // Filtered resources
  const filteredResources = React.useMemo(() => {
    return report.resources.filter((res) => {
      if (kindFilter !== "all" && res.kind !== kindFilter) return false;
      if (confidenceFilter !== "all" && res.confidence !== confidenceFilter) return false;
      if (searchQuery.trim().length > 0) {
        const q = searchQuery.toLowerCase();
        const matchId = res.id.toLowerCase().includes(q);
        const matchPath = res.canonicalPath.toLowerCase().includes(q);
        const matchProvider = res.provider.toLowerCase().includes(q);
        if (!matchId && !matchPath && !matchProvider) return false;
      }
      return true;
    });
  }, [report.resources, kindFilter, confidenceFilter, searchQuery]);

  return (
    <div className="discovery-diagnostics-view" style={{ padding: "16px" }}>
      {/* Top Header & Actions */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <div>
          <h3 style={{ margin: "0 0 4px 0" }}>Linux Resource Discovery Diagnostics</h3>
          <span style={{ color: "#888", fontSize: "12px" }}>
            Last refresh: {new Date(lastRefresh).toLocaleTimeString()} | Total resources:{" "}
            {report.resources.length}
          </span>
        </div>
        <ButtonGroup>
          <Button
            bsStyle="primary"
            disabled={isScanning}
            onClick={handleRescan}
            id="btn-discovery-rescan"
          >
            {isScanning ? "Scanning..." : "Safe Rescan"}
          </Button>
          <Button bsStyle="default" onClick={handleCopyReport} id="btn-discovery-copy-report">
            {copied ? "Copied!" : "Copy Redacted Report"}
          </Button>
        </ButtonGroup>
      </div>

      {/* Tabs */}
      <ButtonGroup style={{ marginBottom: "16px" }}>
        <Button
          bsStyle={activeTab === "resources" ? "primary" : "default"}
          onClick={() => setActiveTab("resources")}
        >
          Discovered Resources ({report.resources.length})
        </Button>
        <Button
          bsStyle={activeTab === "custom-roots" ? "primary" : "default"}
          onClick={() => setActiveTab("custom-roots")}
        >
          Approved Custom Roots ({customRoots.length})
        </Button>
      </ButtonGroup>

      {/* Tab 1: Discovered Resources */}
      {activeTab === "resources" && (
        <div>
          {/* Filters Bar */}
          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <FormControl
              type="text"
              placeholder="Search by ID, path, or provider..."
              value={searchQuery}
              onChange={(e: any) => setSearchQuery(e.target.value)}
              style={{ flex: 2 }}
            />
            <FormControl
              componentClass="select"
              value={kindFilter}
              onChange={(e: any) => setKindFilter(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="all">All Kinds</option>
              <option value="game">Games</option>
              <option value="launcher">Launchers</option>
              <option value="library">Libraries</option>
              <option value="compatibility-runtime">Runtimes</option>
              <option value="compatibility-prefix">Prefixes</option>
            </FormControl>
            <FormControl
              componentClass="select"
              value={confidenceFilter}
              onChange={(e: any) => setConfidenceFilter(e.target.value)}
              style={{ flex: 1 }}
            >
              <option value="all">All Confidence</option>
              <option value="confirmed">Confirmed</option>
              <option value="probable">Probable</option>
              <option value="user-confirmation-required">Confirmation Required</option>
            </FormControl>
          </div>

          {/* Resources Table */}
          {filteredResources.length === 0 ? (
            <Alert bsStyle="info">No resources matching the filter criteria were found.</Alert>
          ) : (
            <Table striped bordered condensed hover responsive>
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>ID / Name</th>
                  <th>Provider</th>
                  <th>Canonical Path</th>
                  <th>Confidence</th>
                  <th>Sandbox / Visibility</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {filteredResources.map((res) => {
                  const confColor =
                    res.confidence === "confirmed"
                      ? "success"
                      : res.confidence === "probable"
                        ? "warning"
                        : "danger";

                  const visibility = res.packagingContext.sandboxVisibility || "direct";
                  const visColor = visibility === "restricted" ? "warning" : "default";

                  return (
                    <tr key={res.id}>
                      <td>
                        <Badge>{res.kind}</Badge>
                      </td>
                      <td>
                        <strong>{res.id}</strong>
                        {res.remediation && (
                          <div style={{ marginTop: "4px", fontSize: "11px", color: "#d9534f" }}>
                            ⚠️ {res.remediation.message}
                            {res.remediation.command && (
                              <pre style={{ margin: "4px 0", fontSize: "10px", padding: "4px" }}>
                                {res.remediation.command}
                              </pre>
                            )}
                          </div>
                        )}
                      </td>
                      <td>{res.provider}</td>
                      <td style={{ wordBreak: "break-all", fontSize: "12px" }}>
                        <code>{res.canonicalPath}</code>
                      </td>
                      <td>
                        <Label bsStyle={confColor}>{res.confidence}</Label>
                      </td>
                      <td>
                        <span style={{ fontSize: "12px" }}>
                          {res.packagingContext.format} (
                          <strong
                            style={{ color: visibility === "restricted" ? "#d9534f" : undefined }}
                          >
                            {visibility}
                          </strong>
                          )
                        </span>
                      </td>
                      <td style={{ fontSize: "11px" }}>{res.evidence.length} source(s)</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </div>
      )}

      {/* Tab 2: User-Approved Custom Roots */}
      {activeTab === "custom-roots" && (
        <div>
          <Alert bsStyle="info">
            Manual roots augment automatic discovery for non-standard install locations and are not
            silently rewritten. System root <code>/</code> and user home directory are restricted to
            prevent unbounded disk crawling.
          </Alert>

          {/* Add Root Form */}
          <div
            style={{
              border: "1px solid #ddd",
              padding: "12px",
              borderRadius: "4px",
              marginBottom: "16px",
              backgroundColor: "#fafafa",
            }}
          >
            <h5>Add User-Approved Custom Root</h5>
            {customRootError && <Alert bsStyle="danger">{customRootError}</Alert>}
            <FormGroup>
              <ControlLabel>Directory Absolute Path</ControlLabel>
              <FormControl
                type="text"
                placeholder="/path/to/custom/games/or/library"
                value={newRootPath}
                onChange={(e: any) => setNewRootPath(e.target.value)}
                id="input-custom-root-path"
              />
            </FormGroup>
            <div style={{ display: "flex", gap: "12px" }}>
              <FormGroup style={{ flex: 1 }}>
                <ControlLabel>Scope</ControlLabel>
                <FormControl
                  componentClass="select"
                  value={newRootScope}
                  onChange={(e: any) => setNewRootScope(e.target.value as CustomRootScope)}
                >
                  <option value="all">All Resources</option>
                  <option value="game">Games Only</option>
                  <option value="library">Library Only</option>
                  <option value="modding-tool">Modding Tools</option>
                  <option value="launcher">Launchers</option>
                </FormControl>
              </FormGroup>
              <FormGroup style={{ flex: 2 }}>
                <ControlLabel>Display Label (Optional)</ControlLabel>
                <FormControl
                  type="text"
                  placeholder="e.g., Secondary SSD Games"
                  value={newRootLabel}
                  onChange={(e: any) => setNewRootLabel(e.target.value)}
                />
              </FormGroup>
            </div>
            <Button bsStyle="primary" onClick={handleAddRoot} id="btn-add-custom-root">
              Add Root
            </Button>
          </div>

          {/* Existing Custom Roots List */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <h5>Registered Custom Roots ({customRoots.length})</h5>
            {customRoots.length > 0 && (
              <Button bsSize="xsmall" bsStyle="danger" onClick={handleResetRoots}>
                Reset All
              </Button>
            )}
          </div>

          {customRoots.length === 0 ? (
            <p style={{ color: "#888", fontStyle: "italic" }}>No custom roots configured.</p>
          ) : (
            <Table striped bordered condensed hover>
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Path</th>
                  <th>Scope</th>
                  <th>Validated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {customRoots.map((root) => (
                  <tr key={root.id}>
                    <td>{root.label || root.id}</td>
                    <td>
                      <code>{root.path}</code>
                    </td>
                    <td>
                      <Badge>{root.scope}</Badge>
                    </td>
                    <td>
                      <Label bsStyle={root.validated ? "success" : "danger"}>
                        {root.validated ? "Valid" : "Invalid"}
                      </Label>
                    </td>
                    <td>
                      <Button
                        bsSize="xsmall"
                        bsStyle="default"
                        onClick={() => handleRemoveRoot(root.id)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
};
