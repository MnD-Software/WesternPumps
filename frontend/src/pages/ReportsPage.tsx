import React, { useMemo, useState } from "react";
import { Alert, Button, Card, Collapse, DatePicker, Input, InputNumber, Select, Space, Tag, Typography } from "antd";
import type { Dayjs } from "dayjs";
import { getApiErrorMessage } from "../api/error";
import { downloadReport } from "../api/reports";
import { saveBlob } from "../utils/download";

type ReportFormat = "excel" | "pdf" | "docx" | "csv";

type FiltersState = {
  format: ReportFormat;
  q: string;
  lowOnly: boolean;
  categoryId?: number;
  locationId?: number;
  stockLevelPartId?: number;
  partId?: number;
  traceItemInstanceId?: number;
  traceSerialNumber: string;
  techId?: number;
  auditUserId?: number;
  auditEntityType: string;
  auditAction: string;
  startDate?: string;
  endDate?: string;
};

const FILE_EXT: Record<ReportFormat, string> = {
  excel: "xlsx",
  pdf: "pdf",
  docx: "docx",
  csv: "csv",
};

export default function ReportsPage() {
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<FiltersState>({
    format: "excel",
    q: "",
    lowOnly: false,
    traceSerialNumber: "",
    auditEntityType: "",
    auditAction: "",
  });

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.q.trim()) count += 1;
    if (filters.lowOnly) count += 1;
    if (filters.categoryId) count += 1;
    if (filters.locationId) count += 1;
    if (filters.stockLevelPartId) count += 1;
    if (filters.partId) count += 1;
    if (filters.techId) count += 1;
    if (filters.traceItemInstanceId) count += 1;
    if (filters.traceSerialNumber.trim()) count += 1;
    if (filters.auditUserId) count += 1;
    if (filters.auditEntityType.trim()) count += 1;
    if (filters.auditAction.trim()) count += 1;
    if (filters.startDate) count += 1;
    if (filters.endDate) count += 1;
    return count;
  }, [filters]);

  async function handle(path: string, filename: string, params?: Record<string, unknown>) {
    setError(null);
    try {
      const blob = await downloadReport(path, params);
      saveBlob(blob, filename);
    } catch (err) {
      setError(getApiErrorMessage(err, "Failed to download report"));
    }
  }

  function reportFilename(base: string) {
    return `${base}.${FILE_EXT[filters.format]}`;
  }

  function onDateChange(setter: "startDate" | "endDate", value: Dayjs | null) {
    setFilters((prev) => ({ ...prev, [setter]: value ? value.toISOString() : undefined }));
  }

  return (
    <div className="container page-shell reports-page-compact">
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        Reports
      </Typography.Title>

      <Card className="reports-toolbar" styles={{ body: { paddingBottom: 10 } }}>
        <Space wrap size={10} style={{ width: "100%" }}>
          <div className="reports-toolbar-field">
            <Typography.Text type="secondary">Format</Typography.Text>
            <Select
              value={filters.format}
              onChange={(value) => setFilters((prev) => ({ ...prev, format: value }))}
              style={{ width: 120 }}
              options={[
                { value: "excel", label: "Excel" },
                { value: "pdf", label: "PDF" },
                { value: "docx", label: "DOCX" },
                { value: "csv", label: "CSV" },
              ]}
            />
          </div>
          <div className="reports-toolbar-field">
            <Typography.Text type="secondary">Search SKU/Name</Typography.Text>
            <Input
              value={filters.q}
              onChange={(event) => setFilters((prev) => ({ ...prev, q: event.target.value }))}
              placeholder="SKU or product name"
              style={{ width: 240 }}
            />
          </div>
          <div className="reports-toolbar-field">
            <Typography.Text type="secondary">Date Range</Typography.Text>
            <Space size={8}>
              <DatePicker showTime onChange={(value) => onDateChange("startDate", value)} />
              <DatePicker showTime onChange={(value) => onDateChange("endDate", value)} />
            </Space>
          </div>
          <Tag color={activeFilterCount > 0 ? "processing" : "default"}>Active Filters: {activeFilterCount}</Tag>
        </Space>

        <Collapse
          ghost
          items={[
            {
              key: "advanced",
              label: "Advanced filters",
              children: (
                <div className="reports-filter-grid" style={{ marginTop: 6 }}>
                  <div>
                    <Typography.Text type="secondary">Low Stock Only</Typography.Text>
                    <Select
                      value={filters.lowOnly ? "yes" : "no"}
                      onChange={(value) => setFilters((prev) => ({ ...prev, lowOnly: value === "yes" }))}
                      options={[
                        { value: "no", label: "No" },
                        { value: "yes", label: "Yes" },
                      ]}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Category ID</Typography.Text>
                    <InputNumber
                      value={filters.categoryId}
                      onChange={(value) => setFilters((prev) => ({ ...prev, categoryId: value == null ? undefined : Number(value) }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Location ID</Typography.Text>
                    <InputNumber
                      value={filters.locationId}
                      onChange={(value) => setFilters((prev) => ({ ...prev, locationId: value == null ? undefined : Number(value) }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Stock Level Part ID</Typography.Text>
                    <InputNumber
                      value={filters.stockLevelPartId}
                      onChange={(value) => setFilters((prev) => ({ ...prev, stockLevelPartId: value == null ? undefined : Number(value) }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Movement Part ID</Typography.Text>
                    <InputNumber
                      value={filters.partId}
                      onChange={(value) => setFilters((prev) => ({ ...prev, partId: value == null ? undefined : Number(value) }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Technician ID</Typography.Text>
                    <InputNumber
                      value={filters.techId}
                      onChange={(value) => setFilters((prev) => ({ ...prev, techId: value == null ? undefined : Number(value) }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Trace Item Instance ID</Typography.Text>
                    <InputNumber
                      value={filters.traceItemInstanceId}
                      onChange={(value) => setFilters((prev) => ({ ...prev, traceItemInstanceId: value == null ? undefined : Number(value) }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Trace Serial Number</Typography.Text>
                    <Input
                      value={filters.traceSerialNumber}
                      onChange={(event) => setFilters((prev) => ({ ...prev, traceSerialNumber: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Audit User ID</Typography.Text>
                    <InputNumber
                      value={filters.auditUserId}
                      onChange={(value) => setFilters((prev) => ({ ...prev, auditUserId: value == null ? undefined : Number(value) }))}
                      style={{ width: "100%" }}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Audit Entity Type</Typography.Text>
                    <Input
                      value={filters.auditEntityType}
                      onChange={(event) => setFilters((prev) => ({ ...prev, auditEntityType: event.target.value }))}
                    />
                  </div>
                  <div>
                    <Typography.Text type="secondary">Audit Action</Typography.Text>
                    <Input
                      value={filters.auditAction}
                      onChange={(event) => setFilters((prev) => ({ ...prev, auditAction: event.target.value }))}
                    />
                  </div>
                </div>
              ),
            },
          ]}
        />
      </Card>

      <div className="reports-cards-grid">
        <Card title="Stock Levels" size="small">
          <Typography.Text type="secondary">Inventory balances, low-stock flags, and product/location filters.</Typography.Text>
          <div style={{ marginTop: 10 }}>
            <Button
              type="primary"
              onClick={() =>
                handle("/api/reports/stock-level", reportFilename("stock-levels"), {
                  format: filters.format,
                  q: filters.q || undefined,
                  low_only: filters.lowOnly,
                  part_id: filters.stockLevelPartId,
                  category_id: filters.categoryId,
                  location_id: filters.locationId,
                })
              }
            >
              Download Stock Levels
            </Button>
          </div>
        </Card>

        <Card title="Stock Movements" size="small">
          <Typography.Text type="secondary">Inbound/outbound trends with part, technician, and date filters.</Typography.Text>
          <div style={{ marginTop: 10 }}>
            <Button
              type="primary"
              onClick={() =>
                handle("/api/reports/stock-movement", reportFilename("stock-movements"), {
                  format: filters.format,
                  start: filters.startDate,
                  end: filters.endDate,
                  part_id: filters.partId,
                  technician_id: filters.techId,
                })
              }
            >
              Download Movements
            </Button>
          </div>
        </Card>

        <Card title="Audit Trail" size="small">
          <Typography.Text type="secondary">Full action logs for compliance and internal control reviews.</Typography.Text>
          <div style={{ marginTop: 10 }}>
            <Button
              type="primary"
              onClick={() =>
                handle("/api/reports/audit-trail", reportFilename("audit-trail"), {
                  format: filters.format,
                  start: filters.startDate,
                  end: filters.endDate,
                  user_id: filters.auditUserId,
                  entity_type: filters.auditEntityType || undefined,
                  action: filters.auditAction || undefined,
                })
              }
            >
              Download Audit Trail
            </Button>
          </div>
        </Card>

        <Card title="Item Traceability" size="small">
          <Typography.Text type="secondary">Trace individual serialized items through stock transactions and usage.</Typography.Text>
          <div style={{ marginTop: 10 }}>
            <Button
              type="primary"
              onClick={() =>
                handle("/api/reports/item-traceability", reportFilename("item-traceability"), {
                  format: filters.format,
                  item_instance_id: filters.traceItemInstanceId,
                  serial_number: filters.traceSerialNumber || undefined,
                })
              }
            >
              Download Traceability
            </Button>
          </div>
        </Card>
      </div>

      <Card title="User Accounts" size="small" style={{ marginTop: 16 }}>
        <Typography.Text type="secondary">Export all user accounts with roles and status.</Typography.Text>
        <div style={{ marginTop: 10 }}>
          <Button
            type="primary"
            onClick={() => handle("/api/users/export", "user_accounts", {})}
          >
            Download User Accounts
          </Button>
        </div>
      </Card>

      {error ? <Alert type="error" message={error} showIcon /> : null}
    </div>
  );
}
