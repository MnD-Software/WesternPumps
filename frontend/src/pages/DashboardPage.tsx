import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Select, Space, Spin, Typography } from "antd";
import { DownloadOutlined, QrcodeOutlined, ReloadOutlined } from "@ant-design/icons";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "../api/client";
import { getApiErrorMessage } from "../api/error";
import { getItemQrSvg, listItems, listLowStock } from "../api/items";
import { listJobs } from "../api/jobs";
import { listRequests } from "../api/requests";
import { listStockLifecycle, listStockTransactions, listStockTrend, listUsageSummary } from "../api/stock";
import type { Item, Job, StockRequest, StockTransaction, StockTrendPoint, StockUsageSummary } from "../api/types";
import { useAuth } from "../state/AuthContext";
import { formatKes } from "../utils/currency";
import { formatDateTime } from "../utils/datetime";
import { formatRequestRef } from "../utils/requestRef";
import { canAccessPage } from "../utils/access";
import { useNavigate } from "react-router-dom";
import SmartEmptyState from "../components/SmartEmptyState";
import { saveBlob } from "../utils/download";

type TrendDatum = {
  label: string;
  net: number;
  inbound: number;
  outbound: number;
};

type ProductInputDatum = {
  label: string;
  created: number;
  receivedUnits: number;
};

type UsageRow = {
  id: number;
  name: string;
  sku: string;
  total: number;
};

const numberFormatter = new Intl.NumberFormat("en-US");

