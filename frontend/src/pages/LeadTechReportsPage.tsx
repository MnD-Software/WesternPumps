import { App as AntdApp, Card, Typography, Row, Col, Statistic, Table, Tag, Button, DatePicker, Select, Space } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useAuth } from "../state/AuthContext";
import { getStockUsageByTechnician, getFrequentlyUsedItems, type StockUsageByTechnician, type FrequentlyUsedItem } from "../api/reportsV2";
import { listJobs } from "../api/jobs";
import { downloadReport } from "../api/reports";
import type { Job } from "../api/types";
import dayjs from "dayjs";
import { formatKes } from "../utils/currency";
import { saveBlob } from "../utils/download";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export default function LeadTechReportsPage() {
  const { message } = AntdApp.useApp();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [usageByTech, setUsageByTech] = useState<StockUsageByTechnician[]>([]);
  const [frequentItems, setFrequentItems] = useState<FrequentlyUsedItem[]>([]);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [stats, setStats] = useState({
    totalJobs: 0,
    completedJobs: 0,
    inProgressJobs: 0,
    totalTechnicians: 0,
  });

  // Initialize dates
  useEffect(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setEndDate(now.toISOString().split("T")[0]);
    setStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
  }, []);

  useEffect(() => {
    if (startDate && endDate) {
      loadData();
    }
  }, [startDate, endDate]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      const [jobsRes, usageRes, frequentRes] = await Promise.all([
        listJobs(),
        getStockUsageByTechnician(startDate, endDate),
        getFrequentlyUsedItems(startDate, endDate),
      ]);
      
      const jobsData = (jobsRes || []).filter((j: Job) => {
        const createdAt = j.created_at ? new Date(j.created_at) : null;
        if (!createdAt) return true;
        const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
        const end = endDate ? new Date(`${endDate}T23:59:59`) : null;
        if (start && createdAt < start) return false;
        if (end && createdAt > end) return false;
        return true;
      });
      const techUsage = usageRes || [];
      const items = frequentRes || [];
      
      // Calculate stats
      const uniqueTechs = new Set(techUsage.map((t: StockUsageByTechnician) => t.technician_id));
      
      setJobs(jobsData);
      setUsageByTech(techUsage);
      setFrequentItems(items);
      
      setStats({
        totalJobs: jobsData.length,
        completedJobs: jobsData.filter((j: Job) => j.status === "completed").length,
        inProgressJobs: jobsData.filter((j: Job) => j.status === "in_progress" || j.status === "assigned").length,
        totalTechnicians: uniqueTechs.size,
      });
    } catch (error) {
      console.error("Failed to load report data:", error);
      message.error("Failed to load report data");
    } finally {
      setLoading(false);
    }
  };

  const handleDateChange = (dates: any) => {
    if (dates) {
      setStartDate(dates[0].format("YYYY-MM-DD"));
      setEndDate(dates[1].format("YYYY-MM-DD"));
    }
  };

  // Download handler
  const handleDownload = async (type: string) => {
    try {
      let blob: Blob;
      let filename: string;
      
      if (type === "technicians") {
        blob = await downloadReport("/api/reports/store-manager/usage-by-technician/export", { start_date: startDate, end_date: endDate });
        filename = `technician_usage_${startDate}_${endDate}.csv`;
      } else if (type === "items") {
        blob = await downloadReport("/api/reports/store-manager/frequently-used/export", { start_date: startDate, end_date: endDate, limit: 200 });
        filename = `frequent_items_${startDate}_${endDate}.csv`;
      } else if (type === "jobs") {
        blob = await downloadReport("/api/reports/jobs", { start_date: startDate, end_date: endDate, format: "csv" });
        filename = `jobs_${startDate}_${endDate}.csv`;
      } else {
        blob = await downloadReport("/api/reports/store-manager/stock-usage/export", { start_date: startDate, end_date: endDate, limit: 500 });
        filename = `stock_usage_${startDate}_${endDate}.csv`;
      }
      
      saveBlob(blob, filename);
    } catch (error) {
      console.error("Download failed:", error);
      message.error("Failed to download report");
    }
  };

  // Technician usage columns
  const techColumns = [
    {
      title: "Technician",
      dataIndex: "technician_name",
      key: "technician_name",
    },
    {
      title: "Total Items Used",
      dataIndex: "total_items",
      key: "total_items",
    },
    {
      title: "Total Value",
      dataIndex: "total_value",
      key: "total_value",
      render: (val: number) => formatKes(val ?? 0),
    },
    {
      title: "Unique Items",
      dataIndex: "unique_items",
      key: "unique_items",
    },
  ];

  // Frequent items columns
  const itemColumns = [
    {
      title: "Item",
      dataIndex: "item_name",
      key: "item_name",
    },
    {
      title: "SKU",
      dataIndex: "sku",
      key: "sku",
    },
    {
      title: "Times Used",
      dataIndex: "usage_count",
      key: "usage_count",
    },
    {
      title: "Total Quantity",
      dataIndex: "total_quantity",
      key: "total_quantity",
    },
  ];

  // Jobs columns
  const jobColumns = [
    {
      title: "Job ID",
      dataIndex: "id",
      key: "id",
      render: (id: number) => `#${id}`,
    },
    {
      title: "Title",
      dataIndex: "title",
      key: "title",
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => {
        const colors: Record<string, string> = {
          completed: "green",
          in_progress: "blue",
          assigned: "orange",
          pending: "default",
          cancelled: "red",
        };
        return <Tag color={colors[status] || "default"}>{status.replace("_", " ")}</Tag>;
      },
    },
    {
      title: "Assigned To",
      dataIndex: "assigned_to_name",
      key: "assigned_to_name",
    },
    {
      title: "Created",
      dataIndex: "created_at",
      key: "created_at",
      render: (date: string) => dayjs(date).format("MMM D, YYYY"),
    },
  ];

  return (
    <div className="container page-shell">
      <Row gutter={[12, 12]} justify="space-between" align="middle">
        <Col xs={24} md={12}>
          <Title level={2}>Lead Technician Reports</Title>
          <Text>Overview of technician activity, job assignments, and item usage</Text>
        </Col>
        <Col xs={24} md={12} style={{ display: "flex", justifyContent: "flex-end" }}>
          <Space wrap>
            <Text>Date Range:</Text>
            <RangePicker 
              defaultValue={[dayjs().subtract(30, "day"), dayjs()]}
              onChange={handleDateChange}
              format="YYYY-MM-DD"
            />
          </Space>
        </Col>
      </Row>
      
      <Row gutter={[12, 12]} style={{ marginTop: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Total Jobs" value={stats.totalJobs} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Completed Jobs" value={stats.completedJobs} valueStyle={{ color: "#3f8600" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="In Progress" value={stats.inProgressJobs} valueStyle={{ color: "#1890ff" }} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Active Technicians" value={stats.totalTechnicians} />
          </Card>
        </Col>
      </Row>
      
      <Card 
        title="Stock Usage by Technician" 
        style={{ marginTop: 24 }}
        extra={<Button icon={<DownloadOutlined />} onClick={() => handleDownload("technicians")}>Download</Button>}
      >
        <Table
          dataSource={usageByTech}
          columns={techColumns}
          rowKey="technician_id"
          loading={loading}
          pagination={false}
          scroll={{ x: "max-content" }}
        />
      </Card>
      
      <Card 
        title="Frequently Used Items" 
        style={{ marginTop: 24 }}
        extra={<Button icon={<DownloadOutlined />} onClick={() => handleDownload("items")}>Download</Button>}
      >
        <Table
          dataSource={frequentItems}
          columns={itemColumns}
          rowKey="item_id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: "max-content" }}
        />
      </Card>
      
      <Card
        title="All Jobs"
        style={{ marginTop: 24 }}
        extra={<Button icon={<DownloadOutlined />} onClick={() => handleDownload("jobs")}>Download</Button>}
      >
        <Table
          dataSource={jobs}
          columns={jobColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  );
}
