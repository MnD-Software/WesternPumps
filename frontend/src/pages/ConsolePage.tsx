import React, { useEffect, useMemo, useState } from "react";
import { Alert, App as AntdApp, Button, Card, Form, Input, Space, Table, Tag, Typography } from "antd";
import { DownloadOutlined, SyncOutlined } from "@ant-design/icons";
import { Line, LineChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { listItems, listLowStock } from "../api/items";
import { listJobs } from "../api/jobs";
import { listRequests } from "../api/requests";
import { downloadReport } from "../api/reports";
import { useAuth } from "../state/AuthContext";
import { formatKes } from "../utils/currency";
import { formatRequestRef } from "../utils/requestRef";
import { saveBlobBatch } from "../utils/download";

type ForecastPoint = {
  day: string;
  demand: number;
  forecast: number;
};

function makeForecast(lowStockCount: number, openJobs: number): ForecastPoint[] {
  const points: ForecastPoint[] = [];
  for (let i = 1; i <= 14; i += 1) {
    const base = Math.max(2, Math.round((lowStockCount * 0.7 + openJobs * 0.6) / 4));
    const demand = Math.max(1, base + (i % 4) - 2);
    points.push({
      day: `D${i}`,
      demand,
      forecast: Math.max(1, Math.round(demand * 1.08))
    });
  }
  return points;
}

function aiOverview(params: {
  role: string;
  lowStockCount: number;
  openJobs: number;
  pendingRequests: number;
  inventoryValue: number;
}): string[] {
  const { role, lowStockCount, openJobs, pendingRequests, inventoryValue } = params;
  const lines: string[] = [];
  lines.push(`Inventory value snapshot is ${formatKes(inventoryValue)}.`);
  lines.push(`${lowStockCount} low-stock items need attention.`);
  if (pendingRequests > 0) lines.push(`${pendingRequests} request(s) are pending workflow action.`);
  if (openJobs > 0) lines.push(`${openJobs} open job(s) may drive upcoming stock consumption.`);
  if (role === "finance") lines.push("Finance focus: export Stock Level, Movement, and Audit Trail reports for reconciliation.");
  if (role === "store_manager" || role === "manager") lines.push("Operations focus: prioritize replenishment for high-risk low-stock SKUs.");
  if (role === "technician" || role === "lead_technician" || role === "staff") {
    lines.push("Field focus: monitor issued items and return remarks before closing work.");
  }
  return lines;
}

export default function ConsolePage() {
  const { message } = AntdApp.useApp();
  const { user } = useAuth();
  const role = (user?.role || "technician").toLowerCase();
  const isAdmin = role === "admin";
  const isFinance = role === "finance";
  const canSeeOps = isAdmin || ["manager", "store_manager", "approver"].includes(role);
  const canSeeReports = isAdmin || ["manager", "finance"].includes(role);
  const canSeeFinanceCards = isAdmin || isFinance;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lowStockRows, setLowStockRows] = useState<Array<{ id: number; sku: string; name: string; qoh: number; min: number }>>([]);
  const [pendingRows, setPendingRows] = useState<Array<{ id: number; status: string; created_at: string }>>([]);
  const [openJobs, setOpenJobs] = useState(0);
  const [inventoryValue, setInventoryValue] = useState(0);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);

  const [financeApiBase, setFinanceApiBase] = useState(localStorage.getItem("finance_api_base") || "");
  const [financeWebhook, setFinanceWebhook] = useState(localStorage.getItem("finance_webhook") || "");

  const pendingCount = pendingRows.length;
  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [itemsResp, lowResp, reqs, jobs] = await Promise.all([
        listItems({ page: 1, page_size: 1000, sort: "updated_at", direction: "desc", include_inactive: true }),
        listLowStock({ limit: 100 }),
        listRequests(),
        listJobs()
      ]);
      const inv = itemsResp.items.reduce((sum, item) => sum + (item.unit_price ?? 0) * (item.quantity_on_hand ?? 0), 0);
      const open = jobs.filter((j) => !["completed", "canceled"].includes((j.status || "").toLowerCase())).length;
      const pending = reqs.filter((r) => ["pending", "approved"].includes((r.status || "").toLowerCase())).slice(0, 8);
      setInventoryValue(inv);
      setOpenJobs(open);
      setLowStockRows(lowResp.map((p) => ({ id: p.id, sku: p.sku, name: p.name, qoh: p.quantity_on_hand, min: p.min_quantity })));
      setPendingRows(pending.map((r) => ({ id: r.id, status: r.status, created_at: r.created_at })));
      setForecast(makeForecast(lowResp.length, open));
    } catch (e: any) {
      setError(e?.message || "Failed to load console data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const overviewLines = useMemo(
    () =>
      aiOverview({
        role,
        lowStockCount: lowStockRows.length,
        openJobs,
        pendingRequests: pendingCount,
        inventoryValue
      }),
    [role, lowStockRows.length, openJobs, pendingCount, inventoryValue]
  );

  async function exportFinancePack() {
    try {
      const [stock, movement, audit] = await Promise.all([
        downloadReport("/api/reports/stock-level", { format: "excel" }),
        downloadReport("/api/reports/stock-movement", { format: "excel" }),
        downloadReport("/api/reports/audit-trail", { format: "excel" })
      ]);
      await saveBlobBatch([
        { blob: stock, filename: "finance-stock-level.xlsx" },
        { blob: movement, filename: "finance-stock-movement.xlsx" },
        { blob: audit, filename: "finance-audit-trail.xlsx" },
      ]);
      message.success("Finance pack exported");
    } catch (e: any) {
      message.error(e?.message || "Failed to export finance pack");
    }
  }

  function saveFinanceIntegration() {
    localStorage.setItem("finance_api_base", financeApiBase.trim());
    localStorage.setItem("finance_webhook", financeWebhook.trim());
    message.success("Finance integration settings saved");
  }

  return (
    <div className="container page-shell">
      <div className="page-topbar">
        <div className="page-heading">
          <Typography.Title level={2} style={{ marginTop: 0 }}>Console</Typography.Title>
          <Typography.Text type="secondary" className="page-subtitle">
            AI-guided overview of inventory health, demand outlook, and role-based operational priorities.
          </Typography.Text>
        </div>
        <Space className="page-quick-actions">
          <Button icon={<SyncOutlined />} onClick={refresh} loading={loading} type="primary">Refresh</Button>
          {canSeeReports ? <Button icon={<DownloadOutlined />} onClick={exportFinancePack}>Export Finance Pack</Button> : null}
        </Space>
      </div>

      {error ? <Alert type="error" message={error} showIcon /> : null}

      <div className="dashboard-grid stagger-group">
        <Card className="stat-card console-glass-card"><div className="stat-label">Inventory Value</div><div className="stat-value">{formatKes(inventoryValue)}</div><div className="stat-meta">Current stock valuation</div></Card>
        <Card className="stat-card console-glass-card"><div className="stat-label">Low Stock</div><div className="stat-value">{lowStockRows.length}</div><div className="stat-meta">Requires replenishment</div></Card>
        <Card className="stat-card console-glass-card"><div className="stat-label">Pending Flow</div><div className="stat-value">{pendingCount}</div><div className="stat-meta">Pending/approved requests</div></Card>
        <Card className="stat-card console-glass-card"><div className="stat-label">Open Jobs</div><div className="stat-value">{openJobs}</div><div className="stat-meta">Demand drivers</div></Card>
      </div>

      <div className="dashboard-split stagger-group">
        <Card title="Easy Forecast" className="console-glass-card">
          <Typography.Text type="secondary">Forecast line is an easy estimate of next demand pressure from open jobs + low stock trend.</Typography.Text>
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={forecast} margin={{ top: 16, right: 24, left: -8, bottom: 0 }}>
                <CartesianGrid stroke="rgba(110, 193, 255, 0.14)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} />
                <YAxis tickLine={false} axisLine={false} />
                <Tooltip />
                <Line type="monotone" dataKey="demand" stroke="rgba(240, 208, 141, 0.95)" strokeWidth={2.4} dot={{ r: 3 }} />
                <Line type="monotone" dataKey="forecast" stroke="rgba(103, 231, 198, 0.95)" strokeDasharray="5 4" strokeWidth={2} dot={{ r: 2 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <Typography.Text type="secondary">
            Forecast meaning: higher line means higher expected demand. Prioritize high-value and low-stock SKUs first.
          </Typography.Text>
        </Card>

        <Card title="AI Assistant" className="console-glass-card">
          <Typography.Paragraph style={{ marginTop: 0 }}>
            The assistant has moved to a dedicated page with a full conversational workspace.
          </Typography.Paragraph>
          <ul className="guide-list">
            {overviewLines.map((line) => <li key={line}>{line}</li>)}
          </ul>
          <Button type="primary" href="/assistant">Open AI Assistant</Button>
        </Card>
      </div>

      <div className="dashboard-columns stagger-group">
        <Card title="Low Stock Alerts" className="console-glass-card">
          <Table
            size="small"
            rowKey="id"
            dataSource={lowStockRows}
            pagination={{ pageSize: 6 }}
            columns={[
              { title: "SKU", dataIndex: "sku", key: "sku" },
              { title: "Item", dataIndex: "name", key: "name" },
              { title: "On Hand", dataIndex: "qoh", key: "qoh" },
              { title: "Min", dataIndex: "min", key: "min" }
            ]}
            locale={{ emptyText: "No low-stock alerts." }}
          />
        </Card>

        {canSeeOps ? (
          <Card title="Workflow Queue" className="console-glass-card">
            <Table
              size="small"
              rowKey="id"
              dataSource={pendingRows}
              pagination={false}
              columns={[
                { title: "Request", key: "ref", render: (_: unknown, row: { id: number }) => formatRequestRef(row.id) },
                { title: "Status", dataIndex: "status", key: "status", render: (v: string) => <Tag color="gold">{String(v || "").toUpperCase()}</Tag> },
                { title: "Created", dataIndex: "created_at", key: "created_at" }
              ]}
            />
          </Card>
        ) : null}

        {canSeeFinanceCards ? (
          <Card title="Finance Transparency" className="console-glass-card">
            <Space direction="vertical" style={{ width: "100%" }}>
              <Typography.Text type="secondary">Finance team can monitor and export verifiable stock + audit reports.</Typography.Text>
              <Space wrap>
                <Tag color="blue">Stock Level</Tag>
                <Tag color="cyan">Stock Movement</Tag>
                <Tag color="green">Audit Trail</Tag>
              </Space>
              <Button icon={<DownloadOutlined />} onClick={exportFinancePack}>Export Transparency Pack</Button>
            </Space>
          </Card>
        ) : null}

        {canSeeFinanceCards ? (
          <Card title="Finance System Integration" className="console-glass-card finance-integration-card">
            <Typography.Text type="secondary">
              Recommended integration: scheduled report export + webhook push to your finance platform for daily reconciliation.
            </Typography.Text>
            <Form layout="vertical" style={{ marginTop: 10 }}>
              <Form.Item label="Finance API Base URL">
                <Input value={financeApiBase} onChange={(e) => setFinanceApiBase(e.target.value)} placeholder="https://finance.example.com/api" />
              </Form.Item>
              <Form.Item label="Webhook Endpoint">
                <Input value={financeWebhook} onChange={(e) => setFinanceWebhook(e.target.value)} placeholder="https://finance.example.com/webhook/inventory" />
              </Form.Item>
              <Space className="finance-integration-actions">
                <Button onClick={saveFinanceIntegration} type="primary">Save Integration</Button>
                <Button
                  onClick={() =>
                    message.info("Integration test stub: next step is backend job to POST report snapshots to this endpoint.")
                  }
                >
                  Test Connection
                </Button>
              </Space>
            </Form>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
