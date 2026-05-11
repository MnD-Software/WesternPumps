import { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Select, Space, Table, Tag, Typography } from "antd";
import { getApiErrorMessage } from "../api/error";
import { listItems } from "../api/items";
import { listLocations } from "../api/locations";
import { getOutboxHealth, retryDeadOutbox, type OutboxHealth } from "../api/platform";
import {
  approveCycleCount,
  approveTransfer,
  completeTransfer,
  createCycleCount,
  createPurchaseOrder,
  createReservation,
  createTransfer,
  dispatchPurchaseOrder,
  getExecutiveSummary,
  getKpiSummary,
  getReplenishmentSuggestions,
  listCycleCounts,
  listPurchaseOrders,
  listTransfers,
  receivePurchaseOrder,
  releaseReservation,
  submitCycleCount,
  updatePurchaseOrderStatus,
} from "../api/operations";
import { listSuppliers } from "../api/suppliers";
import type { CycleCount, ExecutiveSummary, Item, KpiSummary, Location, PurchaseOrder, ReplenishmentSuggestion, Reservation, StockTransfer, Supplier } from "../api/types";
import { useAuth } from "../state/AuthContext";

const riskColor: Record<string, string> = { CRITICAL: "red", HIGH: "volcano", MEDIUM: "gold", LOW: "green" };

