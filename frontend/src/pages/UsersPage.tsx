import React, { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Dropdown, Form, Input, Modal, Select, Space, Table, Typography, Upload } from "antd";
import type { MenuProps } from "antd";
import { MoreOutlined } from "@ant-design/icons";
import { forgotPassword } from "../api/auth";
import {
  adminResetUserPassword,
  createUserZone,
  deleteUserZone,
  createUser,
  deactivateUser,
  hardDeleteUser,
  importTechniciansZonesXlsx,
  listAllTechnicianZones,
  listUserZones,
  listUsers,
  reactivateUser,
  updateUserZone,
  updateUser
} from "../api/users";
import type { TechnicianZone, TechnicianZoneAdminRow, User, UserRole } from "../api/types";
import { getApiErrorMessage } from "../api/error";
import { useAuth } from "../state/AuthContext";
import { formatDateTime } from "../utils/datetime";
import { validatePasswordPolicy } from "../utils/passwordPolicy";

const ROLE_OPTIONS: Array<{ value: UserRole; label: string }> = [
  { value: "technician", label: "Technician" },
  { value: "lead_technician", label: "Lead Technician" },
  { value: "store_manager", label: "Store Manager" },
  { value: "manager", label: "Manager" },
  { value: "approver", label: "Approver" },
  { value: "finance", label: "Finance" },
  { value: "rider", label: "Rider" },
  { value: "driver", label: "Driver" },
  { value: "admin", label: "Admin" }
];