function formatTrendLabel(value: string): string {
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function dateOnly(isoLike: string): string {
  const raw = String(isoLike || "").trim();
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (m) return m[1];
  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return isoLike;
  return dt.toISOString().slice(0, 10);
}

async function downloadReport(path: string, filename: string) {
  const resp = await api.get(path, { responseType: "blob" });
  saveBlob(resp.data, filename);
}

function TrendTooltip(props: any) {
  const { active, payload, label } = props;
  if (!active || !payload || payload.length === 0) return null;
  const data = payload[0].payload as TrendDatum & ProductInputDatum;
  return (
    <div className="chart-tooltip">
      <div className="chart-tooltip-title">{label}</div>
      {typeof data.created === "number" ? (
        <>
          <div className="chart-tooltip-row">
            <span>Products Added</span>
            <strong>{numberFormatter.format(data.created)}</strong>
          </div>
          <div className="chart-tooltip-row">
            <span>Units Received</span>
            <strong>{numberFormatter.format(data.receivedUnits)}</strong>
          </div>
        </>
      ) : (
        <>
          <div className="chart-tooltip-row">
            <span>Net</span>
            <strong>{numberFormatter.format(data.net)}</strong>
          </div>
          <div className="chart-tooltip-row">
            <span>Inbound</span>
            <strong>{numberFormatter.format(data.inbound)}</strong>
          </div>
          <div className="chart-tooltip-row">
            <span>Outbound</span>
            <strong>{numberFormatter.format(data.outbound)}</strong>
          </div>
        </>
      )}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "technician";
  const isManagerRole = useMemo(() => role === "admin" || role === "manager", [role]);
  const isApprover = useMemo(() => ["admin", "manager", "approver"].includes(role), [role]);
  const isStoreManager = useMemo(() => role === "store_manager" || role === "admin" || role === "manager", [role]);
  const isTechRole = useMemo(() => ["technician", "lead_technician", "staff"].includes(role), [role]);
  const canViewStockAnalytics = useMemo(() => isApprover || isStoreManager, [isApprover, isStoreManager]);
  const canAccessQrQuickAccess = useMemo(() => isApprover || isStoreManager, [isApprover, isStoreManager]);
  const canViewSystemLifecycle = useMemo(() => isApprover || isStoreManager, [isApprover, isStoreManager]);
  const canOpenRequests = canAccessPage(role, "requests");
  const canOpenInventory = canAccessPage(role, "inventory");
  const canOpenApprovals = canAccessPage(role, "approvals");
  const canOpenReports = canAccessPage(role, "reports");
  const canOpenAdvancedReports = canAccessPage(role, "reports_v2");
  const canOpenStoreManagerReports = canAccessPage(role, "store_manager_reports");
  const canOpenLeadTechReports = canAccessPage(role, "lead_tech_reports");
  const canOpenTechnicianReports = canAccessPage(role, "technician_reports");

  const [items, setItems] = useState<Item[]>([]);
  const [itemTotal, setItemTotal] = useState(0);
  const [lowStockItems, setLowStockItems] = useState<Item[]>([]);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [requests, setRequests] = useState<StockRequest[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [trendPoints, setTrendPoints] = useState<StockTrendPoint[]>([]);
  const [usageSummary, setUsageSummary] = useState<StockUsageSummary[]>([]);
  const [lifecycleTransactions, setLifecycleTransactions] = useState<StockTransaction[]>([]);
  const [lifecycleMode, setLifecycleMode] = useState<"mine" | "system">("mine");
  const [usageDays, setUsageDays] = useState(30);
  const trendDays = 7;
  const [loading, setLoading] = useState(true);
  const [usageLoading, setUsageLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const [qrItemId, setQrItemId] = useState<number | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);

  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);

  const inventoryValue = useMemo(
    () => items.reduce((sum, item) => sum + (item.unit_price ?? 0) * item.quantity_on_hand, 0),
    [items]
  );

  const lowStockValue = useMemo(
    () => lowStockItems.reduce((sum, item) => sum + (item.unit_price ?? 0) * item.quantity_on_hand, 0),
    [lowStockItems]
  );

  const lowStockAlerts = useMemo(() => {
    return [...lowStockItems]
      .map((item) => ({
        ...item,
        shortage: Math.max(0, item.min_quantity - item.quantity_on_hand)
      }))
      .sort((a, b) => b.shortage - a.shortage)
      .slice(0, 5);
  }, [lowStockItems]);

  const totalUnits = useMemo(() => items.reduce((sum, item) => sum + item.quantity_on_hand, 0), [items]);

  const trendData = useMemo<TrendDatum[]>(
    () =>
      trendPoints.map((point) => ({
        label: formatTrendLabel(point.date),
        net: point.net,
        inbound: point.inbound,
        outbound: point.outbound
      })),
    [trendPoints]
  );
  const trendDomain = useMemo<[number, number]>(() => {
    if (trendData.length === 0) return [-1, 1];
    const values = trendData.flatMap((point) => [point.net, point.inbound, -point.outbound]);
    const min = Math.min(...values, 0);
    const max = Math.max(...values, 0);
    if (min === max) return [min - 1, max + 1];
    const pad = Math.max(1, Math.ceil((max - min) * 0.12));
    return [min - pad, max + pad];
  }, [trendData]);

  const productInputData = useMemo<ProductInputDatum[]>(() => {
    const days = 14;
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const map = new Map<string, { created: number; receivedUnits: number }>();
    for (let i = 0; i < days; i += 1) {
      const d = new Date(end);
      d.setDate(end.getDate() - (days - 1 - i));
      map.set(d.toISOString().slice(0, 10), { created: 0, receivedUnits: 0 });
    }
    items.forEach((item) => {
      const key = dateOnly(item.created_at);
      const bucket = map.get(key);
      if (!bucket) return;
      bucket.created += 1;
    });
    transactions.forEach((tx) => {
      if ((tx.transaction_type || "").toUpperCase() !== "IN") return;
      const key = dateOnly(tx.created_at);
      const bucket = map.get(key);
      if (!bucket) return;
      bucket.receivedUnits += Math.max(0, Number(tx.quantity_delta || 0));
    });
    return Array.from(map.entries()).map(([date, values]) => ({
      label: formatTrendLabel(date),
      created: values.created,
      receivedUnits: values.receivedUnits
    }));
  }, [items, transactions]);

  const usageRows = useMemo<UsageRow[]>(() => {
    return usageSummary.map((entry) => {
      const item = itemsById.get(entry.part_id);
      return {
        id: entry.part_id,
        name: item?.name ?? `Item #${entry.part_id}`,
        sku: item?.sku ?? "Unknown",
        total: entry.total
      };
    });
  }, [itemsById, usageSummary]);

  const maxUsage = Math.max(...usageRows.map((row) => row.total), 1);

  const pendingApprovalRequests = useMemo(
    () =>
      isApprover
        ? requests
            .filter((r) => (r.status || "").toUpperCase() === "PENDING")
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        : [],
    [isApprover, requests]
  );

  const myAssignedJobs = useMemo(
    () =>
      jobs
        .filter((job) => (job.assigned_to_user_id ?? null) === (user?.id ?? null))
        .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()),
    [jobs, user?.id]
  );

  const openSystemJobs = useMemo(
    () =>
      jobs
        .filter((job) => (job.status || "").toLowerCase() !== "completed" && (job.status || "").toLowerCase() !== "canceled")
        .sort((a, b) => new Date(b.updated_at || b.created_at).getTime() - new Date(a.updated_at || a.created_at).getTime()),
    [jobs]
  );

  const myPendingRequestsCount = useMemo(
    () => requests.filter((r) => (r.status || "").toUpperCase() === "PENDING").length,
    [requests]
  );

  const myOpenJobsCount = useMemo(
    () =>
      myAssignedJobs.filter(
        (job) => (job.status || "").toLowerCase() !== "completed" && (job.status || "").toLowerCase() !== "canceled"
      ).length,
    [myAssignedJobs]
  );
  const pendingJobsCount = useMemo(
    () => jobs.filter((job) => (job.status || "").toLowerCase() === "pending_approval").length,
    [jobs]
  );
  const activeJobsCount = useMemo(
    () =>
      jobs.filter((job) => {
        const status = (job.status || "").toLowerCase();
        return status !== "completed" && status !== "canceled";
      }).length,
    [jobs]
  );
  const criticalLowStockCount = useMemo(
    () => lowStockItems.filter((item) => item.quantity_on_hand <= Math.max(0, Math.floor(item.min_quantity * 0.5))).length,
    [lowStockItems]
  );

  const lifecycleRows = useMemo(() => {
    const scopeRows =
      lifecycleMode === "mine"
        ? lifecycleTransactions.filter((tx) => (tx.technician_id ?? null) === (user?.id ?? null))
        : lifecycleTransactions;
    return scopeRows.slice(0, 8).map((tx) => {
      const item = itemsById.get(tx.part_id);
      const movement = (tx.movement_type || "").toUpperCase();
      const isIssue = movement === "ISSUE";
      const isFaultyReturn = movement === "FAULTY_RETURN";
      const qty = Math.abs(Number(tx.quantity_delta || 0));
      return {
        id: tx.id,
        title: item ? `${item.sku} - ${item.name}` : `Item #${tx.part_id}`,
        subtitle: tx.request_id ? `${formatRequestRef(tx.request_id)} • ${formatDateTime(tx.created_at)}` : formatDateTime(tx.created_at),
        quantityText: `${isIssue ? "-" : "+"}${numberFormatter.format(qty)}`,
        pill: isIssue ? "ISSUED" : isFaultyReturn ? "RETURNED (FAULTY)" : "RETURNED",
        pillClass: isIssue ? "activity-pill--issued" : isFaultyReturn ? "activity-pill--rejected" : "activity-pill--approved"
      };
    });
  }, [itemsById, lifecycleMode, lifecycleTransactions, user?.id]);

  const lifecycleSummary = useMemo(() => {
    const scopeRows =
      lifecycleMode === "mine"
        ? lifecycleTransactions.filter((tx) => (tx.technician_id ?? null) === (user?.id ?? null))
        : lifecycleTransactions;
    return scopeRows.reduce(
      (acc, tx) => {
        const movement = (tx.movement_type || "").toUpperCase();
        const qty = Math.abs(Number(tx.quantity_delta || 0));
        if (movement === "ISSUE") {
          acc.issued += qty;
        } else if (movement === "RETURN" || movement === "FAULTY_RETURN") {
          acc.returned += qty;
        }
        return acc;
      },
      { issued: 0, returned: 0 }
    );
  }, [lifecycleMode, lifecycleTransactions, user?.id]);

  const loadUsage = useCallback(async () => {
    if (!canViewStockAnalytics) {
      setUsageSummary([]);
      setUsageError(null);
      return;
    }
    setUsageLoading(true);
    setUsageError(null);
    try {
      const summary = await listUsageSummary({ days: usageDays, limit: 5 });
      setUsageSummary(summary);
    } catch (err: any) {
      setUsageSummary([]);
      setUsageError(getApiErrorMessage(err, "Failed to load usage summary"));
    } finally {
      setUsageLoading(false);
    }
  }, [canViewStockAnalytics, usageDays]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const requestParams = isApprover || isStoreManager ? undefined : { mine: true };
      const [itemsResp, reqs, jobList] = await Promise.all([
        listItems({ page: 1, page_size: 1000, sort: "created_at", direction: "desc", include_inactive: true }),
        listRequests(requestParams),
        listJobs()
      ]);
      setItems(itemsResp.items);
      setItemTotal(itemsResp.total);
      setRequests(reqs);
      setJobs(jobList);
      const lifecycle = await listStockLifecycle({ limit: 120 });
      setLifecycleTransactions(lifecycle);
      if (canViewStockAnalytics) {
        const [low, tx, trend] = await Promise.all([
          listLowStock({ limit: 200 }),
          listStockTransactions({ limit: 200 }),
          listStockTrend({ days: trendDays })
        ]);
        setLowStockItems(low);
        setTransactions(tx);
        setTrendPoints(trend);
      } else {
        setLowStockItems([]);
        setTransactions([]);
        setTrendPoints([]);
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load dashboard data"));
    } finally {
      setLoading(false);
    }
  }, [canViewStockAnalytics, isApprover, isStoreManager, trendDays]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage]);

  async function handleGenerateQr() {
    if (!qrItemId) return;
    setQrLoading(true);
    setQrError(null);
    try {
      const svg = await getItemQrSvg(qrItemId);
      setQrSvg(svg);
    } catch (err: any) {
      setQrError(getApiErrorMessage(err, "Failed to generate QR code"));
    } finally {
      setQrLoading(false);
    }
  }

  async function handleDownload(path: string, filename: string) {
    setReportError(null);
    setReporting(true);
    try {
      await downloadReport(path, filename);
    } catch (err: any) {
      setReportError(getApiErrorMessage(err, "Failed to download report"));
    } finally {
      setReporting(false);
    }
  }

  async function handleRefresh() {
    await Promise.all([refresh(), loadUsage()]);
  }

  const qrDataUrl = qrSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}` : "";
  const usageOptions = [
    { value: 7, label: "Last 7 days" },
    { value: 30, label: "Last 30 days" },
    { value: 90, label: "Last 90 days" }
  ];
  const showPriorityCards = isApprover || isTechRole || isStoreManager;
  const primaryReportPath = useMemo(() => {
    if (canOpenAdvancedReports) return "/reports-v2";
    if (canOpenStoreManagerReports) return "/store-manager-reports";
    if (canOpenLeadTechReports) return "/lead-tech-reports";
    if (canOpenTechnicianReports) return "/technician-reports";
    if (canOpenReports) return "/reports";
    return "";
  }, [canOpenAdvancedReports, canOpenLeadTechReports, canOpenReports, canOpenStoreManagerReports, canOpenTechnicianReports]);

  const quickActionButtons = useMemo(() => {
    const actions: Array<{ key: string; label: string; enabled: boolean }> = [
      { key: "approvals", label: "Approvals", enabled: canOpenApprovals },
      { key: "jobs", label: "Jobs", enabled: canAccessPage(role, "jobs") },
      { key: "requests", label: "Requests", enabled: canOpenRequests },
      { key: "inventory", label: "Inventory", enabled: canOpenInventory },
      { key: primaryReportPath.replace("/", ""), label: "Reports", enabled: Boolean(primaryReportPath) },
    ];
    if (!isManagerRole && !isApprover) {
      actions.sort((a, b) => (a.key === "jobs" ? -1 : b.key === "jobs" ? 1 : 0));
    }
    return actions.filter((action) => action.enabled);
  }, [canOpenApprovals, canOpenInventory, canOpenRequests, isApprover, isManagerRole, primaryReportPath, role]);

  const dashboardSubtitle = isManagerRole
    ? "Priority-first view for approvals, stock risk, and operational throughput."
    : isStoreManager
      ? "Inventory and request actions first, with trend visibility for rapid decisions."
      : isTechRole
        ? "Assigned jobs and stock lifecycle activity prioritized for daily execution."
        : "A real-time snapshot of inventory, usage, and financial signals.";

  return (
    <div className="container dashboard page-shell" data-role={role}>
      <div className="dashboard-header page-topbar">
        <div className="page-heading">
          <Typography.Title level={2} style={{ marginTop: 0 }}>
            Operations Dashboard
          </Typography.Title>
          <Typography.Text type="secondary" className="page-subtitle">
            {dashboardSubtitle}
          </Typography.Text>
        </div>
        <Space wrap className="page-quick-actions">
          {quickActionButtons.map((action) => (
            <Button key={action.key} onClick={() => navigate(`/${action.key}`)}>
              {action.label}
            </Button>
          ))}
          <Button icon={<ReloadOutlined />} onClick={handleRefresh} disabled={loading || usageLoading} type="primary">
            Refresh
          </Button>
        </Space>
      </div>

      {canViewStockAnalytics && lowStockItems.length > 0 ? (
        <Alert
          type="warning"
          showIcon
          message="Reorder alert"
          description={`${lowStockItems.length} item(s) are below the minimum threshold.`}
          style={{ marginTop: 12 }}
          action={
            <Button size="small" onClick={() => navigate(canOpenInventory ? "/inventory" : "/dashboard")}>
              View inventory
            </Button>
          }
        />
      ) : null}

      {error ? (
        <Card style={{ marginBottom: 16 }}>
          <Typography.Text type="danger">{error}</Typography.Text>
        </Card>
      ) : null}

      {showPriorityCards ? (
        <div className="dashboard-priority-grid stagger-group">
          {isManagerRole ? (
            <Card
              title="Manager Control Center"
              extra={
                <Space size={8}>
                  <Button size="small" onClick={() => navigate("/approvals")}>
                    Open approvals
                  </Button>
                  <Button size="small" onClick={() => navigate(primaryReportPath || "/reports-v2")}>
                    View comparisons
                  </Button>
                </Space>
              }
              className="dashboard-priority-card"
            >
              <div className="alert-values" style={{ marginBottom: 10 }}>
                <span className="alert-chip">Open jobs: {numberFormatter.format(activeJobsCount)}</span>
                <span className="alert-chip">Pending approvals: {numberFormatter.format(pendingJobsCount)}</span>
                <span className="alert-chip">Critical low stock: {numberFormatter.format(criticalLowStockCount)}</span>
              </div>
              <Typography.Text type="secondary">
                Monitor approvals, open work orders, and urgent stock risk from one view.
              </Typography.Text>
            </Card>
          ) : null}

          {isApprover ? (
            <Card
              title="Pending Approvals"
              extra={
                <Button size="small" onClick={() => navigate(canOpenApprovals ? "/approvals" : "/dashboard")}>
                  Open queue
                </Button>
              }
              className="dashboard-priority-card"
            >
              {pendingApprovalRequests.length === 0 ? (
                <SmartEmptyState compact title="No pending requests" description="Approvals waiting for action will appear here." />
              ) : (
                <div className="activity-list">
                  {pendingApprovalRequests.slice(0, 5).map((req) => (
                    <div className="activity-row" key={`pending-${req.id}`}>
                      <div className="activity-meta">
                        <div className="activity-title">{formatRequestRef(req.id)}</div>
                        <div className="activity-sub">{new Date(req.created_at).toLocaleString()}</div>
                      </div>
                      <div className="activity-right">
                        <span className="activity-pill activity-pill--request activity-pill--pending">PENDING</span>
                      </div>
                    </div>
                  ))}
                  {pendingApprovalRequests.length > 5 ? (
                    <Typography.Text type="secondary">
                      +{pendingApprovalRequests.length - 5} more pending request(s)
                    </Typography.Text>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}

          {isTechRole ? (
            <Card
              title="My Assigned Jobs"
              extra={
                <Button size="small" onClick={() => navigate("/jobs")}>
                  Open jobs
                </Button>
              }
              className="dashboard-priority-card"
            >
              {myAssignedJobs.length === 0 ? (
                <SmartEmptyState compact title="No assigned jobs" description="Jobs assigned to your account will show up here." />
              ) : (
                <div className="activity-list">
                  {myAssignedJobs.slice(0, 5).map((job) => (
                    <div className="activity-row" key={`my-job-${job.id}`}>
                      <div className="activity-meta">
                        <div className="activity-title">{job.title}</div>
                        <div className="activity-sub">
                          Job #{job.id} / {(job.priority || "medium").toUpperCase()} priority
                        </div>
                      </div>
                      <div className="activity-right">
                        <span className={`activity-pill activity-pill--job activity-pill--${(job.status || "open").toLowerCase()}`}>
                          {(job.status || "open").replace(/_/g, " ").toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : null}

          {isTechRole || isStoreManager || isApprover ? (
            <Card
              title="Issued & Returned Stock"
              extra={
                canViewSystemLifecycle ? (
                  <Select
                    size="small"
                    value={lifecycleMode}
                    onChange={(value) => setLifecycleMode(value)}
                    style={{ minWidth: 130 }}
                    options={[
                      { value: "mine", label: "My activity" },
                      { value: "system", label: "System-wide" }
                    ]}
                  />
                ) : null
              }
              className="dashboard-priority-card"
            >
              {lifecycleRows.length === 0 ? (
                <SmartEmptyState compact title="No stock lifecycle activity" description="Issued and returned transactions will show here." />
              ) : (
                <>
                  <div className="alert-values" style={{ marginBottom: 10 }}>
                    <span className="alert-chip">Issued: {numberFormatter.format(lifecycleSummary.issued)}</span>
                    <span className="alert-chip">Returned: {numberFormatter.format(lifecycleSummary.returned)}</span>
                  </div>
                  <div className="activity-list">
                    {lifecycleRows.map((row) => (
                      <div className="activity-row" key={`lifecycle-${row.id}`}>
                        <div className="activity-meta">
                          <div className="activity-title">{row.title}</div>
                          <div className="activity-sub">{row.subtitle}</div>
                        </div>
                        <div className="activity-right">
                          <span className="activity-qty">{row.quantityText}</span>
                          <span className={`activity-pill ${row.pillClass}`}>{row.pill}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </Card>
          ) : null}

          {isApprover || isStoreManager ? (
            <Card
              title="System Jobs Overview"
              extra={
                <Button size="small" onClick={() => navigate("/jobs")}>
                  View all
                </Button>
              }
              className="dashboard-priority-card"
            >
              {openSystemJobs.length === 0 ? (
                <SmartEmptyState compact title="No open system jobs" description="Active jobs from the system queue will appear here." />
              ) : (
                <div className="activity-list">
                  {openSystemJobs.slice(0, 5).map((job) => (
                    <div className="activity-row" key={`system-job-${job.id}`}>
                      <div className="activity-meta">
                        <div className="activity-title">{job.title}</div>
                        <div className="activity-sub">
                          Job #{job.id} / {(job.priority || "medium").toUpperCase()} priority
                        </div>
                      </div>
                      <div className="activity-right">
                        <span className={`activity-pill activity-pill--job activity-pill--${(job.status || "open").toLowerCase()}`}>
                          {(job.status || "open").replace(/_/g, " ").toUpperCase()}
                        </span>
                      </div>
                    </div>
                  ))}
                  {openSystemJobs.length > 5 ? (
                    <Typography.Text type="secondary">+{openSystemJobs.length - 5} more open job(s)</Typography.Text>
                  ) : null}
                </div>
              )}
            </Card>
          ) : null}
        </div>
      ) : null}

      <div className="dashboard-grid stagger-group">
        <Card className="stat-card">
          <div className="stat-label">Total Items</div>
          <div className="stat-value">{loading ? "--" : numberFormatter.format(itemTotal)}</div>
          <div className="stat-meta">Catalog entries</div>
        </Card>
        <Card className="stat-card">
          <div className="stat-label">Units On Hand</div>
          <div className="stat-value">{loading ? "--" : numberFormatter.format(totalUnits)}</div>
          <div className="stat-meta">Across stocked items</div>
        </Card>
        {canViewStockAnalytics ? (
          <Card className="stat-card">
            <div className="stat-label">Inventory Value</div>
            <div className="stat-value">{loading ? "--" : formatKes(inventoryValue)}</div>
            <div className="stat-meta">Based on unit cost</div>
          </Card>
        ) : null}
        {canViewStockAnalytics ? (
          <Card className="stat-card">
            <div className="stat-label">Low Stock Value</div>
            <div className="stat-value">{loading ? "--" : formatKes(lowStockValue)}</div>
            <div className="stat-meta">{loading ? "--" : `${lowStockItems.length} items below threshold`}</div>
          </Card>
        ) : null}
        {!canViewStockAnalytics ? (
          <Card className="stat-card">
            <div className="stat-label">My Pending Requests</div>
            <div className="stat-value">{loading ? "--" : numberFormatter.format(myPendingRequestsCount)}</div>
            <div className="stat-meta">Awaiting approval or issue</div>
          </Card>
        ) : null}
        {!canViewStockAnalytics ? (
          <Card className="stat-card">
            <div className="stat-label">My Open Jobs</div>
            <div className="stat-value">{loading ? "--" : numberFormatter.format(myOpenJobsCount)}</div>
            <div className="stat-meta">Assigned and not completed</div>
          </Card>
        ) : null}
      </div>

      {canViewStockAnalytics ? (
      <Card title="Reorder Alerts" className="alerts-card">
        {lowStockAlerts.length === 0 ? (
          <Typography.Text type="secondary">All items are above their minimum threshold.</Typography.Text>
        ) : (
          <div className="alerts-list">
            {lowStockAlerts.map((item) => (
              <div className="alert-row" key={item.id}>
                <div>
                  <div className="alert-title">{item.name}</div>
                  <div className="alert-sub">{item.sku}</div>
                </div>
                <div className="alert-values">
                  <span className="alert-chip">On hand: {numberFormatter.format(item.quantity_on_hand)}</span>
                  <span className="alert-chip">Min: {numberFormatter.format(item.min_quantity)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      ) : null}

      {canViewStockAnalytics ? <div className="dashboard-split stagger-group">
        <Card title="Product Input Trend" className="chart-card">
          <Typography.Text type="secondary">Stock input activity over the last 14 days.</Typography.Text>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={productInputData} margin={{ top: 16, right: 24, left: -8, bottom: 0 }}>
                <defs>
                  <linearGradient id="productInputGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(110, 193, 255, 0.5)" />
                    <stop offset="100%" stopColor="rgba(110, 193, 255, 0.05)" />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="rgba(110, 193, 255, 0.14)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip content={<TrendTooltip />} />
                <Bar dataKey="receivedUnits" fill="url(#productInputGradient)" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card title="Stock Movement Trend (Last 7 Days)" className="chart-card">
          {trendData.length === 0 ? (
            <Typography.Text type="secondary">No stock movement data available yet.</Typography.Text>
          ) : (
            <div className="chart-wrap">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={trendData} margin={{ top: 16, right: 24, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke="rgba(110, 193, 255, 0.14)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="label" tickLine={false} axisLine={false} />
                  <YAxis tickLine={false} axisLine={false} domain={trendDomain} />
                  <ReferenceLine y={0} stroke="rgba(154, 215, 255, 0.28)" strokeDasharray="4 4" />
                  <Tooltip content={<TrendTooltip />} />
                  <Line
                    type="monotone"
                    dataKey="inbound"
                    name="Inbound"
                    stroke="rgba(110, 193, 255, 0.95)"
                    strokeWidth={2.4}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="outbound"
                    name="Outbound"
                    stroke="rgba(240, 208, 141, 0.95)"
                    strokeWidth={2.4}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="net"
                    name="Net"
                    stroke="rgba(103, 231, 198, 0.95)"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    dot={{ r: 2 }}
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>
      </div> : null}

      <div className="dashboard-columns stagger-group">
        {canViewStockAnalytics ? (
        <Card
          title="Most Used Items"
          extra={
            <Select
              size="small"
              value={usageDays}
              onChange={(value) => setUsageDays(value)}
              options={usageOptions}
              style={{ minWidth: 140 }}
            />
          }
        >
          {usageError ? <Typography.Text type="danger">{usageError}</Typography.Text> : null}
          {usageLoading ? (
            <Space>
              <Spin size="small" />
              <Typography.Text type="secondary">Loading usage data</Typography.Text>
            </Space>
          ) : usageRows.length === 0 ? (
            <Typography.Text type="secondary">No usage data for the selected period.</Typography.Text>
          ) : (
            <div className="data-list">
              {usageRows.map((entry) => {
                const width = Math.max(8, Math.round((entry.total / maxUsage) * 100));
                return (
                  <div className="data-row" key={entry.id}>
                    <div className="data-info">
                      <div className="data-title">{entry.name}</div>
                      <div className="data-sub">{entry.sku}</div>
                    </div>
                    <div className="data-bar">
                      <span style={{ width: `${width}%` }} />
                    </div>
                    <div className="data-value">{numberFormatter.format(entry.total)}</div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
        ) : null}

        {canAccessQrQuickAccess ? <Card title="QR Quick Access">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Select<number>
              showSearch
              value={qrItemId ?? undefined}
              onChange={(value) => setQrItemId(value)}
              placeholder="Select item for QR"
              optionFilterProp="label"
              options={items.map((item) => ({
                value: item.id,
                label: `${item.sku} - ${item.name}`
              }))}
            />
            <Button type="primary" icon={<QrcodeOutlined />} onClick={handleGenerateQr} disabled={!qrItemId || qrLoading}>
              {qrLoading ? "Generating..." : "Generate QR"}
            </Button>
            {qrError ? <Typography.Text type="danger">{qrError}</Typography.Text> : null}
            <div className="qr-preview">
              {qrSvg ? (
                <img src={qrDataUrl} alt="QR code" loading="lazy" decoding="async" />
              ) : (
                <Typography.Text type="secondary">QR code preview appears here.</Typography.Text>
              )}
            </div>
          </Space>
        </Card> : null}

        {canViewStockAnalytics ? (
        <Card title={isManagerRole ? "Reports & Comparison Exports" : "Financial Reports"}>
          <Typography.Text type="secondary">
            {isManagerRole
              ? "Compare profitability, productivity, and valuation from Advanced Reports, then export detailed files."
              : "Export reports for audits, finance, and procurement reviews."}
          </Typography.Text>
          <Space wrap style={{ marginTop: 12 }}>
            {isManagerRole ? (
              <Button onClick={() => navigate(primaryReportPath || "/reports-v2")}>Advanced report comparisons</Button>
            ) : null}
            <Button
              icon={<DownloadOutlined />}
              onClick={() => handleDownload("/api/reports/stock-level?format=excel", "stock-levels.xlsx")}
              disabled={reporting}
            >
              Stock Levels (Excel)
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => handleDownload("/api/reports/stock-movement?format=excel", "stock-movements.xlsx")}
              disabled={reporting}
            >
              Stock Movement (Excel)
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={() => handleDownload("/api/reports/stock-level?format=pdf", "stock-levels.pdf")}
              disabled={reporting}
            >
              Stock Levels (PDF)
            </Button>
          </Space>
          {reportError ? <Typography.Text type="danger">{reportError}</Typography.Text> : null}
          <div className="report-summary">
            <div>
              <div className="report-label">Projected Inventory Value</div>
              <div className="report-value">{formatKes(inventoryValue)}</div>
            </div>
            <div>
              <div className="report-label">Low Stock Exposure</div>
              <div className="report-value">{formatKes(lowStockValue)}</div>
            </div>
          </div>
        </Card>
        ) : null}
      </div>

    </div>
  );
}
