import React, { useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Drawer, Dropdown, Form, Input, Modal, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { MenuProps } from "antd";
import { MoreOutlined, CameraOutlined, UploadOutlined, CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { listCustomers } from "../api/customers";
import { createJob, listJobs, updateJob, uploadJobPhoto, listJobPhotos, downloadJobPhoto, submitJobForApproval, approveJob, rejectJob, type JobPhoto } from "../api/jobs";
import { listAssignableUsers, listUsers } from "../api/users";
import type { Customer, Job, User } from "../api/types";
import { getApiErrorMessage } from "../api/error";
import { useAuth } from "../state/AuthContext";
import { formatDateTime } from "../utils/datetime";
import { useNavigate } from "react-router-dom";
import JobPhotoUpload from "../components/JobPhotoUpload";

const statusOptions = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "pending_approval", label: "Pending Approval" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" }
];

const priorityOptions = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" }
];

export default function JobsPage() {
  const { message } = AntdApp.useApp();
  const { isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const role = user?.role ?? "technician";
  const canManageJobs = isAdmin || role === "manager" || role === "store_manager" || role === "lead_technician";
  const isTechnicianView = !canManageJobs;
  const [jobs, setJobs] = useState<Job[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [customerId, setCustomerId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("open");
  const [priority, setPriority] = useState("medium");
  const [assignedTo, setAssignedTo] = useState<number | "">("");
  const [siteLocationLabel, setSiteLocationLabel] = useState("");

  const [searchInput, setSearchInput] = useState("");
  const [filterStatus, setFilterStatus] = useState<string | "">("");
  const [filterPriority, setFilterPriority] = useState<string | "">("");
  const [filterCustomer, setFilterCustomer] = useState<number | "">("");

  const [detailJob, setDetailJob] = useState<Job | null>(null);
  const [editing, setEditing] = useState<Job | null>(null);
  const [photos, setPhotos] = useState<JobPhoto[]>([]);
  const [photoUrls, setPhotoUrls] = useState<Record<number, string>>({});
  const [loadingPhotos, setLoadingPhotos] = useState(false);
  const [showPhotoUpload, setShowPhotoUpload] = useState(false);
  const [showApprovalModal, setShowApprovalModal] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [approvalNotes, setApprovalNotes] = useState("");
  const [rejectReason, setRejectReason] = useState("");

  const [editCustomerId, setEditCustomerId] = useState<number | "">("");
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editStatus, setEditStatus] = useState("open");
  const [editPriority, setEditPriority] = useState("medium");
  const [editAssignedTo, setEditAssignedTo] = useState<number | "">("");
  const [editSiteLocationLabel, setEditSiteLocationLabel] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [c, j] = await Promise.all([listCustomers(), listJobs()]);
      setCustomers(c);
      setJobs(j);
      if (isAdmin) {
        const u = await listUsers();
        setUsers(u);
      } else if (canManageJobs) {
        const u = await listAssignableUsers();
        setUsers(u);
      } else {
        setUsers([]);
      }
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to load jobs"));
    } finally {
      setLoading(false);
    }
  }

  async function loadPhotos(jobId: number) {
    setLoadingPhotos(true);
    try {
      const jobPhotos = await listJobPhotos(jobId);
      setPhotos(jobPhotos);
    } catch (err: any) {
      console.error("Failed to load photos:", err);
    } finally {
      setLoadingPhotos(false);
    }
  }

  // Load photos when detailJob changes
  useEffect(() => {
    if (detailJob) {
      loadPhotos(detailJob.id);
    } else {
      setPhotos([]);
    }
  }, [detailJob?.id]);

  useEffect(() => {
    let active = true;
    async function loadPhotoUrls() {
      if (!detailJob || photos.length === 0) {
        setPhotoUrls({});
        return;
      }
      const entries = await Promise.all(
        photos.map(async (photo) => {
          try {
            const blob = await downloadJobPhoto(detailJob.id, photo.id);
            return [photo.id, URL.createObjectURL(blob)] as const;
          } catch {
            return [photo.id, ""] as const;
          }
        })
      );
      if (!active) {
        entries.forEach(([, url]) => {
          if (url) URL.revokeObjectURL(url);
        });
        return;
      }
      setPhotoUrls((prev) => {
        Object.values(prev).forEach((url) => {
          if (url) URL.revokeObjectURL(url);
        });
        return Object.fromEntries(entries.filter(([, url]) => url));
      });
    }
    loadPhotoUrls();
    return () => {
      active = false;
    };
  }, [detailJob, photos]);

  useEffect(() => () => {
    Object.values(photoUrls).forEach((url) => {
      if (url) URL.revokeObjectURL(url);
    });
  }, [photoUrls]);

  useEffect(() => {
    refresh();
  }, [isAdmin, canManageJobs]);

  async function handleCreate() {
    setError(null);
    if (customerId === "") {
      setError("Select a customer");
      return;
    }
    if (!title.trim()) {
      setError("Title is required");
      return;
    }
    if (!siteLocationLabel.trim()) {
      setError("Site name is required");
      return;
    }
    setSaving(true);
    try {
      await createJob({
        customer_id: customerId,
        title: title.trim(),
        description: description.trim() ? description.trim() : null,
        status,
        priority,
        assigned_to_user_id: assignedTo === "" ? null : Number(assignedTo),
        site_location_label: siteLocationLabel.trim() || null,
      });
      setCustomerId("");
      setTitle("");
      setDescription("");
      setStatus("open");
      setPriority("medium");
      setAssignedTo("");
      setSiteLocationLabel("");
      message.success("Job created");
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to create job"));
    } finally {
      setSaving(false);
    }
  }

  function startEdit(job: Job) {
    setEditing(job);
    setEditCustomerId(job.customer_id);
    setEditTitle(job.title);
    setEditDescription(job.description ?? "");
    setEditStatus(job.status || "open");
    setEditPriority(job.priority || "medium");
    setEditAssignedTo(job.assigned_to_user_id ?? "");
    setEditSiteLocationLabel(job.site_location_label ?? "");
  }

  async function handleUpdate() {
    if (!editing) return;
    setError(null);
    if (editCustomerId === "") {
      setError("Select a customer");
      return;
    }
    if (!editTitle.trim()) {
      setError("Title is required");
      return;
    }
    if (!editSiteLocationLabel.trim()) {
      setError("Site name is required");
      return;
    }
    setSaving(true);
    try {
      await updateJob(editing.id, {
        customer_id: Number(editCustomerId),
        title: editTitle.trim(),
        description: editDescription.trim() ? editDescription.trim() : null,
        status: editStatus,
        priority: editPriority,
        assigned_to_user_id: editAssignedTo === "" ? null : Number(editAssignedTo),
        site_location_label: editSiteLocationLabel.trim() || null,
      });
      message.success("Job updated");
      setEditing(null);
      await refresh();
    } catch (err: any) {
      setError(getApiErrorMessage(err, "Failed to update job"));
    } finally {
      setSaving(false);
    }
  }

  async function handleUploadPhoto(file: File, photoType: string, description: string) {
    if (!detailJob) return;
    try {
      await uploadJobPhoto(detailJob.id, file, photoType, description);
      message.success("Photo uploaded");
      await loadPhotos(detailJob.id);
    } catch (err: any) {
      message.error(getApiErrorMessage(err, "Failed to upload photo"));
    }
  }

  async function handleSubmitForApproval() {
    if (!detailJob) return;
    setSaving(true);
    try {
      await submitJobForApproval(detailJob.id);
      message.success("Job submitted for approval");
      setDetailJob(null);
      await refresh();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, "Failed to submit for approval"));
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveJob() {
    if (!detailJob) return;
    setSaving(true);
    try {
      await approveJob(detailJob.id, approvalNotes);
      message.success("Job approved");
      setShowApprovalModal(false);
      setApprovalNotes("");
      setDetailJob(null);
      await refresh();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, "Failed to approve job"));
    } finally {
      setSaving(false);
    }
  }

  async function handleRejectJob() {
    if (!detailJob) return;
    if (!rejectReason.trim()) {
      message.error("Please provide a reason for rejection");
      return;
    }
    setSaving(true);
    try {
      await rejectJob(detailJob.id, rejectReason);
      message.success("Job rejected");
      setShowRejectModal(false);
      setRejectReason("");
      setDetailJob(null);
      await refresh();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, "Failed to reject job"));
    } finally {
      setSaving(false);
    }
  }

  const isTechnicianOrLead = role === "technician" || role === "lead_technician";
  const canApprove = isAdmin || role === "manager" || role === "lead_technician";

  const customerNameById = useMemo(() => new Map(customers.map((c) => [c.id, c.name])), [customers]);
  const userNameById = useMemo(
    () => new Map(users.map((u) => [u.id, u.full_name || u.email])),
    [users]
  );

  const filteredJobs = useMemo(() => {
    let data = jobs;
    if (filterCustomer !== "") data = data.filter((job) => job.customer_id === filterCustomer);
    if (filterStatus) data = data.filter((job) => job.status === filterStatus);
    if (filterPriority) data = data.filter((job) => job.priority === filterPriority);
    const q = searchInput.trim().toLowerCase();
    if (q) {
      data = data.filter((job) => {
        const customer = customerNameById.get(job.customer_id) ?? "";
        return (
          String(job.id).includes(q) ||
          job.title.toLowerCase().includes(q) ||
          customer.toLowerCase().includes(q)
        );
      });
    }
    return data;
  }, [jobs, filterCustomer, filterPriority, filterStatus, searchInput, customerNameById]);

  const statusColor = (value: string) => {
    if (value === "completed") return "green";
    if (value === "in_progress") return "gold";
    if (value === "canceled") return "red";
    return "blue";
  };

  const priorityColor = (value: string) => {
    if (value === "high") return "red";
    if (value === "low") return "green";
    return "gold";
  };

  const statusLabel = (value: string) => value.replace(/_/g, " ").toUpperCase();

  const columns = useMemo(
    () => [
      { title: "ID", dataIndex: "id", key: "id", sorter: (a: Job, b: Job) => a.id - b.id },
      {
        title: "Customer",
        dataIndex: "customer_id",
        key: "customer_id",
        render: (value: number) => customerNameById.get(value) ?? value,
        sorter: (a: Job, b: Job) =>
          (customerNameById.get(a.customer_id) ?? "").localeCompare(customerNameById.get(b.customer_id) ?? "")
      },
      { title: "Title", dataIndex: "title", key: "title", sorter: (a: Job, b: Job) => a.title.localeCompare(b.title) },
      {
        title: "Site",
        key: "site",
        responsive: ["lg" as const],
        render: (_: unknown, job: Job) =>
          job.site_location_label || (job.site_latitude != null && job.site_longitude != null
            ? `${Number(job.site_latitude).toFixed(5)}, ${Number(job.site_longitude).toFixed(5)}`
            : "-"),
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>
      },
      {
        title: "Priority",
        dataIndex: "priority",
        key: "priority",
        render: (value: string) => <Tag color={priorityColor(value)}>{statusLabel(value)}</Tag>,
        sorter: (a: Job, b: Job) => a.priority.localeCompare(b.priority)
      },
      {
        title: "Assigned",
        key: "assigned",
        responsive: ["lg" as const],
        render: (_: unknown, job: Job) =>
          job.assigned_to_user_id ? userNameById.get(job.assigned_to_user_id) ?? "Assigned user unavailable" : "Unassigned"
      },
      {
        title: "Created",
        dataIndex: "created_at",
        key: "created_at",
        render: (value: string) => formatDateTime(value)
      },
      {
        title: "Updated",
        dataIndex: "updated_at",
        key: "updated_at",
        render: (value: string) => formatDateTime(value)
      },
      {
        title: "Actions",
        key: "actions",
        width: 140,
        render: (_: unknown, job: Job) => {
          const menuItems: MenuProps["items"] = [
            { key: "view", label: "View", onClick: () => setDetailJob(job) },
            canManageJobs ? { key: "edit", label: "Edit", onClick: () => startEdit(job) } : null
          ];
          return (
            <Dropdown menu={{ items: menuItems.filter(Boolean) as MenuProps["items"] }} trigger={["click"]}>
              <Button icon={<MoreOutlined />}>Manage</Button>
            </Dropdown>
          );
        }
      }
    ],
    [canManageJobs, customerNameById, userNameById]
  );

  const technicianColumns = useMemo(
    () => [
      { title: "ID", dataIndex: "id", key: "id", width: 70 },
      {
        title: "Job",
        dataIndex: "title",
        key: "title",
        ellipsis: true,
        render: (value: string, job: Job) => (
          <div>
            <div style={{ fontWeight: 600 }}>{value}</div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {customerNameById.get(job.customer_id) ?? `Customer #${job.customer_id}`}
            </Typography.Text>
          </div>
        )
      },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 120,
        render: (value: string) => <Tag color={statusColor(value)}>{statusLabel(value)}</Tag>
      },
      {
        title: "Updated",
        dataIndex: "updated_at",
        key: "updated_at",
        width: 170,
        render: (value: string) => formatDateTime(value)
      },
      {
        title: "Actions",
        key: "actions",
        width: 110,
        render: (_: unknown, job: Job) => (
          <Button size="small" onClick={() => setDetailJob(job)}>
            View
          </Button>
        )
      }
    ],
    [customerNameById]
  );

  return (
    <div className="container page-shell">
      <Typography.Title level={2} style={{ marginTop: 0 }}>
        Jobs
      </Typography.Title>
      {!canManageJobs ? (
        <Card>
          <Typography.Text type="secondary">
            Job creation and assignment is available to lead technicians, store managers, managers, and admins.
          </Typography.Text>
        </Card>
      ) : null}
      {canManageJobs ? (
        <Space>
          <Button onClick={() => setShowCreateForm((prev) => !prev)}>
            {showCreateForm ? "Hide Add Job" : "Add New Job"}
          </Button>
        </Space>
      ) : null}
      <div className="grid">
        {canManageJobs && showCreateForm ? (
        <Card title="Create job">
          <Form layout="vertical" onFinish={handleCreate}>
            <Form.Item label="Customer" required>
              <Select<number>
                value={customerId === "" ? undefined : customerId}
                onChange={(value) => setCustomerId(value)}
                placeholder="Select..."
              >
                {customers.map((c) => (
                  <Select.Option key={c.id} value={c.id}>
                    {c.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="Title" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} />
            </Form.Item>
            <Form.Item label="Description">
              <Input.TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
            </Form.Item>
            <Form.Item label="Site name" required>
              <Input value={siteLocationLabel} onChange={(e) => setSiteLocationLabel(e.target.value)} placeholder="e.g. Pump station A" />
            </Form.Item>
            <Form.Item label="Status">
              <Select value={status} onChange={(value) => setStatus(value)} options={statusOptions} />
            </Form.Item>
            <Form.Item label="Priority">
              <Select value={priority} onChange={(value) => setPriority(value)} options={priorityOptions} />
            </Form.Item>
            {canManageJobs ? (
              <Form.Item label="Assign to">
                <Select<number>
                  allowClear
                  value={assignedTo === "" ? undefined : assignedTo}
                  onChange={(value) => setAssignedTo(value ?? "")}
                  placeholder="Unassigned"
                >
                  {users.map((u) => (
                    <Select.Option key={u.id} value={u.id}>
                      {u.full_name || u.email}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
            ) : null}
            <Button type="primary" htmlType="submit" disabled={saving}>
              Create
            </Button>
          </Form>
          {error ? <Typography.Text type="danger">{error}</Typography.Text> : null}
        </Card>
        ) : null}

        <Card
          title="Job list"
          extra={
            <Button onClick={refresh} disabled={loading}>
              Refresh
            </Button>
          }
          style={{ gridColumn: "1 / -1" }}
        >
          <Space wrap style={{ marginBottom: 12, width: "100%" }} className="jobs-filter-wrap">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by job, customer, or ID"
              style={{ maxWidth: 320 }}
            />
            <Select
              value={filterCustomer === "" ? undefined : filterCustomer}
              onChange={(value) => setFilterCustomer(value ?? "")}
              placeholder="Filter customer"
              allowClear
              style={{ minWidth: 180 }}
            >
              {customers.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select>
            <Select
              value={filterStatus || undefined}
              onChange={(value) => setFilterStatus(value ?? "")}
              placeholder="Filter status"
              allowClear
              style={{ minWidth: 160 }}
              options={statusOptions}
            />
            <Select
              value={filterPriority || undefined}
              onChange={(value) => setFilterPriority(value ?? "")}
              placeholder="Filter priority"
              allowClear
              style={{ minWidth: 160 }}
              options={priorityOptions}
            />
            <Button
              onClick={() => {
                setSearchInput("");
                setFilterCustomer("");
                setFilterStatus("");
                setFilterPriority("");
              }}
            >
              Clear
            </Button>
          </Space>
          <Table
            rowKey="id"
            loading={loading}
            dataSource={filteredJobs}
            columns={isTechnicianView ? technicianColumns : columns}
            scroll={isTechnicianView ? undefined : { x: 980 }}
            pagination={{ pageSize: isTechnicianView ? 8 : 10, showSizeChanger: true }}
            locale={{ emptyText: "No jobs yet. Create one to start tracking work." }}
          />
        </Card>
      </div>

      <Drawer
        title="Job details"
        open={!!detailJob}
        onClose={() => setDetailJob(null)}
        width={640}
        extra={
          detailJob ? (
            <Space>
              {/* Approval Workflow Buttons */}
              {isTechnicianOrLead && detailJob.status === "in_progress" && (
                <Button type="primary" onClick={() => setShowPhotoUpload(true)}>
                  <CameraOutlined /> Add Photos
                </Button>
              )}
              {isTechnicianOrLead && detailJob.status === "in_progress" && (
                <Button onClick={handleSubmitForApproval} disabled={saving}>
                  Submit for Approval
                </Button>
              )}
              {canApprove && detailJob.status === "pending_approval" && (
                <>
                  <Button type="primary" onClick={() => setShowApprovalModal(true)} disabled={saving}>
                    <CheckOutlined /> Approve
                  </Button>
                  <Button danger onClick={() => setShowRejectModal(true)} disabled={saving}>
                    <CloseOutlined /> Reject
                  </Button>
                </>
              )}
              {canManageJobs ? <Button onClick={() => startEdit(detailJob)}>Edit</Button> : null}
              <Button
                type="primary"
                onClick={() =>
                  navigate("/requests", {
                    state: { jobId: detailJob.id, customerId: detailJob.customer_id }
                  })
                }
              >
                Create request
              </Button>
            </Space>
          ) : null
        }
      >
        {detailJob ? (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <Typography.Text type="secondary">Title</Typography.Text>
              <div>{detailJob.title}</div>
            </div>
            <div>
              <Typography.Text type="secondary">Customer</Typography.Text>
              <div>{customerNameById.get(detailJob.customer_id) ?? detailJob.customer_id}</div>
            </div>
            <div>
              <Typography.Text type="secondary">Status</Typography.Text>
              <div>
                <Tag color={detailJob.status === "pending_approval" ? "orange" : detailJob.status === "completed" ? "green" : detailJob.status === "in_progress" ? "blue" : "default"}>
                  {statusLabel(detailJob.status)}
                </Tag>
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">Priority</Typography.Text>
              <div>{statusLabel(detailJob.priority)}</div>
            </div>
            <div>
              <Typography.Text type="secondary">Assigned to</Typography.Text>
              <div>
                {detailJob.assigned_to_user_id
                  ? userNameById.get(detailJob.assigned_to_user_id) ?? "Assigned user unavailable"
                  : "Unassigned"}
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">Site</Typography.Text>
              <div>
                {detailJob.site_location_label || "No label"}{" "}
                {detailJob.site_latitude != null && detailJob.site_longitude != null
                  ? `(${Number(detailJob.site_latitude).toFixed(6)}, ${Number(detailJob.site_longitude).toFixed(6)})`
                  : ""}
              </div>
            </div>
            <div>
              <Typography.Text type="secondary">Description</Typography.Text>
              <div>{detailJob.description || "No description"}</div>
            </div>

            {/* Photo Gallery Section */}
            <div>
              <Typography.Text type="secondary">Photos ({photos.length})</Typography.Text>
              <div style={{ marginTop: 8 }}>
                {loadingPhotos ? (
                  <Typography.Text type="secondary">Loading photos...</Typography.Text>
                ) : photos.length > 0 ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {photos.map((photo) => (
                      photoUrls[photo.id] ? (
                      <a
                        key={photo.id}
                        href={photoUrls[photo.id]}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: "block",
                          width: 100,
                          height: 100,
                          borderRadius: 8,
                          overflow: "hidden",
                          border: "1px solid #d9d9d9",
                        }}
                      >
                        <img
                          src={photoUrls[photo.id]}
                          alt={photo.file_name}
                          loading="lazy"
                          decoding="async"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      </a>
                      ) : null
                    ))}
                  </div>
                ) : (
                  <Typography.Text type="secondary">No photos yet</Typography.Text>
                )}
                {(isTechnicianOrLead || canManageJobs) && (
                  <Button
                    type="dashed"
                    icon={<UploadOutlined />}
                    onClick={() => setShowPhotoUpload(true)}
                    style={{ marginTop: 8, width: "100%" }}
                  >
                    Upload Photo
                  </Button>
                )}
              </div>
            </div>

            {/* Approval Info */}
            {detailJob.approved_by_user_id && (
              <div>
                <Typography.Text type="secondary">Approved By</Typography.Text>
                <div>
                  {detailJob.approved_by_user_id} on {detailJob.approved_at ? new Date(detailJob.approved_at).toLocaleString() : "N/A"}
                </div>
                {detailJob.approval_notes && (
                  <>
                    <Typography.Text type="secondary">Approval Notes</Typography.Text>
                    <div>{detailJob.approval_notes}</div>
                  </>
                )}
              </div>
            )}
          </Space>
        ) : null}
      </Drawer>

      <Modal
        title="Edit job"
        open={!!editing}
        onCancel={() => setEditing(null)}
        onOk={handleUpdate}
        okText="Save"
        confirmLoading={saving}
      >
        <Form layout="vertical">
          <Form.Item label="Customer" required>
            <Select<number>
              value={editCustomerId === "" ? undefined : editCustomerId}
              onChange={(value) => setEditCustomerId(value)}
              placeholder="Select..."
            >
              {customers.map((c) => (
                <Select.Option key={c.id} value={c.id}>
                  {c.name}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item label="Title" required>
            <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
          </Form.Item>
          <Form.Item label="Description">
            <Input.TextArea value={editDescription} onChange={(e) => setEditDescription(e.target.value)} rows={4} />
          </Form.Item>
          <Form.Item label="Site name" required>
            <Input value={editSiteLocationLabel} onChange={(e) => setEditSiteLocationLabel(e.target.value)} placeholder="e.g. Pump station A" />
          </Form.Item>
          <Form.Item label="Status">
            <Select value={editStatus} onChange={(value) => setEditStatus(value)} options={statusOptions} />
          </Form.Item>
          <Form.Item label="Priority">
            <Select value={editPriority} onChange={(value) => setEditPriority(value)} options={priorityOptions} />
          </Form.Item>
          {canManageJobs ? (
            <Form.Item label="Assign to">
              <Select<number>
                allowClear
                value={editAssignedTo === "" ? undefined : editAssignedTo}
                onChange={(value) => setEditAssignedTo(value ?? "")}
                placeholder="Unassigned"
              >
                {users.map((u) => (
                  <Select.Option key={u.id} value={u.id}>
                    {u.full_name || u.email}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          ) : null}
        </Form>
      </Modal>

      {/* Photo Upload Modal */}
      <Modal
        title="Upload Photo"
        open={showPhotoUpload}
        onCancel={() => setShowPhotoUpload(false)}
        footer={null}
      >
        <JobPhotoUpload jobId={detailJob?.id} onUploadComplete={() => {
          setShowPhotoUpload(false);
          if (detailJob) loadPhotos(detailJob.id);
        }} />
      </Modal>

      {/* Approval Modal */}
      <Modal
        title="Approve Job"
        open={showApprovalModal}
        onCancel={() => {
          setShowApprovalModal(false);
          setApprovalNotes("");
        }}
        onOk={handleApproveJob}
        okText="Approve"
        confirmLoading={saving}
      >
        <p>Are you sure you want to approve this job?</p>
        <Input.TextArea
          value={approvalNotes}
          onChange={(e) => setApprovalNotes(e.target.value)}
          placeholder="Optional notes..."
          rows={3}
        />
      </Modal>

      {/* Rejection Modal */}
      <Modal
        title="Reject Job"
        open={showRejectModal}
        onCancel={() => {
          setShowRejectModal(false);
          setRejectReason("");
        }}
        onOk={handleRejectJob}
        okText="Reject"
        okButtonProps={{ danger: true }}
        confirmLoading={saving}
      >
        <p>Please provide a reason for rejecting this job:</p>
        <Input.TextArea
          value={rejectReason}
          onChange={(e) => setRejectReason(e.target.value)}
          placeholder="Reason for rejection..."
          rows={3}
        />
      </Modal>
    </div>
  );
}
