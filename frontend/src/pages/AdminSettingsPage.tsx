import React, { useEffect, useRef, useState } from "react";
import { Alert, Button, Card, Divider, Form, Input, InputNumber, Modal, Segmented, Select, Space, Spin, Switch, Tag, Typography } from "antd";
import { getApiErrorMessage } from "../api/error";
import { getAppSettings, testEmailSettings, updateAppSettings, type AppSettings } from "../api/settings";
import { purgeAllItems } from "../api/items";
import { useAuth } from "../state/AuthContext";
import {
  getAccountingIntegration,
  getErpIntegration,
  getFinanceIntegration,
  testAccountingIntegration,
  testErpIntegration,
  testFinanceIntegration,
  updateAccountingIntegration,
  updateErpIntegration,
  updateFinanceIntegration,
  type ExternalIntegration,
} from "../api/integrations";
import { adminResetPasswordByRole } from "../api/users";
import { getComplianceStatus, getOutboxHealth, getSystemAbout, retryDeadOutbox, type ComplianceStatus, type OutboxHealth } from "../api/platform";
import type { SystemAbout, UserRole } from "../api/types";

export default function AdminSettingsPage() {
  const { user } = useAuth();
  const role = (user?.role || "technician").toLowerCase();
  const canEditThresholds = role === "manager" || role === "finance";
  const canManageIntegrations = role === "admin" || role === "manager";
  const canRetryOutbox = role === "admin";
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [managerThreshold, setManagerThreshold] = useState("5000");
  const [adminThreshold, setAdminThreshold] = useState("20000");
  const [individualApprovalRole, setIndividualApprovalRole] = useState<"none" | "manager" | "admin">("none");
  const [lowStockLimit, setLowStockLimit] = useState("200");
  const [notificationEmailEnabled, setNotificationEmailEnabled] = useState(false);
  const [notificationSmsEnabled, setNotificationSmsEnabled] = useState(false);
  const [notificationRecipients, setNotificationRecipients] = useState("");
  const [quarantineLocationId, setQuarantineLocationId] = useState("");
  const [brandingLogoUrl, setBrandingLogoUrl] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUsername, setSmtpUsername] = useState("");
  const [smtpPassword, setSmtpPassword] = useState("");
  const [smtpFromEmail, setSmtpFromEmail] = useState("");
  const [smtpUseTls, setSmtpUseTls] = useState(true);
  const [testRecipient, setTestRecipient] = useState("");
  const [testingEmail, setTestingEmail] = useState(false);
  const [purgeToken, setPurgeToken] = useState("");
  const [purging, setPurging] = useState(false);
  const [purgeResult, setPurgeResult] = useState<string | null>(null);
  const logoUploadRef = useRef<HTMLInputElement | null>(null);
  const [activeTenantId, setActiveTenantId] = useState(localStorage.getItem("active_tenant_id") || "1");
  const [compliance, setCompliance] = useState<ComplianceStatus | null>(null);
  const [outboxHealth, setOutboxHealth] = useState<OutboxHealth | null>(null);
  const [platformLoading, setPlatformLoading] = useState(false);
  const [systemAbout, setSystemAbout] = useState<SystemAbout | null>(null);
  const [integrationScope, setIntegrationScope] = useState<"finance" | "erp" | "accounting">("finance");
  const [financeIntegration, setFinanceIntegration] = useState<ExternalIntegration>({ api_base: "", webhook_url: "", enabled: false });
  const [erpIntegration, setErpIntegration] = useState<ExternalIntegration>({ api_base: "", webhook_url: "", enabled: false });
  const [accountingIntegration, setAccountingIntegration] = useState<ExternalIntegration>({ api_base: "", webhook_url: "", enabled: false });
  const [financeSecret, setFinanceSecret] = useState("");
  const [erpSecret, setErpSecret] = useState("");
  const [accountingSecret, setAccountingSecret] = useState("");
  const [integrationSaving, setIntegrationSaving] = useState(false);
  const [integrationTesting, setIntegrationTesting] = useState(false);
  const [bulkResetRole, setBulkResetRole] = useState<UserRole>("technician");
  const [bulkResetPassword, setBulkResetPassword] = useState("Westernpumps@26");
  const [bulkResetActiveOnly, setBulkResetActiveOnly] = useState(true);
  const [bulkResetLoading, setBulkResetLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const s = await getAppSettings();
      setManagerThreshold(String(s.approval_threshold_manager));
      setAdminThreshold(String(s.approval_threshold_admin));
      setIndividualApprovalRole(s.approval_individual_role ?? "none");
      setLowStockLimit(String(s.low_stock_default_limit));
      setNotificationEmailEnabled(Boolean(s.notification_email_enabled));
      setNotificationSmsEnabled(Boolean(s.notification_sms_enabled));
      setNotificationRecipients(s.notification_recipients || "");
      setQuarantineLocationId(s.faulty_quarantine_location_id ? String(s.faulty_quarantine_location_id) : "");
      setBrandingLogoUrl(s.branding_logo_url || "");
      setSmtpHost(s.smtp_host || "");
      setSmtpPort(String(s.smtp_port ?? 587));
      setSmtpUsername(s.smtp_username || "");
      setSmtpPassword(s.smtp_password || "");
      setSmtpFromEmail(s.smtp_from_email || "");
      setSmtpUseTls(Boolean(s.smtp_use_tls ?? true));
      setTestRecipient(user?.email || "");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load settings"));
    } finally {
      setLoading(false);
    }
  }

  async function loadPlatformSignals() {
    setPlatformLoading(true);
    try {
      const [complianceRes, outboxRes, aboutRes] = await Promise.all([getComplianceStatus(), getOutboxHealth(), getSystemAbout()]);
      setCompliance(complianceRes);
      setOutboxHealth(outboxRes);
      setSystemAbout(aboutRes);
    } catch {
      // non-blocking
    } finally {
      setPlatformLoading(false);
    }
  }

  async function loadIntegrations() {
    try {
      const [financeRes, erpRes, accountingRes] = await Promise.all([
        getFinanceIntegration(),
        getErpIntegration(),
        getAccountingIntegration(),
      ]);
      setFinanceIntegration(financeRes);
      setErpIntegration(erpRes);
      setAccountingIntegration(accountingRes);
    } catch {
      // non-blocking
    }
  }

  useEffect(() => {
    load();
    loadPlatformSignals();
    loadIntegrations();
  }, []);

  function isValidEmail(value: string) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
  }

  function isGmailHost(value: string) {
    return value.trim().toLowerCase() === "smtp.gmail.com";
  }

  function normalizeEmailError(rawDetail: string) {
    const detail = (rawDetail || "").toLowerCase();
    if (detail.includes("530") || detail.includes("authentication required")) {
      return "Authentication required. For Gmail, use your full Gmail in SMTP Username and a Google App Password (not your normal Gmail password).";
    }
    if (detail.includes("535") || detail.includes("username and password not accepted")) {
      return "Gmail rejected the login. Re-check SMTP Username and generate a fresh App Password.";
    }
    if (detail.includes("5.7.1")) {
      return "Email provider blocked this sign-in. For Gmail, enable 2-Step Verification and use an App Password.";
    }
    if (detail.includes("missing_smtp_config")) {
      return "SMTP setup is incomplete. Fill host, username, from email, and password.";
    }
    return rawDetail;
  }

  function validateEmailSetup() {
    if (!smtpHost.trim()) return "SMTP Host is required.";
    if (!smtpUsername.trim()) return "SMTP Username is required.";
    if (!smtpFromEmail.trim()) return "Sender Email (From) is required.";
    if (!smtpPassword.trim()) return "SMTP Password/App Password is required.";
    if (!isValidEmail(smtpFromEmail)) return "Sender Email (From) must be a valid email address.";
    if (testRecipient.trim() && !isValidEmail(testRecipient)) return "Test Recipient Email is invalid.";
    return null;
  }

  function applyGmailPreset() {
    const login = smtpUsername.trim() || smtpFromEmail.trim();
    setSmtpHost("smtp.gmail.com");
    setSmtpPort("587");
    setSmtpUseTls(true);
    if (login) {
      setSmtpUsername(login);
      setSmtpFromEmail(login);
    }
  }

  function useMyAccountEmail() {
    const email = (user?.email || "").trim();
    if (!email) return;
    setSmtpUsername(email);
    setSmtpFromEmail(email);
    setTestRecipient(email);
  }

  async function handleSave() {
    if (notificationEmailEnabled) {
      const validationError = validateEmailSetup();
      if (validationError) {
        setError(validationError);
        return;
      }
    }
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload: Partial<AppSettings> = {
        low_stock_default_limit: Number(lowStockLimit),
        notification_email_enabled: notificationEmailEnabled,
        notification_sms_enabled: notificationSmsEnabled,
        notification_recipients: notificationRecipients,
        faulty_quarantine_location_id: quarantineLocationId.trim() ? Number(quarantineLocationId) : null,
        branding_logo_url: brandingLogoUrl.trim(),
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort || 587),
        smtp_username: smtpUsername.trim(),
        smtp_password: smtpPassword,
        smtp_from_email: smtpFromEmail.trim(),
        smtp_use_tls: smtpUseTls
      };
      if (canEditThresholds) {
        payload.approval_threshold_manager = Number(managerThreshold);
        payload.approval_threshold_admin = Number(adminThreshold);
        payload.approval_individual_role = individualApprovalRole;
      }
      await updateAppSettings(payload);
      setSuccess("Settings updated successfully.");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to update settings"));
    } finally {
      setSaving(false);
    }
  }

  async function handlePurgeAllProducts() {
    setPurging(true);
    setError(null);
    setSuccess(null);
    setPurgeResult(null);
    try {
      const res = await purgeAllItems({
        confirmation: "DELETE ALL PRODUCTS",
        token: purgeToken.trim() || "dev-local",
      });
      setPurgeResult(
        `Purged products: ${res.parts_deleted}, instances: ${res.instances_deleted}, transactions: ${res.transactions_deleted}, request lines: ${res.request_lines_deleted}.`
      );
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to purge products"));
    } finally {
      setPurging(false);
    }
  }

  async function handleLogoUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file for the logo.");
      event.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setBrandingLogoUrl(result);
      setError(null);
    };
    reader.onerror = () => {
      setError("Failed to read logo file.");
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  }

  async function handleSendTestEmail() {
    const validationError = validateEmailSetup();
    if (validationError) {
      setError(validationError);
      return;
    }
    setTestingEmail(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await testEmailSettings({ recipient: testRecipient.trim() || undefined });
      if (!res.ok) {
        setError(`Email test failed: ${normalizeEmailError(res.detail)}`);
      } else {
        setSuccess(`Test email sent to ${res.recipient}.`);
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to send test email"));
    } finally {
      setTestingEmail(false);
    }
  }

  function handleSaveTenantContext() {
    const normalized = activeTenantId.trim() || "1";
    localStorage.setItem("active_tenant_id", normalized);
    setSuccess(`Tenant context set to ${normalized}.`);
  }

  async function handleRetryDeadLetters() {
    setPlatformLoading(true);
    try {
      if (!canRetryOutbox) {
        setError("Access denied: only Admin can retry dead-letter outbox events.");
        return;
      }
      const res = await retryDeadOutbox(200);
      setSuccess(`Retried ${res.retried} dead-letter event(s).`);
      await loadPlatformSignals();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to retry dead-letter events"));
    } finally {
      setPlatformLoading(false);
    }
  }

  async function handleSaveIntegration() {
    setIntegrationSaving(true);
    setError(null);
    setSuccess(null);
    try {
      if (!canManageIntegrations) {
        setError("Access denied: only Admin/Manager can update integrations.");
        return;
      }
      if (integrationScope === "finance") {
        const res = await updateFinanceIntegration({
          ...financeIntegration,
          webhook_secret: financeSecret,
        });
        setFinanceIntegration(res);
      } else if (integrationScope === "erp") {
        const res = await updateErpIntegration({
          ...erpIntegration,
          webhook_secret: erpSecret,
        });
        setErpIntegration(res);
      } else {
        const res = await updateAccountingIntegration({
          ...accountingIntegration,
          webhook_secret: accountingSecret,
        });
        setAccountingIntegration(res);
      }
      setSuccess("Integration settings saved.");
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to save integration"));
    } finally {
      setIntegrationSaving(false);
    }
  }

  async function handleTestIntegration() {
    setIntegrationTesting(true);
    setError(null);
    setSuccess(null);
    try {
      const res =
        integrationScope === "finance"
          ? await testFinanceIntegration()
          : integrationScope === "erp"
          ? await testErpIntegration()
          : await testAccountingIntegration();
      if (!res.ok) {
        setError(`Integration test failed: ${res.detail}`);
      } else {
        setSuccess("Integration test webhook sent successfully.");
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to run integration test"));
    } finally {
      setIntegrationTesting(false);
    }
  }

  async function handleBulkRolePasswordReset() {
    setBulkResetLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await adminResetPasswordByRole({
        role: bulkResetRole,
        new_password: bulkResetPassword,
        must_change_password: true,
        active_only: bulkResetActiveOnly,
      });
      setSuccess(`Password reset for role '${res.role}' completed. Updated ${res.users_updated} user(s).`);
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to reset passwords by role"));
    } finally {
      setBulkResetLoading(false);
    }
  }

  const selectedIntegration =
    integrationScope === "finance"
      ? financeIntegration
      : integrationScope === "erp"
      ? erpIntegration
      : accountingIntegration;

  return (
    <div className="container page-shell">
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        Admin Settings
      </Typography.Title>
      <Card>
        {loading ? (
          <Space>
            <Spin size="small" />
            <Typography.Text type="secondary">Loading settings</Typography.Text>
          </Space>
        ) : (
          <Form layout="vertical" onFinish={handleSave}>
            <Typography.Paragraph type="secondary">
              Configure approval policies, notifications, integrations, and reporting defaults for your role scope.
            </Typography.Paragraph>
            {!canEditThresholds ? (
              <Alert
                type="info"
                showIcon
                message="Threshold controls are managed by Manager/Finance roles."
                style={{ marginBottom: 12 }}
              />
            ) : null}

            <div className="reports-filter-grid">
              <Form.Item label="Manager Approval Threshold">
                <InputNumber
                  value={Number(managerThreshold)}
                  onChange={(value) => setManagerThreshold(String(value ?? 0))}
                  style={{ width: "100%" }}
                  disabled={!canEditThresholds}
                />
              </Form.Item>
              <Form.Item label="Admin Approval Threshold">
                <InputNumber
                  value={Number(adminThreshold)}
                  onChange={(value) => setAdminThreshold(String(value ?? 0))}
                  style={{ width: "100%" }}
                  disabled={!canEditThresholds}
                />
              </Form.Item>
              <Form.Item label="Low Stock Report Default Limit">
                <InputNumber
                  value={Number(lowStockLimit)}
                  onChange={(value) => setLowStockLimit(String(value ?? 0))}
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <Form.Item label="Individual Item Approval Rule">
                <Select
                  value={individualApprovalRole}
                  onChange={(value) => setIndividualApprovalRole(value)}
                  style={{ width: "100%" }}
                  disabled={!canEditThresholds}
                >
                  <Select.Option value="none">Use Threshold Only</Select.Option>
                  <Select.Option value="manager">Require Manager</Select.Option>
                  <Select.Option value="admin">Require Admin</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="Faulty Quarantine Location ID">
                <InputNumber
                  value={quarantineLocationId.trim() ? Number(quarantineLocationId) : undefined}
                  onChange={(value) => setQuarantineLocationId(value == null ? "" : String(value))}
                  style={{ width: "100%" }}
                />
              </Form.Item>
            </div>

            <Form.Item label="Notification Recipients">
              <Input.TextArea
                value={notificationRecipients}
                onChange={(e) => setNotificationRecipients(e.target.value)}
                rows={3}
                placeholder="Comma-separated emails or phone numbers"
              />
            </Form.Item>
            <Form.Item label="System Logo (URL or uploaded image)">
              <Space direction="vertical" style={{ width: "100%" }} size={10}>
                <Input
                  value={brandingLogoUrl}
                  onChange={(e) => setBrandingLogoUrl(e.target.value)}
                  placeholder="https://... or leave blank to use default"
                />
                <Space>
                  <Button onClick={() => logoUploadRef.current?.click()}>Upload logo image</Button>
                  <Button onClick={() => setBrandingLogoUrl("")}>Use default logo</Button>
                </Space>
                <input
                  ref={logoUploadRef}
                  type="file"
                  accept="image/*"
                  style={{ display: "none" }}
                  onChange={handleLogoUpload}
                />
                {brandingLogoUrl ? (
                  <img
                    src={brandingLogoUrl}
                    alt="Configured logo preview"
                    loading="lazy"
                    decoding="async"
                    style={{ width: 80, height: 80, objectFit: "contain", borderRadius: 10, border: "1px solid rgba(15,23,42,0.15)", background: "white", padding: 8 }}
                  />
                ) : null}
              </Space>
            </Form.Item>
            <Typography.Title level={5} style={{ marginBottom: 0 }}>
              Email Delivery Settings
            </Typography.Title>
            <Typography.Text type="secondary">
              Quick test with Gmail: set your Gmail address and a Gmail App Password, then click Save and Send Test Email.
            </Typography.Text>
            <Space style={{ marginTop: 10, marginBottom: 6 }} wrap>
              <Button onClick={applyGmailPreset}>Use Gmail Preset</Button>
              <Button onClick={useMyAccountEmail}>Use My Account Email</Button>
            </Space>
            {isGmailHost(smtpHost) ? (
              <Alert
                type="info"
                showIcon
                style={{ marginBottom: 10 }}
                message="Gmail quick checklist"
                description="1) Enable 2-Step Verification on Gmail. 2) Create a Google App Password. 3) Put the 16-character App Password in SMTP Password. 4) Keep TLS enabled."
              />
            ) : null}
            <div className="reports-filter-grid" style={{ marginTop: 10 }}>
              <Form.Item label="SMTP Host">
                <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} placeholder="smtp.yourprovider.com" />
              </Form.Item>
              <Form.Item label="SMTP Port">
                <InputNumber
                  value={Number(smtpPort || 587)}
                  onChange={(value) => setSmtpPort(String(value ?? 587))}
                  style={{ width: "100%" }}
                />
              </Form.Item>
              <Form.Item label="SMTP Username">
                <Input value={smtpUsername} onChange={(e) => setSmtpUsername(e.target.value)} placeholder="yourgmail@gmail.com" />
              </Form.Item>
              <Form.Item label="Sender Email (From)">
                <Input value={smtpFromEmail} onChange={(e) => setSmtpFromEmail(e.target.value)} placeholder="yourgmail@gmail.com" />
              </Form.Item>
            </div>
            <Form.Item label="SMTP Password / App Password">
              <Input.Password value={smtpPassword} onChange={(e) => setSmtpPassword(e.target.value)} />
            </Form.Item>
            <Form.Item label="Test Recipient Email">
              <Input
                type="email"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                placeholder={user?.email || "recipient@example.com"}
              />
            </Form.Item>

            <Space direction="vertical" size={8}>
              <Space>
                <Switch checked={notificationEmailEnabled} onChange={setNotificationEmailEnabled} />
                <Typography.Text>Enable Email Notifications</Typography.Text>
              </Space>
              <Space>
                <Switch checked={smtpUseTls} onChange={setSmtpUseTls} />
                <Typography.Text>Use TLS for SMTP</Typography.Text>
              </Space>
              <Space>
                <Switch checked={notificationSmsEnabled} onChange={setNotificationSmsEnabled} />
                <Typography.Text>Enable SMS Notifications</Typography.Text>
              </Space>
            </Space>

            <Space style={{ marginTop: 14 }}>
              <Button type="primary" htmlType="submit" loading={saving}>
                Save Settings
              </Button>
              <Button onClick={handleSendTestEmail} loading={testingEmail} disabled={saving}>
                Send Test Email
              </Button>
              <Button onClick={load} disabled={saving}>
                Reload
              </Button>
            </Space>

            {error ? (
              <Alert style={{ marginTop: 12 }} type="error" showIcon message={error} />
            ) : null}
            {success ? (
              <Alert style={{ marginTop: 12 }} type="success" showIcon message={success} />
            ) : null}
          </Form>
        )}
      </Card>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          System About
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Quick reference for platform capabilities, module coverage, and controls.
        </Typography.Paragraph>
        {systemAbout ? (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            <div className="reports-filter-grid">
              <div>
                <Typography.Text type="secondary">System</Typography.Text>
                <Typography.Paragraph strong style={{ marginBottom: 0 }}>
                  {systemAbout.system_name}
                </Typography.Paragraph>
              </div>
              <div>
                <Typography.Text type="secondary">Database</Typography.Text>
                <Typography.Paragraph strong style={{ marginBottom: 0 }}>
                  {systemAbout.database_engine.toUpperCase()}
                </Typography.Paragraph>
              </div>
              <div>
                <Typography.Text type="secondary">Auth Mode</Typography.Text>
                <Typography.Paragraph strong style={{ marginBottom: 0 }}>
                  {systemAbout.auth_mode}
                </Typography.Paragraph>
              </div>
              <div>
                <Typography.Text type="secondary">Deployment</Typography.Text>
                <Typography.Paragraph strong style={{ marginBottom: 0 }}>
                  {systemAbout.deployment_mode}
                </Typography.Paragraph>
              </div>
            </div>
            <div>
              <Typography.Text strong>Supported Roles</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap>
                  {systemAbout.roles_supported.map((roleItem) => (
                    <Tag key={roleItem}>{roleItem}</Tag>
                  ))}
                </Space>
              </div>
            </div>
            <div>
              <Typography.Text strong>Modules</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 6, marginBottom: 0 }}>
                {systemAbout.modules.join(" | ")}
              </Typography.Paragraph>
            </div>
            <div>
              <Typography.Text strong>Key Features</Typography.Text>
              <Typography.Paragraph style={{ marginTop: 6, marginBottom: 0 }}>
                {systemAbout.key_features.join(" | ")}
              </Typography.Paragraph>
            </div>
            <div>
              <Typography.Text strong>Integrations & Controls</Typography.Text>
              <div style={{ marginTop: 8 }}>
                <Space wrap>
                  {Object.entries(systemAbout.integrations).map(([key, enabled]) => (
                    <Tag key={`integration-${key}`} color={enabled ? "green" : "default"}>
                      {key}:{enabled ? "ON" : "OFF"}
                    </Tag>
                  ))}
                  {Object.entries(systemAbout.controls).map(([key, enabled]) => (
                    <Tag key={`control-${key}`} color={enabled ? "green" : "orange"}>
                      {key}:{enabled ? "ON" : "OFF"}
                    </Tag>
                  ))}
                </Space>
              </div>
            </div>
          </Space>
        ) : (
          <Typography.Text type="secondary">No system profile available.</Typography.Text>
        )}
      </Card>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Tenant & Compliance
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Set active tenant context for admin operations and monitor platform hardening status.
        </Typography.Paragraph>
        <Form layout="vertical">
          <div className="reports-filter-grid">
            <Form.Item label="Active Tenant ID">
              <Input value={activeTenantId} onChange={(e) => setActiveTenantId(e.target.value)} placeholder="1" />
            </Form.Item>
            <Form.Item label="Tenant Context">
              <Space style={{ marginTop: 6 }}>
                <Button type="primary" onClick={handleSaveTenantContext}>
                  Save Tenant Context
                </Button>
                <Button onClick={loadPlatformSignals} loading={platformLoading}>
                  Refresh Platform Status
                </Button>
              </Space>
            </Form.Item>
          </div>
        </Form>
        <Divider />
        {platformLoading && !compliance ? <Spin size="small" /> : null}
        {compliance ? (
          <Space direction="vertical" style={{ width: "100%" }} size={10}>
            <Space wrap>
              <Tag color={compliance.status === "ok" ? "green" : "orange"}>
                Compliance {compliance.status.toUpperCase()}
              </Tag>
              <Tag color={compliance.https_enforced ? "green" : "default"}>HTTPS {compliance.https_enforced ? "ON" : "OFF"}</Tag>
              <Tag color={compliance.oidc_enabled ? (compliance.oidc_ok ? "green" : "red") : "default"}>
                OIDC {compliance.oidc_enabled ? (compliance.oidc_ok ? "OK" : "DEGRADED") : "DISABLED"}
              </Tag>
              <Tag color={compliance.security_headers_enabled ? "green" : "orange"}>
                Security Headers {compliance.security_headers_enabled ? "ON" : "OFF"}
              </Tag>
            </Space>
            <Typography.Text type="secondary">
              Generated at: {new Date(compliance.generated_at).toLocaleString()}
            </Typography.Text>
          </Space>
        ) : null}
        {outboxHealth ? (
          <Space direction="vertical" style={{ width: "100%", marginTop: 12 }} size={8}>
            <Typography.Text strong>Outbox Pipeline</Typography.Text>
            <Space wrap>
              <Tag>Pending {outboxHealth.pending}</Tag>
              <Tag color="processing">Processing {outboxHealth.processing}</Tag>
              <Tag color={outboxHealth.failed > 0 ? "orange" : "default"}>Failed {outboxHealth.failed}</Tag>
              <Tag color={outboxHealth.dead > 0 ? "red" : "default"}>Dead {outboxHealth.dead}</Tag>
              <Tag color="blue">Done 24h {outboxHealth.done_last_24h}</Tag>
            </Space>
            <Button
              danger={outboxHealth.dead > 0}
              onClick={handleRetryDeadLetters}
              loading={platformLoading}
              disabled={!canRetryOutbox}
            >
              Retry Dead Letters
            </Button>
          </Space>
        ) : null}
      </Card>
      <Card>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          External Integrations
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Configure webhook/API endpoints for Finance, ERP, and Accounting integration workflows.
        </Typography.Paragraph>
        <Segmented
          options={[
            { label: "Finance", value: "finance" },
            { label: "ERP", value: "erp" },
            { label: "Accounting", value: "accounting" },
          ]}
          value={integrationScope}
          onChange={(value) => setIntegrationScope(value as "finance" | "erp" | "accounting")}
          block
        />
        <Form layout="vertical" style={{ marginTop: 14 }}>
          <div className="reports-filter-grid">
            <Form.Item label="API Base URL">
              <Input
                value={selectedIntegration.api_base}
                disabled={!canManageIntegrations}
                onChange={(e) => {
                  const value = e.target.value;
                  if (integrationScope === "finance") setFinanceIntegration((prev) => ({ ...prev, api_base: value }));
                  if (integrationScope === "erp") setErpIntegration((prev) => ({ ...prev, api_base: value }));
                  if (integrationScope === "accounting") setAccountingIntegration((prev) => ({ ...prev, api_base: value }));
                }}
                placeholder="https://api.company-system.com"
              />
            </Form.Item>
            <Form.Item label="Webhook URL">
              <Input
                value={selectedIntegration.webhook_url}
                disabled={!canManageIntegrations}
                onChange={(e) => {
                  const value = e.target.value;
                  if (integrationScope === "finance") setFinanceIntegration((prev) => ({ ...prev, webhook_url: value }));
                  if (integrationScope === "erp") setErpIntegration((prev) => ({ ...prev, webhook_url: value }));
                  if (integrationScope === "accounting") setAccountingIntegration((prev) => ({ ...prev, webhook_url: value }));
                }}
                placeholder="https://hooks.company-system.com/westernpumps"
              />
            </Form.Item>
            <Form.Item label="Webhook Secret">
              <Input.Password
                value={integrationScope === "finance" ? financeSecret : integrationScope === "erp" ? erpSecret : accountingSecret}
                disabled={!canManageIntegrations}
                onChange={(e) => {
                  const value = e.target.value;
                  if (integrationScope === "finance") setFinanceSecret(value);
                  if (integrationScope === "erp") setErpSecret(value);
                  if (integrationScope === "accounting") setAccountingSecret(value);
                }}
                placeholder="Optional HMAC secret"
              />
            </Form.Item>
            <Form.Item label="Enabled">
              <Switch
                checked={selectedIntegration.enabled}
                disabled={!canManageIntegrations}
                onChange={(checked) => {
                  if (integrationScope === "finance") setFinanceIntegration((prev) => ({ ...prev, enabled: checked }));
                  if (integrationScope === "erp") setErpIntegration((prev) => ({ ...prev, enabled: checked }));
                  if (integrationScope === "accounting") setAccountingIntegration((prev) => ({ ...prev, enabled: checked }));
                }}
              />
            </Form.Item>
          </div>
          <Space>
            <Button type="primary" loading={integrationSaving} onClick={handleSaveIntegration} disabled={!canManageIntegrations}>
              Save Integration
            </Button>
            <Button onClick={handleTestIntegration} loading={integrationTesting}>
              Test Connection
            </Button>
          </Space>
        </Form>
      </Card>
      <Card style={{ marginTop: 16 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Password Operations
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Reset passwords in bulk for one role and force password change on next login.
        </Typography.Paragraph>
        <Form layout="vertical">
          <div className="reports-filter-grid">
            <Form.Item label="Target Role">
              <Select<UserRole> value={bulkResetRole} onChange={setBulkResetRole}>
                <Select.Option value="technician">technician</Select.Option>
                <Select.Option value="lead_technician">lead_technician</Select.Option>
                <Select.Option value="staff">staff</Select.Option>
                <Select.Option value="store_manager">store_manager</Select.Option>
                <Select.Option value="manager">manager</Select.Option>
                <Select.Option value="approver">approver</Select.Option>
                <Select.Option value="finance">finance</Select.Option>
                <Select.Option value="rider">rider</Select.Option>
                <Select.Option value="driver">driver</Select.Option>
              </Select>
            </Form.Item>
            <Form.Item label="New Password">
              <Input.Password value={bulkResetPassword} onChange={(e) => setBulkResetPassword(e.target.value)} />
            </Form.Item>
            <Form.Item label="Scope">
              <Space style={{ marginTop: 6 }}>
                <Switch checked={bulkResetActiveOnly} onChange={setBulkResetActiveOnly} />
                <Typography.Text>Active users only</Typography.Text>
              </Space>
            </Form.Item>
          </div>
          <Button
            danger
            loading={bulkResetLoading}
            onClick={() =>
              Modal.confirm({
                title: "Reset passwords for selected role?",
                content: "This will overwrite current passwords for all matching users and require password change at next login.",
                okText: "Reset Passwords",
                okButtonProps: { danger: true },
                onOk: async () => {
                  await handleBulkRolePasswordReset();
                },
              })
            }
          >
            Reset Passwords by Role
          </Button>
        </Form>
      </Card>
      <Card style={{ marginTop: 16 }}>
        <Typography.Title level={4} style={{ marginTop: 0 }}>
          Developer Only
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          This permanently deletes all products and related inventory records for clean retesting.
        </Typography.Paragraph>
        <Form layout="vertical" onFinish={handlePurgeAllProducts}>
          <Form.Item label="Current account">
            <Input value={user?.email ?? ""} disabled />
          </Form.Item>
          <Form.Item label="Developer purge token (optional in local dev)">
            <Input.Password value={purgeToken} onChange={(e) => setPurgeToken(e.target.value)} placeholder="Enter if configured" />
          </Form.Item>
          <Button
            danger
            htmlType="button"
            loading={purging}
            onClick={() =>
              Modal.confirm({
                title: "Delete all products?",
                content:
                  "This will permanently remove all products and inventory history tied to them. This cannot be undone.",
                okText: "Delete All Products",
                okButtonProps: { danger: true },
                onOk: async () => {
                  await handlePurgeAllProducts();
                },
              })
            }
          >
            Delete All Products
          </Button>
        </Form>
        {purgeResult ? <Alert style={{ marginTop: 12 }} type="success" showIcon message={purgeResult} /> : null}
      </Card>
    </div>
  );
}