export default function UsersPage() {
  const { message } = AntdApp.useApp();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState<UserRole>("technician");
  const [mustChangePassword, setMustChangePassword] = useState(true);
  const [creating, setCreating] = useState(false);

  const [editing, setEditing] = useState<User | null>(null);
  const [editPhone, setEditPhone] = useState("");
  const [editName, setEditName] = useState("");
  const [editRole, setEditRole] = useState<UserRole>("technician");
  const [editMustChangePassword, setEditMustChangePassword] = useState(false);
  const [editingSave, setEditingSave] = useState(false);

  const [resettingUser, setResettingUser] = useState<User | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetSaving, setResetSaving] = useState(false);

  const [showCreateUserForm, setShowCreateUserForm] = useState(false);
  const [importingTechnicians, setImportingTechnicians] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);
  const [zonesUser, setZonesUser] = useState<User | null>(null);
  const [zones, setZones] = useState<TechnicianZone[]>([]);
  const [technicianZones, setTechnicianZones] = useState<TechnicianZoneAdminRow[]>([]);
  const [zonesLoading, setZonesLoading] = useState(false);
  const [zoneSaving, setZoneSaving] = useState(false);
  const [editingZone, setEditingZone] = useState<TechnicianZone | null>(null);
  const [zoneRegion, setZoneRegion] = useState("");
  const [zoneStation, setZoneStation] = useState("");
  const [zoneClient, setZoneClient] = useState("");
  const [zoneOrder, setZoneOrder] = useState(1);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, zonesRes] = await Promise.all([listUsers(), listAllTechnicianZones(true)]);
      setUsers(usersRes);
      setTechnicianZones(zonesRes);
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load users"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleCreate() {
    setError(null);
    if (!email.trim()) {
      setError("Email is required");
      return;
    }
    const createPasswordError = validatePasswordPolicy(password);
    if (createPasswordError) {
      setError(createPasswordError);
      return;
    }
    setCreating(true);
    try {
      await createUser({
        email: email.trim(),
        phone: phone.trim() ? phone.trim() : null,
        password,
        full_name: fullName.trim() ? fullName.trim() : null,
        role,
        must_change_password: mustChangePassword
      });
      setEmail("");
      setPhone("");
      setPassword("");
      setFullName("");
      setRole("technician");
      setMustChangePassword(true);
      message.success("User created");
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to create user"));
    } finally {
      setCreating(false);
    }
  }

  function openEdit(user: User) {
    setEditing(user);
    setEditPhone(user.phone ?? "");
    setEditName(user.full_name ?? "");
    setEditRole((user.role as UserRole) ?? "technician");
    setEditMustChangePassword(Boolean(user.must_change_password));
  }

  async function handleUpdate() {
    if (!editing) return;
    setEditingSave(true);
    try {
      await updateUser(editing.id, {
        phone: editPhone.trim() ? editPhone.trim() : null,
        full_name: editName.trim() ? editName.trim() : null,
        role: editRole,
        must_change_password: editMustChangePassword
      });
      message.success("User updated");
      setEditing(null);
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to update user"));
    } finally {
      setEditingSave(false);
    }
  }

  async function handleDeactivate(user: User) {
    try {
      await deactivateUser(user.id);
      message.success("User deactivated");
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to deactivate user"));
    }
  }

  async function handleReactivate(user: User) {
    try {
      await reactivateUser(user.id);
      message.success("User reactivated");
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to reactivate user"));
    }
  }

  async function handleHardDelete(user: User) {
    try {
      await hardDeleteUser(user.id);
      message.success("User deleted");
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to delete user"));
    }
  }

  function openResetPassword(user: User) {
    setError(null);
    setResettingUser(user);
    setResetPassword("");
  }

  async function handleResetPassword() {
    if (!resettingUser) return;
    const policyError = validatePasswordPolicy(resetPassword);
    if (policyError) {
      setError(policyError);
      return;
    }
    setResetSaving(true);
    try {
      await adminResetUserPassword(resettingUser.id, resetPassword);
      message.success("Password reset");
      setResettingUser(null);
      setResetPassword("");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to reset password"));
    } finally {
      setResetSaving(false);
    }
  }

  async function handleSendResetEmail(user: User) {
    try {
      await forgotPassword(user.email);
      message.success(`Reset email sent to ${user.email}`);
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to send reset email"));
    }
  }

  async function handleImportTechnicians(file: File) {
    setImportingTechnicians(true);
    setImportResult(null);
    setError(null);
    try {
      const summary = await importTechniciansZonesXlsx(file);
      setImportResult(
        `Imported technicians: ${summary.created_users} created, ${summary.updated_users} updated, ${summary.created_zones} zones loaded.`
      );
      if (summary.errors.length > 0) {
        setError(summary.errors.join(" | "));
      }
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to import technician workbook"));
    } finally {
      setImportingTechnicians(false);
    }
  }

  async function openZones(user: User) {
    setZonesUser(user);
    setZones([]);
    setZonesLoading(true);
    setEditingZone(null);
    try {
      const loaded = await listUserZones(user.id);
      setZones(loaded);
      setZoneOrder((loaded.length || 0) + 1);
      setZoneRegion("");
      setZoneStation("");
      setZoneClient("");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load technician zones"));
    } finally {
      setZonesLoading(false);
    }
  }

  function openZonesEditor(userId: number) {
    const selected = users.find((u) => u.id === userId);
    if (selected) void openZones(selected);
  }

  function startCreateZone() {
    setEditingZone(null);
    setZoneRegion("");
    setZoneStation("");
    setZoneClient("");
    setZoneOrder((zones.length || 0) + 1);
  }

  function startEditZone(zone: TechnicianZone) {
    setEditingZone(zone);
    setZoneRegion(zone.region_label || "");
    setZoneStation(zone.station_name || "");
    setZoneClient(zone.client_code || "");
    setZoneOrder(zone.zone_order || 1);
  }

  async function saveZone() {
    if (!zonesUser) return;
    if (!zoneRegion.trim() || !zoneStation.trim()) {
      setError("Region and station are required for zones");
      return;
    }
    setZoneSaving(true);
    try {
      if (editingZone) {
        await updateUserZone(zonesUser.id, editingZone.id, {
          region_label: zoneRegion.trim(),
          station_name: zoneStation.trim(),
          client_code: zoneClient.trim() || null,
          zone_order: zoneOrder,
        });
        message.success("Zone updated");
      } else {
        await createUserZone(zonesUser.id, {
          region_label: zoneRegion.trim(),
          station_name: zoneStation.trim(),
          client_code: zoneClient.trim() || null,
          zone_order: zoneOrder,
        });
        message.success("Zone added");
      }
      setZones(await listUserZones(zonesUser.id));
      await refresh();
      startCreateZone();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to save zone"));
    } finally {
      setZoneSaving(false);
    }
  }

  async function removeZone(zone: TechnicianZone) {
    if (!zonesUser) return;
    setZoneSaving(true);
    try {
      await deleteUserZone(zonesUser.id, zone.id);
      message.success("Zone deleted");
      setZones(await listUserZones(zonesUser.id));
      await refresh();
      if (editingZone?.id === zone.id) startCreateZone();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to delete zone"));
    } finally {
      setZoneSaving(false);
    }
  }

  const columns = useMemo(
    () => [
      { title: "ID", dataIndex: "id", key: "id" },
      { title: "Email", dataIndex: "email", key: "email" },
      { title: "Phone", dataIndex: "phone", key: "phone", render: (v: string | null) => v || "-" },
      { title: "Name", dataIndex: "full_name", key: "full_name", render: (v: string | null) => v || "-" },
      {
        title: "Role",
        dataIndex: "role",
        key: "role",
        render: (value: string) => (value === "staff" ? "technician" : value)
      },
      {
        title: "Password",
        key: "must_change_password",
        render: (_: unknown, row: User) =>
          row.must_change_password ? <Typography.Text type="warning">Must change</Typography.Text> : "Set"
      },
      {
        title: "Zones",
        key: "zone_count",
        render: (_: unknown, row: User) =>
          row.zone_count > 0 ? (
            <Button type="link" onClick={() => openZones(row)} style={{ padding: 0 }}>
              {row.zone_count} zone{row.zone_count === 1 ? "" : "s"}
            </Button>
          ) : (
            "0"
          )
      },
      { title: "Active", dataIndex: "is_active", key: "is_active", render: (value: boolean) => (value ? "Yes" : "No") },
      { title: "Created", dataIndex: "created_at", key: "created_at", render: (value: string) => formatDateTime(value) },
      { title: "Updated", dataIndex: "updated_at", key: "updated_at", render: (value: string) => formatDateTime(value) },
      {
        title: "Actions",
        key: "actions",
        width: 140,
        render: (_: unknown, row: User) => {
          const isSelf = row.id === currentUser?.id;
          const menuItems: MenuProps["items"] = [
            { key: "edit", label: "Edit", onClick: () => openEdit(row) },
            { key: "change_password", label: "Change password", onClick: () => openResetPassword(row) },
            { key: "forgot_password", label: "Send reset email", onClick: () => handleSendResetEmail(row) },
            row.is_active
              ? {
                  key: "deactivate",
                  label: "Deactivate",
                  danger: true,
                  disabled: isSelf,
                  onClick: () =>
                    Modal.confirm({
                      title: "Deactivate user?",
                      content: "This disables login for this user.",
                      okText: "Deactivate",
                      okButtonProps: { danger: true },
                      onOk: () => handleDeactivate(row)
                    })
                }
              : {
                  key: "reactivate",
                  label: "Reactivate",
                  disabled: isSelf,
                  onClick: () => handleReactivate(row)
                },
            {
              key: "delete",
              label: "Delete",
              danger: true,
              disabled: isSelf,
              onClick: () =>
                Modal.confirm({
                  title: "Permanently delete user?",
                  content: "This cannot be undone. Use deactivate if unsure.",
                  okText: "Delete",
                  okButtonProps: { danger: true },
                  onOk: () => handleHardDelete(row)
                })
            }
          ];
          return (
            <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
              <Button icon={<MoreOutlined />}>Manage</Button>
            </Dropdown>
          );
        }
      }
    ],
    [currentUser?.id]
  );

  return (
    <div className="container page-shell">
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        Users
      </Typography.Title>
      <Space>
        <Button onClick={() => setShowCreateUserForm((prev) => !prev)}>
          {showCreateUserForm ? "Hide Add User" : "Add New User"}
        </Button>
        <Upload
          showUploadList={false}
          beforeUpload={(file) => {
            handleImportTechnicians(file as File);
            return false;
          }}
        >
          <Button loading={importingTechnicians}>Import Technicians XLSX</Button>
        </Upload>
      </Space>
      {importResult ? <Typography.Text type="secondary">{importResult}</Typography.Text> : null}
      <div className="grid">
        {showCreateUserForm ? (
        <Card title="Create user">
          <Form layout="vertical" onFinish={handleCreate}>
            <Form.Item label="Email" required>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Form.Item>
            <Form.Item label="Phone number">
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+2547..." />
            </Form.Item>
            <Form.Item label="Password" required>
              <Input.Password value={password} onChange={(e) => setPassword(e.target.value)} minLength={10} />
            </Form.Item>
            <Form.Item label="Full name">
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Optional" />
            </Form.Item>
            <Form.Item label="Role" required>
              <Select<UserRole> value={role} onChange={(value) => setRole(value)} options={ROLE_OPTIONS} />
            </Form.Item>
            <Form.Item label="Require password change on first login">
              <Select value={mustChangePassword ? "yes" : "no"} onChange={(value) => setMustChangePassword(value === "yes")}>
                <Select.Option value="yes">Yes</Select.Option>
                <Select.Option value="no">No</Select.Option>
              </Select>
            </Form.Item>
            <Button type="primary" htmlType="submit" disabled={creating}>
              Create
            </Button>
          </Form>
          {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
          <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
            Admins can create, edit, deactivate, and delete users.
          </Typography.Text>
        </Card>
        ) : null}

        <Card
          title="User list"
          extra={
            <Button onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          }
          style={{ gridColumn: "1 / -1" }}
        >
          <Table
            rowKey="id"
            loading={loading}
            dataSource={users}
            columns={columns}
            pagination={{ pageSize: 12, showSizeChanger: true }}
            locale={{ emptyText: "No users yet." }}
          />
        </Card>
        <Card
          title="Technician Zones (All)"
          extra={
            <Button onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          }
          style={{ gridColumn: "1 / -1" }}
        >
          <Table
            rowKey="id"
            loading={loading}
            dataSource={technicianZones}
            pagination={{ pageSize: 15, showSizeChanger: true }}
            columns={[
              { title: "Technician", key: "tech_name", render: (_: unknown, row: TechnicianZoneAdminRow) => row.user_full_name || row.user_email },
              { title: "Email", dataIndex: "user_email", key: "user_email" },
              { title: "Role", dataIndex: "user_role", key: "user_role" },
              { title: "Status", key: "status", render: (_: unknown, row: TechnicianZoneAdminRow) => (row.user_is_active ? "Active" : "Inactive") },
              { title: "Order", dataIndex: "zone_order", key: "zone_order", width: 90 },
              { title: "Region", dataIndex: "region_label", key: "region_label" },
              { title: "Station", dataIndex: "station_name", key: "station_name" },
              { title: "Client", dataIndex: "client_code", key: "client_code", render: (value: string | null) => value || "-" },
              {
                title: "Actions",
                key: "actions",
                render: (_: unknown, row: TechnicianZoneAdminRow) => (
                  <Space>
                    <Button onClick={() => openZonesEditor(row.user_id)}>Edit</Button>
                    <Button
                      danger
                      onClick={() =>
                        Modal.confirm({
                          title: "Delete zone?",
                          content: "This deletes this zone assignment for the technician.",
                          okText: "Delete",
                          okButtonProps: { danger: true },
                          onOk: async () => {
                            try {
                              await deleteUserZone(row.user_id, row.id);
                              message.success("Zone deleted");
                              await refresh();
                              if (zonesUser?.id === row.user_id) setZones(await listUserZones(row.user_id));
                            } catch (err: any) {
                              setError(getApiErrorMessage(err, "Failed to delete zone"));
                            }
                          }
                        })
                      }
                    >
                      Delete
                    </Button>
                  </Space>
                )
              }
            ]}
            locale={{ emptyText: "No technician zones available." }}
          />
        </Card>
      </div>

      <Modal
        title="Edit user profile"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={handleUpdate}
        okText="Save"
        confirmLoading={editingSave}
      >
        <Form layout="vertical">
          <Form.Item label="Phone number">
            <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+2547..." />
          </Form.Item>
          <Form.Item label="Full name">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} />
          </Form.Item>
          <Form.Item label="Role" required>
            <Select<UserRole> value={editRole} onChange={(value) => setEditRole(value)} options={ROLE_OPTIONS} />
          </Form.Item>
          <Form.Item label="Require password change on next login">
            <Select value={editMustChangePassword ? "yes" : "no"} onChange={(value) => setEditMustChangePassword(value === "yes")}>
              <Select.Option value="yes">Yes</Select.Option>
              <Select.Option value="no">No</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={resettingUser ? `Change password: ${resettingUser.email}` : "Change user password"}
        open={!!resettingUser}
        onCancel={() => setResettingUser(null)}
        onOk={handleResetPassword}
        okText="Reset"
        confirmLoading={resetSaving}
      >
        <Form layout="vertical">
          <Form.Item label="New password" required>
            <Input.Password value={resetPassword} onChange={(e) => setResetPassword(e.target.value)} minLength={10} />
          </Form.Item>
          <Typography.Text type="secondary">
            Use 10+ chars with uppercase, lowercase, number, and symbol.
          </Typography.Text>
        </Form>
      </Modal>

      <Modal
        title={zonesUser ? `Technician zones: ${zonesUser.full_name || zonesUser.email}` : "Technician zones"}
        open={!!zonesUser}
        onCancel={() => {
          setZonesUser(null);
          setEditingZone(null);
        }}
        footer={null}
        width={720}
      >
        <Card
          size="small"
          title={editingZone ? "Edit zone" : "Add zone"}
          style={{ marginBottom: 12 }}
          extra={
            editingZone ? (
              <Button onClick={startCreateZone}>
                New
              </Button>
            ) : null
          }
        >
          <Space wrap>
            <Input
              placeholder="Region"
              value={zoneRegion}
              onChange={(e) => setZoneRegion(e.target.value)}
              style={{ minWidth: 160 }}
            />
            <Input
              placeholder="Station"
              value={zoneStation}
              onChange={(e) => setZoneStation(e.target.value)}
              style={{ minWidth: 180 }}
            />
            <Input
              placeholder="Client code"
              value={zoneClient}
              onChange={(e) => setZoneClient(e.target.value)}
              style={{ minWidth: 130 }}
            />
            <Input
              type="number"
              min={1}
              value={zoneOrder}
              onChange={(e) => setZoneOrder(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: 90 }}
            />
            <Button type="primary" loading={zoneSaving} onClick={saveZone}>
              {editingZone ? "Update" : "Add"}
            </Button>
          </Space>
        </Card>
        <Table
          rowKey="id"
          loading={zonesLoading}
          dataSource={zones}
          pagination={{ pageSize: 10 }}
          columns={[
            { title: "Order", dataIndex: "zone_order", key: "zone_order", width: 90 },
            { title: "Region", dataIndex: "region_label", key: "region_label" },
            { title: "Station", dataIndex: "station_name", key: "station_name" },
            { title: "Client", dataIndex: "client_code", key: "client_code", render: (value: string | null) => value || "-" },
            {
              title: "Actions",
              key: "actions",
              render: (_: unknown, zone: TechnicianZone) => (
                <Space>
                  <Button onClick={() => startEditZone(zone)}>Edit</Button>
                  <Button danger onClick={() => void removeZone(zone)} loading={zoneSaving}>
                    Delete
                  </Button>
                </Space>
              )
            },
          ]}
        />
      </Modal>
    </div>
  );
}
