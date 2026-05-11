import React, { useEffect, useState } from "react";
import { Card, Typography, Spin, Result, Button, Descriptions, Tag, QRCode } from "antd";
import { useSearchParams, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { formatKes } from "../utils/currency";

interface PartVerification {
  part_id: number;
  sku: string;
  name: string;
  is_valid: boolean;
  is_active: boolean;
  category: string | null;
  location: string | null;
  quantity_on_hand: number;
  unit_price: number | null;
  message: string;
}

export default function VerifyItemPage() {
  const [searchParams] = useSearchParams();
  const params = useParams<{ partId: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<PartVerification | null>(null);
  const [error, setError] = useState<string | null>(null);

  const partId = params.partId || searchParams.get("part_id");
  const sku = searchParams.get("sku");

  useEffect(() => {
    async function verify() {
      if (!partId) {
        setError("No part ID provided");
        setLoading(false);
        return;
      }

      try {
        const params = new URLSearchParams();
        if (sku) params.append("sku", sku);
        
        const response = await api.get<PartVerification>(`/api/verify/${partId}?${params}`);
        setData(response.data);
      } catch (err: any) {
        setError(err.response?.data?.detail || "Failed to verify item");
      } finally {
        setLoading(false);
      }
    }

    verify();
  }, [partId, sku]);

  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 24, maxWidth: 600, margin: "0 auto" }}>
        <Result
          status="error"
          title="Verification Failed"
          subTitle={error}
          extra={
            <Button type="primary" onClick={() => navigate("/")}>
              Go to Homepage
            </Button>
          }
        />
      </div>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <div style={{ padding: 24, maxWidth: 600, margin: "0 auto" }}>
      <Result
        status={data.is_valid ? "success" : "warning"}
        title={data.is_valid ? "✅ Item Verified" : "⚠️ Item Not Found"}
        subTitle={data.message}
      />

      {data.is_valid && (
        <Card style={{ marginTop: 16 }}>
          <div style={{ textAlign: "center", marginBottom: 24 }}>
            <QRCode value={`${window.location.origin}/verify/${data.part_id}?sku=${data.sku}`} size={150} />
            <Typography.Title level={4} style={{ marginTop: 16 }}>{data.name}</Typography.Title>
            <Tag color="blue">{data.sku}</Tag>
          </div>

          <Descriptions column={1} bordered size="small">
            <Descriptions.Item label="Status">
              <Tag color={data.is_active ? "green" : "red"}>
                {data.is_active ? "Active" : "Inactive"}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="Category">{data.category || "N/A"}</Descriptions.Item>
            <Descriptions.Item label="Location">{data.location || "N/A"}</Descriptions.Item>
            <Descriptions.Item label="Quantity on Hand">{data.quantity_on_hand}</Descriptions.Item>
            <Descriptions.Item label="Unit Price">
              {data.unit_price ? formatKes(data.unit_price) : "N/A"}
            </Descriptions.Item>
          </Descriptions>

          <div style={{ marginTop: 24, textAlign: "center" }}>
            <Typography.Text type="secondary">
              Western Pumps Inventory System
            </Typography.Text>
          </div>
        </Card>
      )}

      <div style={{ marginTop: 24, textAlign: "center" }}>
        <Button type="link" onClick={() => navigate("/")}>
          Visit Western Pumps
        </Button>
      </div>
    </div>
  );
}