export default function OperationsPage() {
  const { message } = AntdApp.useApp();
  const { user, isAdmin } = useAuth();
  const role = (user?.role || "technician").toLowerCase();
  const canViewExecutive = isAdmin || role === "manager" || role === "finance";
  const [loading, setLoading] = useState(true);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [cycleCounts, setCycleCounts] = useState<CycleCount[]>([]);
  const [suggestions, setSuggestions] = useState<ReplenishmentSuggestion[]>([]);
  const [kpi, setKpi] = useState<KpiSummary | null>(null);
  const [executive, setExecutive] = useState<ExecutiveSummary | null>(null);
  const [outboxHealth, setOutboxHealth] = useState<OutboxHealth | null>(null);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [dispatchingPo, setDispatchingPo] = useState<PurchaseOrder | null>(null);
  const [dispatchRecipient, setDispatchRecipient] = useState("");
  const [dispatchMessage, setDispatchMessage] = useState("");
  const [dispatchSubmitting, setDispatchSubmitting] = useState(false);

  const [poForm] = Form.useForm();
  const [transferForm] = Form.useForm();
  const [cycleForm] = Form.useForm();
  const [reserveForm] = Form.useForm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [supplierRows, itemRows, locationRows, poRows, transferRows, cycleRows, suggestionRows, kpiRow, executiveRow, outbox] = await Promise.all([
        listSuppliers({ include_inactive: false }),
        listItems({ page: 1, page_size: 500, include_inactive: false }).then((r) => r.items),
        listLocations({ include_inactive: false }),
        listPurchaseOrders(),
        listTransfers(),
        listCycleCounts(),
        getReplenishmentSuggestions(30),
        getKpiSummary(90),
        canViewExecutive ? getExecutiveSummary(7) : Promise.resolve(null),
        canViewExecutive ? getOutboxHealth().catch(() => null) : Promise.resolve(null),
      ]);
      setSuppliers(supplierRows);
      setItems(itemRows);
      setLocations(locationRows);
      setPurchaseOrders(poRows);
      setTransfers(transferRows);
      setCycleCounts(cycleRows);
      setSuggestions(suggestionRows);
      setKpi(kpiRow);
      setExecutive(executiveRow);
      setOutboxHealth(outbox);
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to load operations data"));
    } finally {
      setLoading(false);
    }
  }, [canViewExecutive, message]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreatePO(values: { supplier_id: number; part_id: number; ordered_quantity: number; unit_cost?: number; notes?: string }) {
    try {
      await createPurchaseOrder({
        supplier_id: values.supplier_id,
        notes: values.notes,
        lines: [{ part_id: values.part_id, ordered_quantity: values.ordered_quantity, unit_cost: values.unit_cost ?? null }],
      });
      message.success("Purchase order created");
      poForm.resetFields();
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to create purchase order"));
    }
  }

  async function handleReceive(po: PurchaseOrder) {
    const firstLine = po.lines[0];
    if (!firstLine) return;
    try {
      await receivePurchaseOrder(po.id, {
        grn_number: `GRN-${Date.now()}`,
        notes: "Received via Operations page",
        lines: [{ purchase_order_line_id: firstLine.id, received_quantity: firstLine.ordered_quantity, accepted_quantity: firstLine.ordered_quantity, rejected_quantity: 0 }],
      });
      message.success(`Received PO #${po.id}`);
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to receive purchase order"));
    }
  }

  async function handleCreateTransfer(values: { from_location_id: number; to_location_id: number; part_id: number; quantity: number }) {
    try {
      await createTransfer({
        from_location_id: values.from_location_id,
        to_location_id: values.to_location_id,
        lines: [{ part_id: values.part_id, quantity: values.quantity }],
      });
      message.success("Transfer created");
      transferForm.resetFields();
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to create transfer"));
    }
  }

  function handleOpenDispatch(po: PurchaseOrder) {
    const supplier = suppliers.find((row) => row.id === po.supplier_id);
    setDispatchRecipient((supplier?.email || "").trim());
    setDispatchMessage("");
    setDispatchingPo(po);
  }

  async function handleDispatchSubmit() {
    if (!dispatchingPo) return;
    setDispatchSubmitting(true);
    try {
      const res = await dispatchPurchaseOrder(dispatchingPo.id, {
        recipient_email: dispatchRecipient.trim() || undefined,
        message: dispatchMessage.trim() || undefined,
      });
      message.success(`PO-${dispatchingPo.id} dispatched to ${res.recipient_email}`);
      setDispatchingPo(null);
      setDispatchRecipient("");
      setDispatchMessage("");
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to dispatch purchase order"));
    } finally {
      setDispatchSubmitting(false);
    }
  }

  async function handleCreateCycle(values: { location_id: number; notes?: string }) {
    try {
      await createCycleCount(values);
      message.success("Cycle count created");
      cycleForm.resetFields();
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to create cycle count"));
    }
  }

  async function handleSubmitCycle(cycle: CycleCount) {
    try {
      await submitCycleCount(
        cycle.id,
        (cycle.lines || []).map((line) => ({ id: line.id, counted_quantity: line.expected_quantity, reason: "Counted as expected" }))
      );
      message.success(`Cycle count #${cycle.id} submitted`);
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to submit cycle count"));
    }
  }

  async function handleApproveTransfer(transfer: StockTransfer) {
    try {
      await approveTransfer(transfer.id);
      message.success(`Transfer #${transfer.id} approved`);
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to approve transfer"));
    }
  }

  async function handleCompleteTransfer(transfer: StockTransfer) {
    try {
      await completeTransfer(transfer.id);
      message.success(`Transfer #${transfer.id} completed`);
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to complete transfer"));
    }
  }

  async function handleApproveCycle(cycle: CycleCount) {
    try {
      await approveCycleCount(cycle.id, "Approved from operations page");
      message.success(`Cycle count #${cycle.id} approved`);
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to approve cycle count"));
    }
  }

  async function handleReleaseReservation(reservation: Reservation) {
    try {
      await releaseReservation(reservation.id);
      message.success(`Reservation #${reservation.id} released`);
      await load();
    } catch (err) {
      message.error(getApiErrorMessage(err, "Failed to release reservation"));
    }
  }

  const itemOptions = useMemo(() => items.map((item) => ({ value: item.id, label: `${item.sku} - ${item.name}` })), [items]);
  const supplierOptions = useMemo(() => suppliers.map((supplier) => ({ value: supplier.id, label: supplier.name })), [suppliers]);
  const locationOptions = useMemo(() => locations.map((location) => ({ value: location.id, label: location.name })), [locations]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={2} style={{ marginTop: 0 }}>Operations Control Center</Typography.Title>

      <Row gutter={[12, 12]}>
        <Col xs={24} sm={12} lg={6}><Card loading={loading} title="Fill Rate">{kpi?.fill_rate_percent ?? 0}%</Card></Col>
        <Col xs={24} sm={12} lg={6}><Card loading={loading} title="Stockout Rate">{kpi?.stockout_rate_percent ?? 0}%</Card></Col>
        <Col xs={24} sm={12} lg={6}><Card loading={loading} title="Inventory Turns">{kpi?.inventory_turns_estimate ?? 0}</Card></Col>
        <Col xs={24} sm={12} lg={6}><Card loading={loading} title="Low Stock Items">{kpi?.low_stock_items ?? 0}</Card></Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={16}>
          <Card title="Replenishment Exceptions" loading={loading}>
            <Table
              rowKey="part_id"
              size="small"
              dataSource={suggestions}
              pagination={{ pageSize: 8 }}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "SKU", dataIndex: "sku" },
                { title: "Item", dataIndex: "name" },
                { title: "Available", dataIndex: "available_quantity" },
                { title: "Suggested", dataIndex: "suggested_order_quantity" },
                { title: "Risk", dataIndex: "risk_level", render: (value: string) => <Tag color={riskColor[value] || "default"}>{value}</Tag> },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Executive Weekly Snapshot" loading={loading}>
            {canViewExecutive ? (
              <>
                <p>POs Created: {executive?.purchase_orders_created ?? 0}</p>
                <p>POs Closed: {executive?.purchase_orders_closed ?? 0}</p>
                <p>Transfers Completed: {executive?.transfer_orders_completed ?? 0}</p>
                <p>Cycle Counts Approved: {executive?.cycle_counts_approved ?? 0}</p>
                <p>Top Outbound: {(executive?.top_outbound_skus ?? []).join(", ") || "-"}</p>
              </>
            ) : (
              <Typography.Text type="secondary">Not available for your role.</Typography.Text>
            )}
          </Card>
          <Card title="Integration Delivery Health" loading={loading} style={{ marginTop: 12 }}>
            {canViewExecutive ? (
              <>
                <p>Pending: {outboxHealth?.pending ?? "-"}</p>
                <p>Failed: {outboxHealth?.failed ?? "-"}</p>
                <p>Dead: {outboxHealth?.dead ?? "-"}</p>
              </>
            ) : (
              <Typography.Text type="secondary">Not available for your role.</Typography.Text>
            )}
            <Button
              size="small"
              disabled={!isAdmin}
              onClick={async () => {
                try {
                  const res = await retryDeadOutbox(100);
                  message.success(`Retried ${res.retried} dead outbox event(s)`);
                  await load();
                } catch (err) {
                  message.error(getApiErrorMessage(err, "Failed to retry dead outbox events"));
                }
              }}
            >
              Retry Dead Events
            </Button>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card title="Create Purchase Order">
            <Form layout="vertical" form={poForm} onFinish={handleCreatePO}>
              <Form.Item name="supplier_id" label="Supplier" rules={[{ required: true }]}><Select options={supplierOptions} /></Form.Item>
              <Form.Item name="part_id" label="Item" rules={[{ required: true }]}><Select options={itemOptions} showSearch optionFilterProp="label" /></Form.Item>
              <Form.Item name="ordered_quantity" label="Ordered Qty" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="unit_cost" label="Unit Cost"><InputNumber min={0} step={0.01} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="notes" label="Notes"><Input.TextArea rows={2} /></Form.Item>
              <Button type="primary" htmlType="submit">Create PO</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Purchase Orders" loading={loading}>
            <Table
              rowKey="id"
              size="small"
              dataSource={purchaseOrders}
              pagination={{ pageSize: 6 }}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "PO", dataIndex: "id", render: (v: number) => `PO-${v}` },
                { title: "Status", dataIndex: "status" },
                { title: "Lines", render: (_: unknown, row: PurchaseOrder) => row.lines.length },
                {
                  title: "Actions",
                  render: (_: unknown, row: PurchaseOrder) => (
                    <Space wrap>
                      <Button size="small" onClick={() => void updatePurchaseOrderStatus(row.id, "APPROVED").then(load)}>Approve</Button>
                      <Button size="small" onClick={() => handleOpenDispatch(row)}>Send</Button>
                      <Button size="small" onClick={() => void handleReceive(row)}>Receive</Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={8}>
          <Card title="Create Transfer">
            <Form layout="vertical" form={transferForm} onFinish={handleCreateTransfer}>
              <Form.Item name="from_location_id" label="From" rules={[{ required: true }]}><Select options={locationOptions} /></Form.Item>
              <Form.Item name="to_location_id" label="To" rules={[{ required: true }]}><Select options={locationOptions} /></Form.Item>
              <Form.Item name="part_id" label="Item" rules={[{ required: true }]}><Select options={itemOptions} showSearch optionFilterProp="label" /></Form.Item>
              <Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
              <Button type="primary" htmlType="submit">Create Transfer</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Create Cycle Count">
            <Form layout="vertical" form={cycleForm} onFinish={handleCreateCycle}>
              <Form.Item name="location_id" label="Location" rules={[{ required: true }]}><Select options={locationOptions} /></Form.Item>
              <Form.Item name="notes" label="Notes"><Input.TextArea rows={3} /></Form.Item>
              <Button type="primary" htmlType="submit">Create Cycle Count</Button>
            </Form>
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Reserve Stock">
            <Form
              layout="vertical"
              form={reserveForm}
              onFinish={async (values: { part_id: number; quantity: number; request_id?: number }) => {
                try {
                  const reservation = await createReservation(values);
                  setReservations((prev) => [reservation, ...prev]);
                  message.success("Reservation created");
                  reserveForm.resetFields();
                  await load();
                } catch (err) {
                  message.error(getApiErrorMessage(err, "Failed to reserve stock"));
                }
              }}
            >
              <Form.Item name="part_id" label="Item" rules={[{ required: true }]}><Select options={itemOptions} showSearch optionFilterProp="label" /></Form.Item>
              <Form.Item name="quantity" label="Quantity" rules={[{ required: true }]}><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="request_id" label="Request ID"><InputNumber min={1} style={{ width: "100%" }} /></Form.Item>
              <Button type="primary" htmlType="submit">Reserve</Button>
            </Form>
          </Card>
        </Col>
      </Row>

      <Row gutter={[12, 12]}>
        <Col xs={24} lg={12}>
          <Card title="Transfers" loading={loading}>
            <Table
              rowKey="id"
              size="small"
              dataSource={transfers}
              pagination={{ pageSize: 5 }}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "ID", dataIndex: "id" },
                { title: "From", dataIndex: "from_location_id" },
                { title: "To", dataIndex: "to_location_id" },
                { title: "Status", dataIndex: "status" },
                {
                  title: "Actions",
                  render: (_: unknown, row: StockTransfer) => (
                    <Space>
                      <Button size="small" disabled={row.status !== "DRAFT"} onClick={() => void handleApproveTransfer(row)}>Approve</Button>
                      <Button size="small" disabled={!["APPROVED", "IN_TRANSIT"].includes(String(row.status || ""))} onClick={() => void handleCompleteTransfer(row)}>Complete</Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="Cycle Counts" loading={loading}>
            <Table
              rowKey="id"
              size="small"
              dataSource={cycleCounts}
              pagination={{ pageSize: 5 }}
              scroll={{ x: "max-content" }}
              columns={[
                { title: "ID", dataIndex: "id" },
                { title: "Location", dataIndex: "location_id" },
                { title: "Status", dataIndex: "status" },
                { title: "Lines", render: (_: unknown, row: CycleCount) => row.lines.length },
                {
                  title: "Actions",
                  render: (_: unknown, row: CycleCount) => (
                    <Space>
                      <Button size="small" disabled={row.status !== "OPEN"} onClick={() => void handleSubmitCycle(row)}>Submit</Button>
                      <Button size="small" disabled={row.status !== "SUBMITTED"} onClick={() => void handleApproveCycle(row)}>Approve</Button>
                    </Space>
                  ),
                },
              ]}
            />
          </Card>
        </Col>
      </Row>

      {reservations.length > 0 ? (
        <Card title="Recent Reservations">
          <Table
            rowKey="id"
            size="small"
            dataSource={reservations}
            pagination={false}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Reservation", dataIndex: "id" },
              { title: "Part", dataIndex: "part_id" },
              { title: "Qty", dataIndex: "quantity" },
              { title: "Status", dataIndex: "status" },
              { title: "Action", render: (_: unknown, row: Reservation) => <Button size="small" disabled={row.status !== "ACTIVE"} onClick={() => void handleReleaseReservation(row)}>Release</Button> },
            ]}
          />
        </Card>
      ) : null}
      <Modal
        title={dispatchingPo ? `Dispatch PO-${dispatchingPo.id}` : "Dispatch Purchase Order"}
        open={Boolean(dispatchingPo)}
        onCancel={() => {
          if (dispatchSubmitting) return;
          setDispatchingPo(null);
        }}
        onOk={() => void handleDispatchSubmit()}
        okButtonProps={{ loading: dispatchSubmitting }}
        okText="Send PO"
      >
        <Space direction="vertical" size={10} style={{ width: "100%" }}>
          <Input
            value={dispatchRecipient}
            onChange={(event) => setDispatchRecipient(event.target.value)}
            placeholder="supplier@example.com"
          />
          <Input.TextArea
            value={dispatchMessage}
            onChange={(event) => setDispatchMessage(event.target.value)}
            rows={3}
            placeholder="Optional dispatch note"
          />
        </Space>
      </Modal>
    </Space>
  );
}
