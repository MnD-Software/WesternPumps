import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Card, Form, Input, Select, Space, Spin, Switch, Table, Typography } from "antd";
import { useSearchParams } from "react-router-dom";
import { getApiErrorMessage } from "../api/error";
import { changeMyPassword, getMyPreferences, listMyZones, updateMyPreferences } from "../api/users";
import type { TechnicianZone } from "../api/types";
import { useAuth } from "../state/AuthContext";
import { allowedLandingPages } from "../utils/access";
import { validatePasswordPolicy } from "../utils/passwordPolicy";

export default function MySettingsPage() {
  const { user, refreshUser } = useAuth();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);

  const [defaultLandingPage, setDefaultLandingPage] = useState("/dashboard");
  const [denseMode, setDenseMode] = useState(false);
  const [animationsEnabled, setAnimationsEnabled] = useState(true);
  const [showEmailInHeader, setShowEmailInHeader] = useState(true);
  const [displayNameOverride, setDisplayNameOverride] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [zones, setZones] = useState<TechnicianZone[]>([]);

  const forcePasswordChange = searchParams.get("force_password_change") === "1" || Boolean(user?.must_change_password);
  const shouldShowZones = user?.role === "technician" || user?.role === "lead_technician";

  const landingOptions = useMemo(
    () =>
      allowedLandingPages(user?.role).map((path) => ({
        value: path,
        label: path.replace("/", "").replace("-", " ").replace(/\b\w/g, (c) => c.toUpperCase()) || "Dashboard",
      })),
    [user?.role]
  );

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const prefs = await getMyPreferences();
      setDefaultLandingPage(prefs.default_landing_page || "/dashboard");
      setDenseMode(Boolean(prefs.dense_mode));
      setAnimationsEnabled(Boolean(prefs.animations_enabled));
      setShowEmailInHeader(Boolean(prefs.show_email_in_header));
      setDisplayNameOverride(prefs.display_name_override || "");
      if (shouldShowZones) {
        setZones(await listMyZones());
      } else {
        setZones([]);
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load your settings"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await updateMyPreferences({
        default_landing_page: defaultLandingPage,
        dense_mode: denseMode,
        animations_enabled: animationsEnabled,
        show_email_in_header: showEmailInHeader,
        display_name_override: displayNameOverride.trim() || null,
      });
      setDefaultLandingPage(saved.default_landing_page);
      setDenseMode(Boolean(saved.dense_mode));
      setAnimationsEnabled(Boolean(saved.animations_enabled));
      setShowEmailInHeader(Boolean(saved.show_email_in_header));
      setDisplayNameOverride(saved.display_name_override || "");
      setSuccess("Your settings were saved.");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to save your settings"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordChange() {
    setPasswordError(null);
    setPasswordSuccess(null);
    const policyError = validatePasswordPolicy(newPassword);
    if (policyError) {
      setPasswordError(policyError);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("New password and confirmation do not match");
      return;
    }
    setPasswordSaving(true);
    try {
      await changeMyPassword({ current_password: currentPassword, new_password: newPassword });
      await refreshUser();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSuccess("Password updated successfully.");
    } catch (err: any) {
      setPasswordError(getApiErrorMessage(err, "Failed to update password"));
    } finally {
      setPasswordSaving(false);
    }
  }

  return (
    <div className="container page-shell">
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        My Settings
      </Typography.Title>
      <Card>
        {loading ? (
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">Loading your settings</Typography.Text>
          </Space>
        ) : (
          <Form layout="vertical" onFinish={handleSave}>
            <Typography.Paragraph type="secondary">
              Personalize your workspace. These settings apply only to your account.
            </Typography.Paragraph>
            {forcePasswordChange ? (
              <Alert
                style={{ marginBottom: 16 }}
                type="warning"
                showIcon
                message="You must change your password before continuing to the rest of the system."
              />
            ) : null}

            <Form.Item label="Default landing page">
              <Select value={defaultLandingPage} onChange={setDefaultLandingPage} options={landingOptions} />
            </Form.Item>

            <Form.Item label="Display name override">
              <Input
                value={displayNameOverride}
                onChange={(e) => setDisplayNameOverride(e.target.value)}
                placeholder="Leave blank to use your full name/email"
              />
            </Form.Item>

            <Space direction="vertical" size={10}>
              <Space>
                <Switch checked={denseMode} onChange={setDenseMode} />
                <Typography.Text>Use compact layout density</Typography.Text>
              </Space>
              <Space>
                <Switch checked={animationsEnabled} onChange={setAnimationsEnabled} />
                <Typography.Text>Enable interface animations</Typography.Text>
              </Space>
              <Space>
                <Switch checked={showEmailInHeader} onChange={setShowEmailInHeader} />
                <Typography.Text>Show email in header identity</Typography.Text>
              </Space>
            </Space>

            <Space style={{ marginTop: 16 }}>
              <Button type="primary" htmlType="submit" loading={saving}>
                Save
              </Button>
              <Button onClick={load} disabled={saving}>
                Reload
              </Button>
            </Space>
            {error ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} /> : null}
            {success ? <Alert style={{ marginTop: 12 }} type="success" showIcon message={success} /> : null}
          </Form>
        )}
      </Card>
      {shouldShowZones ? (
        <Card style={{ marginTop: 16 }} title="My Assigned Zones">
          <Typography.Paragraph type="secondary">
            These are the stations currently assigned to your account.
          </Typography.Paragraph>
          <Table<TechnicianZone>
            size="small"
            rowKey="id"
            pagination={{ pageSize: 10, showSizeChanger: false }}
            dataSource={zones}
            columns={[
              { title: "Order", dataIndex: "zone_order", key: "zone_order", width: 90 },
              { title: "Region", dataIndex: "region_label", key: "region_label" },
              { title: "Station", dataIndex: "station_name", key: "station_name" },
              { title: "Client", dataIndex: "client_code", key: "client_code", render: (v) => v || "-" },
            ]}
          />
        </Card>
      ) : null}
      <Card style={{ marginTop: 16 }} title="Change Password">
        <Form layout="vertical" onFinish={handlePasswordChange}>
          <Form.Item label="Current password" required>
            <Input.Password value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
          </Form.Item>
          <Form.Item label="New password" required>
            <Input.Password value={newPassword} onChange={(e) => setNewPassword(e.target.value)} minLength={10} />
          </Form.Item>
          <Form.Item label="Confirm new password" required>
            <Input.Password value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} minLength={10} />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={passwordSaving}>
              Update Password
            </Button>
          </Space>
          {passwordError ? <Alert style={{ marginTop: 12 }} type="error" showIcon message={passwordError} /> : null}
          {passwordSuccess ? <Alert style={{ marginTop: 12 }} type="success" showIcon message={passwordSuccess} /> : null}
        </Form>
      </Card>
    </div>
  );
}
