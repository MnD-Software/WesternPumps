import { useEffect, useState } from "react";
import { Alert, Card, Space, Spin, Table, Typography } from "antd";
import { listMyZones } from "../api/users";
import type { TechnicianZone } from "../api/types";
import { getApiErrorMessage } from "../api/error";

export default function MyZonesPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [zones, setZones] = useState<TechnicianZone[]>([]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setZones(await listMyZones());
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load your zones"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  return (
    <div className="container page-shell">
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        My Zones
      </Typography.Title>
      <Card>
        {loading ? (
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">Loading zones...</Typography.Text>
          </Space>
        ) : (
          <>
            <Typography.Paragraph type="secondary">
              These are your assigned service stations and regions.
            </Typography.Paragraph>
            <Table<TechnicianZone>
              rowKey="id"
              dataSource={zones}
              pagination={{ pageSize: 12, showSizeChanger: false }}
              columns={[
                { title: "Order", dataIndex: "zone_order", key: "zone_order", width: 90 },
                { title: "Region", dataIndex: "region_label", key: "region_label" },
                { title: "Station", dataIndex: "station_name", key: "station_name" },
                { title: "Client", dataIndex: "client_code", key: "client_code", render: (v: string | null) => v || "-" },
              ]}
            />
          </>
        )}
        {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} /> : null}
      </Card>
    </div>
  );
}

