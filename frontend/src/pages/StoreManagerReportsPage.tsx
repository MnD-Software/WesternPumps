import React, { useEffect, useState } from "react";
import { App as AntdApp, Card, Table, DatePicker, Space, Typography, Row, Col, Statistic, Tag, Button } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import {
  getStockUsageReport,
  getFrequentlyUsedItems,
  getStockUsageByTechnician,
  getIssuanceKpis,
  type StockUsage,
  type FrequentlyUsedItem,
  type StockUsageByTechnician,
  type IssuanceKpis,
} from "../api/reportsV2";
import { useAuth } from "../state/AuthContext";
import { downloadReport } from "../api/reports";
import { formatKes } from "../utils/currency";

const { RangePicker } = DatePicker;
const { Title, Text } = Typography;

export default function StoreManagerReportsPage() {
  const { message } = AntdApp.useApp();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [stockUsage, setStockUsage] = useState<StockUsage[]>([]);
  const [frequentItems, setFrequentItems] = useState<FrequentlyUsedItem[]>([]);
  const [usageByTech, setUsageByTech] = useState<StockUsageByTechnician[]>([]);
  const [issuanceKpis, setIssuanceKpis] = useState<IssuanceKpis | null>(null);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  // Initialize dates on mount
  useEffect(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setEndDate(now.toISOString().split("T")[0]);
    setStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
  }, []);

  const canView = user?.role === "store_manager" || user?.role === "manager" || user?.role === "admin" || user?.role === "finance";

  useEffect(() => {
    if (canView && startDate && endDate) {
      loadReports();
    }
  }, [canView, startDate, endDate]);

  async function loadReports() {
    setLoading(true);
    try {
      const [usage, frequent, byTech] = await Promise.all([
        getStockUsageReport(startDate, endDate, 50),
        getFrequentlyUsedItems(startDate, endDate, 20),
        getStockUsageByTechnician(startDate, endDate),
      ]);
      const kpis = await getIssuanceKpis(startDate, endDate);

      setStockUsage(usage);
      setFrequentItems(frequent);
      setUsageByTech(byTech);
      setIssuanceKpis(kpis);
    } catch (err) {
      console.error("Failed to load reports:", err);
    } finally {
      setLoading(false);
    }
  }

  function handleDateChange(dates: any, dateStrings: [string, string]) {
    if (dates) {
      setStartDate(dateStrings[0]);
      setEndDate(dateStrings[1]);
    }
  }

  async function triggerDownload(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  const handleExport = async () => {
    try {
      const [stockBlob, frequentBlob, byTechBlob] = await Promise.all([
        downloadReport("/api/reports/store-manager/stock-usage/export", { start_date: startDate, end_date: endDate, limit: 500 }),
        downloadReport("/api/reports/store-manager/frequently-used/export", { start_date: startDate, end_date: endDate, limit: 200 }),
        downloadReport("/api/reports/store-manager/usage-by-technician/export", { start_date: startDate, end_date: endDate }),
      ]);
      await triggerDownload(stockBlob, `stock_usage_${startDate}_${endDate}.csv`);
      await triggerDownload(frequentBlob, `frequently_used_${startDate}_${endDate}.csv`);
      await triggerDownload(byTechBlob, `usage_by_technician_${startDate}_${endDate}.csv`);
    } catch (err) {
      console.error("Export failed:", err);
      message.error("Failed to export reports");
    }
  };

  if (!canView) {
    return (
      <Card>
        <Typography.Text type="danger">Access denied. Store Manager role required.</Typography.Text>
      </Card>
    );
  }

  const stockUsageColumns = [
    { title: "SKU", dataIndex: "sku", key: "sku" },
    { title: "Part Name", dataIndex: "part_name", key: "part_name" },
    { title: "Category", dataIndex: "category", key: "category" },
    { title: "Total Used", dataIndex: "total_used", key: "total_used", render: (v: number) => v.toLocaleString() },
    { title: "Total Value", dataIndex: "total_value", key: "total_value", render: (v: number) => formatKes(v) },
    { title: "Usage Count", dataIndex: "usage_count", key: "usage_count" },
  ];

  const frequentColumns = [
    { title: "SKU", dataIndex: "sku", key: "sku" },
    { title: "Part Name", dataIndex: "part_name", key: "part_name" },
    { title: "Category", dataIndex: "category", key: "category" },
    { title: "Usage Count", dataIndex: "usage_count", key: "usage_count" },
    { title: "Total Qty", dataIndex: "total_quantity", key: "total_quantity" },
    { title: "Avg/Use", dataIndex: "average_per_use", key: "average_per_use", render: (v: number) => v.toFixed(2) },
  ];

  const techColumns = [
    { title: "Technician", dataIndex: "technician_name", key: "technician_name" },
    { title: "Transactions", dataIndex: "total_transactions", key: "total_transactions" },
    { title: "Parts Used", dataIndex: "total_parts_used", key: "total_parts_used" },
    { title: "Total Value", dataIndex: "total_value", key: "total_value", render: (v: number) => formatKes(v) },
  ];

  return (
    <div className="container page-shell">
      <Row gutter={[12, 12]} align="middle" justify="space-between" style={{ marginBottom: 16 }}>
        <Col xs={24} md={10}>
          <Title level={3} style={{ margin: 0 }}>Store Manager Reports</Title>
        </Col>
        <Col xs={24} md={14} style={{ display: "flex", justifyContent: "flex-end" }}>
          <Space wrap>
            <Text>Date Range:</Text>
            <RangePicker onChange={handleDateChange} />
            <Button icon={<DownloadOutlined />} onClick={handleExport}>Export</Button>
          </Space>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Stock Items Used"
              value={stockUsage.length}
              loading={loading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Total Usage Value"
              value={stockUsage.reduce((sum, i) => sum + i.total_value, 0)}
              formatter={(value) => formatKes(Number(value || 0))}
              loading={loading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Technicians Active"
              value={usageByTech.length}
              loading={loading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Top Item Used"
              value={frequentItems[0]?.part_name || "N/A"}
              loading={loading}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Issue Transactions" value={issuanceKpis?.total_issue_transactions ?? 0} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Issue Quantity" value={issuanceKpis?.total_issue_quantity ?? 0} loading={loading} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic
              title="Avg Issue Value"
              value={issuanceKpis?.avg_issue_value ?? 0}
              formatter={(value) => formatKes(Number(value || 0))}
              loading={loading}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Pending Returns" value={issuanceKpis?.pending_returns ?? 0} loading={loading} />
            <Text type="secondary">
              Approval rate: {(issuanceKpis?.return_approval_rate_percent ?? 0).toFixed(1)}%
            </Text>
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col span={24}>
          <Card title="Stock Usage Report" style={{ marginBottom: 16 }}>
            <Table
              dataSource={stockUsage}
              columns={stockUsageColumns}
              rowKey="part_id"
              loading={loading}
              pagination={{ pageSize: 10 }}
              size="small"
              scroll={{ x: "max-content" }}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card title="Most Frequently Used Items" style={{ marginBottom: 16 }}>
            <Table
              dataSource={frequentItems}
              columns={frequentColumns}
              rowKey="part_id"
              loading={loading}
              pagination={{ pageSize: 10 }}
              size="small"
              scroll={{ x: "max-content" }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Usage by Technician" style={{ marginBottom: 16 }}>
            <Table
              dataSource={usageByTech}
              columns={techColumns}
              rowKey="technician_id"
              loading={loading}
              pagination={{ pageSize: 10 }}
              size="small"
              scroll={{ x: "max-content" }}
            />
          </Card>
        </Col>
      </Row>

    </div>
  );
}
