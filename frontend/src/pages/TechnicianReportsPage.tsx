import { App as AntdApp, Card, Typography, Row, Col, Statistic, Table, Tag, DatePicker, Space, Button } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useAuth } from "../state/AuthContext";
import { getMyStockUsage, getMyFrequentlyUsedItems, type TechnicianFrequentItem } from "../api/reportsV2";
import { listJobs } from "../api/jobs";
import { downloadReport } from "../api/reports";
import { listMyZones } from "../api/users";
import { listMyIssuedItems } from "../api/requests";
import type { TechnicianZone } from "../api/types";
import type { Job } from "../api/types";
import dayjs from "dayjs";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

export default function TechnicianReportsPage() {
  const { message } = AntdApp.useApp();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [myJobs, setMyJobs] = useState<Job[]>([]);
  const [frequentItems, setFrequentItems] = useState<TechnicianFrequentItem[]>([]);
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [stats, setStats] = useState({
    totalJobs: 0,
    completedJobs: 0,
    inProgressJobs: 0,
    totalItemsUsed: 0,
    openIssuedItems: 0,
    openIssuedBatchQty: 0,
  });
  const [zones, setZones] = useState<TechnicianZone[]>([]);

  // Initialize dates
  useEffect(() => {
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    setEndDate(now.toISOString().split("T")[0]);
    setStartDate(thirtyDaysAgo.toISOString().split("T")[0]);
  }, []);

  useEffect(() => {
    if (startDate && endDate && user) {
      loadData();
    }
  }, [startDate, endDate, user]);

  const loadData = async () => {
    try {
      setLoading(true);
      
      const [jobsRes, usageRes, frequentRes, zonesRes, issuedRes] = await Promise.all([
        listJobs(),
        getMyStockUsage(startDate, endDate),
        getMyFrequentlyUsedItems(startDate, endDate),
        listMyZones(),
        listMyIssuedItems(),
      ]);
      
      // Filter jobs to only show current user's jobs
      const allJobs = jobsRes || [];
      const myJobsList = allJobs.filter((j: Job) => j.assigned_to_user_id === user?.id);
      
      // The usageRes already contains current user's usage
      const myUsage = usageRes;
      const items = frequentRes || [];
      
      setMyJobs(myJobsList);
      setFrequentItems(items);
      setZones(zonesRes || []);
      
      setStats({
        totalJobs: myJobsList.length,
        completedJobs: myJobsList.filter((j: Job) => j.status === "completed").length,
        inProgressJobs: myJobsList.filter((j: Job) => j.status === "in_progress" || j.status === "assigned").length,
        totalItemsUsed: myUsage?.total_parts_used || 0,
        openIssuedItems: issuedRes?.instances?.length || 0,
        openIssuedBatchQty: (issuedRes?.batches || []).reduce((sum, row) => sum + Number(row.quantity_remaining || 0), 0),
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
      
      if (type === "items") {
        // Download my frequently used items
        blob = await downloadReport("/api/reports/technician/frequently-used/export", { start_date: startDate, end_date: endDate, limit: 200 });
        filename = `my_frequent_items_${startDate}_${endDate}.csv`;
      } else {
        // Download my stock movement
        blob = await downloadReport("/api/reports/technician/my-stock-movement", { start: startDate, end: endDate });
        filename = `my_job_history_${startDate}_${endDate}.csv`;
      }
      
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Download failed:", error);
      message.error("Failed to download report");
    }
  };

  // Frequent items columns
  const itemColumns = [
    {
      title: "Item",
      dataIndex: "part_name",
      key: "part_name",
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
      title: "Customer",
      dataIndex: "customer_name",
      key: "customer_name",
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
          <Title level={2}>My Performance Reports</Title>
          <Text>Your personal job history and item usage</Text>
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
            <Statistic title="My Total Jobs" value={stats.totalJobs} />
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
            <Statistic title="Items Used" value={stats.totalItemsUsed} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Open Issued Serials" value={stats.openIssuedItems} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card>
            <Statistic title="Open Batch Qty" value={stats.openIssuedBatchQty} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={12}>
          <Card>
            <Statistic title="Assigned Zones" value={zones.length} />
            <Text type="secondary">
              {zones.slice(0, 2).map((z) => z.station_name).join(", ") || "No zones assigned"}
            </Text>
          </Card>
        </Col>
      </Row>
      
      <Card 
        title="Frequently Used Items" 
        style={{ marginTop: 24 }}
        extra={<Button icon={<DownloadOutlined />} onClick={() => handleDownload("items")}>Download</Button>}
      >
        <Table
          dataSource={frequentItems}
          columns={itemColumns}
          rowKey="part_id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: "max-content" }}
        />
      </Card>
      
      <Card 
        title="My Job History" 
        style={{ marginTop: 24 }}
        extra={<Button icon={<DownloadOutlined />} onClick={() => handleDownload("jobs")}>Download</Button>}
      >
        <Table
          dataSource={myJobs}
          columns={jobColumns}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={{ x: "max-content" }}
        />
      </Card>
      <Card title="My Zones" style={{ marginTop: 24 }}>
        <Table
          dataSource={zones}
          rowKey="id"
          loading={loading}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Order", dataIndex: "zone_order", key: "zone_order", width: 90 },
            { title: "Region", dataIndex: "region_label", key: "region_label" },
            { title: "Station", dataIndex: "station_name", key: "station_name" },
            { title: "Client", dataIndex: "client_code", key: "client_code", render: (v: string | null) => v || "-" },
          ]}
          scroll={{ x: "max-content" }}
        />
      </Card>
    </div>
  );
}
