import React, { useCallback, useEffect, useMemo, useState } from "react";
import { App as AntdApp, Button, Card, Checkbox, Drawer, Dropdown, Form, Grid, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography, Upload } from "antd";
import type { MenuProps } from "antd";
import { FilterOutlined, MoreOutlined, PlusOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { FloatingBubble, PullToRefresh } from "antd-mobile";
import {
  bulkCreateItemInstances,
  createItem,
  deactivateItem,
  deleteItemAttachment,
  downloadItemAttachment,
  downloadItemInstanceLabelPdf,
  downloadItemLabelPdf,
  getItemInstanceQrSvg,
  getItemQrSvg,
  importInventoryXlsx,
  listItemAttachments,
  listItemLocations,
  listItemInstances,
  listItems,
  listLowStock,
  normalizeExistingSkus,
  hardDeleteItem,
  type ProductAttachment,
  reactivateItem,
  uploadItemAttachment,
  updateItemLocations,
  updateItem
} from "../api/items";
import { listCategories } from "../api/categories";
import { listLocations } from "../api/locations";
import { listSuppliers } from "../api/suppliers";
import { createStockTransaction, listStockTransactions } from "../api/stock";
import { createRequest } from "../api/requests";
import { listUsers } from "../api/users";
import type { Category, Item, ItemInstance, Location, StockTransaction, StockTransactionType, Supplier, User } from "../api/types";
import type { LocationStock } from "../api/types";
import { getApiErrorMessage } from "../api/error";
import { formatKes } from "../utils/currency";
import { formatDateTime } from "../utils/datetime";
import { useAuth } from "../state/AuthContext";
import SmartEmptyState from "../components/SmartEmptyState";

type SortField = "name" | "sku" | "quantity_on_hand" | "min_quantity" | "created_at" | "updated_at";
type SortDirection = "asc" | "desc";

function isLowStock(item: Item): boolean {
  return item.quantity_on_hand <= item.min_quantity;
}

function toInt(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

function toFloat(value: string): number | null {
  if (value.trim() === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function buildCsv(headers: string[], rows: Array<Array<string | number | null | undefined>>): string {
  const lines = [headers.map(csvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(csvCell).join(","));
  }
  return lines.join("\n");
}

function renderItemThumb(item: Item) {
  if (item.image_url) {
    return (
      <img
        src={item.image_url}
        alt={item.name}
        loading="lazy"
        decoding="async"
        style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, border: "1px solid rgba(255,255,255,0.18)" }}
      />
    );
  }
  return (
    <div
      aria-label={`${item.name} image placeholder`}
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        border: "1px dashed rgba(255,255,255,0.24)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        color: "rgba(255,255,255,0.72)",
      }}
    >
      No Img
    </div>
  );
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const char = content[i];
    const next = content[i + 1];
    if (char === "\"") {
      if (inQuotes && next === "\"") {
        cell += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

function downloadTextFile(filename: string, content: string, type = "text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function InventoryPage() {
  const { message } = AntdApp.useApp();
  const { isAdmin, user } = useAuth();
  const screens = Grid.useBreakpoint();
  const isMobile = !screens.md;
  const role = user?.role ?? "technician";
  const canApproveDeletion = isAdmin || role === "manager" || role === "approver";
  const canUploadAttachments = isAdmin || role === "manager" || role === "store_manager" || role === "lead_technician" || role === "technician";
  const canDeleteAttachments = isAdmin || role === "manager" || role === "store_manager";
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);
  const [inventoryPulse, setInventoryPulse] = useState(false);

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const suppliersById = useMemo(() => new Map(suppliers.map((s) => [s.id, s])), [suppliers]);
  const [users, setUsers] = useState<User[]>([]);
  const usersById = useMemo(
    () => new Map(users.map((u) => [u.id, u.full_name || u.email])),
    [users]
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<SortField>("name");
  const [direction, setDirection] = useState<SortDirection>("asc");
  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [inStockOnly, setInStockOnly] = useState(false);
  const [outOfStockOnly, setOutOfStockOnly] = useState(false);
  const [filterCategoryId, setFilterCategoryId] = useState<number | "">("");
  const [filterLocationId, setFilterLocationId] = useState<number | "">("");
  const [filterSupplierId, setFilterSupplierId] = useState<number | "">("");
  const [filterTrackingType, setFilterTrackingType] = useState<"BATCH" | "INDIVIDUAL" | "">("");
  const [filterMinPrice, setFilterMinPrice] = useState<string>("");
  const [filterMaxPrice, setFilterMaxPrice] = useState<string>("");
  const [filterMinQoh, setFilterMinQoh] = useState<string>("");
  const [filterMaxQoh, setFilterMaxQoh] = useState<string>("");
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reorderItems, setReorderItems] = useState<Item[]>([]);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);
  const [reorderQuantities, setReorderQuantities] = useState<Record<number, number>>({});
  const [reorderSubmitting, setReorderSubmitting] = useState(false);
  const [reorderPage, setReorderPage] = useState(1);
  const [reorderPageSize, setReorderPageSize] = useState(10);
  const [importing, setImporting] = useState(false);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importSummary, setImportSummary] = useState<{ created: number; failed: number } | null>(null);
  const [importSkipped, setImportSkipped] = useState<number | null>(null);
  const [normalizingSkus, setNormalizingSkus] = useState(false);

  function triggerInventoryPulse() {
    setInventoryPulse(true);
    window.setTimeout(() => setInventoryPulse(false), 1200);
  }

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / pageSize)), [total, pageSize]);

  const refreshSuppliers = useCallback(async () => {
    const wasEditing = Boolean(editing);
    try {
      setSuppliers(await listSuppliers({ include_inactive: true }));
    } catch {
      // Non-critical: inventory can still function without supplier names loaded.
    }
  }, []);

  const refreshUsers = useCallback(async () => {
    if (!isAdmin) {
      setUsers([]);
      return;
    }
    try {
      setUsers(await listUsers());
    } catch {
      // Optional
    }
  }, [isAdmin]);

  const refreshCategories = useCallback(async () => {
    try {
      setCategories(await listCategories({ include_inactive: true }));
    } catch {
      // Optional
    }
  }, []);

  const refreshLocations = useCallback(async () => {
    try {
      setLocations(await listLocations({ include_inactive: true }));
    } catch {
      // Optional
    }
  }, []);

  const loadReorder = useCallback(async () => {
    setReorderLoading(true);
    setReorderError(null);
    try {
      const low = await listLowStock({ limit: 200 });
      setReorderItems(low);
      setReorderPage(1);
      const defaults: Record<number, number> = {};
      low.forEach((item) => {
        const shortage = Math.max(0, item.min_quantity - item.quantity_on_hand);
        defaults[item.id] = shortage;
      });
      setReorderQuantities(defaults);
    } catch (err: any) {
      setReorderError(getApiErrorMessage(err, "Failed to load reorder suggestions"));
    } finally {
      setReorderLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setListError(null);
    try {
      const stockState = lowOnly ? "low" : inStockOnly ? "in" : outOfStockOnly ? "out" : undefined;
      const minPrice = toFloat(filterMinPrice);
      const maxPrice = toFloat(filterMaxPrice);
      const minQoh = toInt(filterMinQoh);
      const maxQoh = toInt(filterMaxQoh);
      const data = await listItems({
        page,
        page_size: pageSize,
        q: q || undefined,
        sort,
        direction,
        include_inactive: true,
        stock_state: stockState,
        category_id: filterCategoryId === "" ? undefined : Number(filterCategoryId),
        location_id: filterLocationId === "" ? undefined : Number(filterLocationId),
        supplier_id: filterSupplierId === "" ? undefined : Number(filterSupplierId),
        tracking_type: filterTrackingType === "" ? undefined : filterTrackingType,
        min_unit_price: minPrice == null ? undefined : minPrice,
        max_unit_price: maxPrice == null ? undefined : maxPrice,
        min_quantity_on_hand: minQoh == null ? undefined : minQoh,
        max_quantity_on_hand: maxQoh == null ? undefined : maxQoh,
      });
      setItems(data.items);
      setTotal(data.total);
      await loadReorder();
    } catch (err: any) {
      setListError(getApiErrorMessage(err, "Failed to load inventory"));
    } finally {
      setLoading(false);
    }
  }, [direction, loadReorder, lowOnly, inStockOnly, outOfStockOnly, filterCategoryId, filterLocationId, filterSupplierId, filterTrackingType, filterMinPrice, filterMaxPrice, filterMinQoh, filterMaxQoh, page, pageSize, q, sort]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshSuppliers();
  }, [refreshSuppliers]);

  useEffect(() => {
    refreshUsers();
  }, [refreshUsers]);

  useEffect(() => {
    refreshCategories();
  }, [refreshCategories]);

  useEffect(() => {
    refreshLocations();
  }, [refreshLocations]);

  function toggleSort(field: SortField) {
    setPage(1);
    if (sort === field) {
      setDirection(direction === "asc" ? "desc" : "asc");
      return;
    }
    setSort(field);
    setDirection("asc");
  }

  function resetForm() {
    setEditing(null);
    setSku("");
    setName("");
    setDescription("");
    setImageUrl("");
    setUnitPrice("");
    setQuantityOnHand("0");
    setMinQuantity("0");
    setTrackingType("BATCH");
    setUnitOfMeasure("");
    setCategoryId("");
    setLocationId("");
    setSupplierId("");
    setFormError(null);
    setShowItemForm(false);
  }

  const [editing, setEditing] = useState<Item | null>(null);
  const [showItemForm, setShowItemForm] = useState(false);
  const [quickCreateOpen, setQuickCreateOpen] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickTrackingType, setQuickTrackingType] = useState<"BATCH" | "INDIVIDUAL">("BATCH");
  const [quickQtyOnHand, setQuickQtyOnHand] = useState(0);
  const [quickMinQty, setQuickMinQty] = useState(0);
  const [quickUnitPrice, setQuickUnitPrice] = useState<number | null>(null);
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [quantityOnHand, setQuantityOnHand] = useState("0");
  const [minQuantity, setMinQuantity] = useState("0");
  const [trackingType, setTrackingType] = useState<"BATCH" | "INDIVIDUAL">("BATCH");
  const [unitOfMeasure, setUnitOfMeasure] = useState("");
  const [categoryId, setCategoryId] = useState<number | "">("");
  const [locationId, setLocationId] = useState<number | "">("");
  const [supplierId, setSupplierId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function startEdit(item: Item) {
    setShowItemForm(true);
    setEditing(item);
    setSku(item.sku);
    setName(item.name);
    setDescription(item.description ?? "");
    setImageUrl(item.image_url ?? "");
    setUnitPrice(item.unit_price == null ? "" : String(item.unit_price));
    setQuantityOnHand(String(item.quantity_on_hand));
    setMinQuantity(String(item.min_quantity));
    setTrackingType((item.tracking_type as "BATCH" | "INDIVIDUAL") ?? "BATCH");
    setUnitOfMeasure(item.unit_of_measure ?? "");
    setCategoryId(item.category_id ?? "");
    setLocationId(item.location_id ?? "");
    setSupplierId(item.supplier_id ?? "");
    setFormError(null);
  }

  async function handleSave() {
    setFormError(null);

    const nameValue = name.trim();
    if (!nameValue) {
      setFormError("Name is required");
      return;
    }
    const imageUrlValue = imageUrl.trim();

    const qoh = toInt(quantityOnHand);
    if (qoh === null || qoh < 0) {
      setFormError("Quantity on hand must be a whole number >= 0");
      return;
    }
    const minQty = toInt(minQuantity);
    if (minQty === null || minQty < 0) {
      setFormError("Min quantity must be a whole number >= 0");
      return;
    }
    const price = toFloat(unitPrice);
    if (price !== null && price < 0) {
      setFormError("Unit price must be >= 0");
      return;
    }

    setSaving(true);
    const wasEditing = Boolean(editing);
    try {
      const payload = {
        name: nameValue,
        description: description.trim() || null,
        image_url: imageUrlValue || null,
        unit_price: price,
        quantity_on_hand: qoh,
        min_quantity: minQty,
        tracking_type: trackingType,
        unit_of_measure: unitOfMeasure.trim() || null,
        category_id: categoryId === "" ? null : Number(categoryId),
        location_id: locationId === "" ? null : Number(locationId),
        supplier_id: supplierId === "" ? null : Number(supplierId)
      };
      let createdItem: Item | null = null;
      if (editing) {
        await updateItem(editing.id, payload);
      } else {
        createdItem = await createItem(payload);
      }
      resetForm();
      setPage(1);
      await refresh();
      message.success(wasEditing ? "Item updated" : "Item created");
      triggerInventoryPulse();
      if (createdItem) {
        await openQrModal(createdItem);
      }
    } catch (err: any) {
      setFormError(getApiErrorMessage(err, "Failed to save item"));
    } finally {
      setSaving(false);
    }
  }

  async function handleQuickCreateItem() {
    const nameValue = quickName.trim();
    if (!nameValue) {
      setQuickError("Name is required");
      return;
    }
    setQuickSaving(true);
    setQuickError(null);
    try {
      await createItem({
        name: nameValue,
        quantity_on_hand: Math.max(0, quickQtyOnHand),
        min_quantity: Math.max(0, quickMinQty),
        unit_price: quickUnitPrice == null ? null : Math.max(0, quickUnitPrice),
        tracking_type: quickTrackingType,
        description: null,
        image_url: null,
        unit_of_measure: null,
        category_id: null,
        location_id: null,
        supplier_id: null
      });
      message.success("Quick item created");
      setQuickCreateOpen(false);
      setQuickName("");
      setQuickTrackingType("BATCH");
      setQuickQtyOnHand(0);
      setQuickMinQty(0);
      setQuickUnitPrice(null);
      await refresh();
      triggerInventoryPulse();
    } catch (err: any) {
      setQuickError(getApiErrorMessage(err, "Failed to create quick item"));
    } finally {
      setQuickSaving(false);
    }
  }

  function formatMoney(v?: number | null): string {
    return formatKes(v);
  }

  const categoryNameById = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const categoryIdByName = useMemo(
    () => new Map(categories.map((c) => [c.name.toLowerCase(), c.id])),
    [categories]
  );
  const locationIdByName = useMemo(
    () => new Map(locations.map((l) => [l.name.toLowerCase(), l.id])),
    [locations]
  );
  const supplierIdByName = useMemo(
    () => new Map(suppliers.map((s) => [s.name.toLowerCase(), s.id])),
    [suppliers]
  );

  const itemColumns = useMemo(() => {
    const label = (text: string, field: SortField) => (
      <Button type="link" onClick={() => toggleSort(field)} disabled={lowOnly} style={{ padding: 0 }}>
        {text} {sort === field ? (direction === "asc" ? "^" : "v") : ""}
      </Button>
    );
    return [
      { title: label("SKU", "sku"), dataIndex: "sku", key: "sku" },
      {
        title: "Image",
        key: "image_url",
        render: (_: unknown, item: Item) => renderItemThumb(item)
      },
      { title: label("Name", "name"), dataIndex: "name", key: "name" },
      {
        title: "Active",
        key: "is_active",
        render: (_: unknown, item: Item) => (item.is_active ? <Tag color="green">Active</Tag> : <Tag color="default">Inactive</Tag>)
      },
      {
        title: "Category",
        key: "category",
        render: (_: unknown, item: Item) => (item.category_id ? categoryNameById.get(item.category_id) ?? item.category_id : "")
      },
      { title: "Tracking", dataIndex: "tracking_type", key: "tracking_type", render: (value: string) => value ?? "BATCH" },
      {
        title: "Supplier",
        key: "supplier",
        render: (_: unknown, item: Item) =>
          item.supplier_id ? suppliersById.get(item.supplier_id)?.name ?? item.supplier_id : ""
      },
      {
        title: label("Qty", "quantity_on_hand"),
        key: "quantity_on_hand",
        render: (_: unknown, item: Item) => (
          <Space size="small">
            <span>{item.quantity_on_hand}</span>
            {isLowStock(item) ? <Tag color="red">Low</Tag> : null}
          </Space>
        )
      },
      { title: label("Min", "min_quantity"), dataIndex: "min_quantity", key: "min_quantity" },
      { title: "Unit price", dataIndex: "unit_price", key: "unit_price", render: (value: number | null) => formatMoney(value) },
      {
        title: "Actions",
        key: "actions",
        width: 120,
        render: (_: unknown, item: Item) => {
          const menuItems: MenuProps["items"] = [
            {
              key: "edit",
              label: "Edit",
              onClick: () => startEdit(item),
            },
            {
              key: "stock",
              label: "Stock",
              onClick: () => openStockModal(item),
            },
            {
              key: "instances",
              label: "Instances",
              disabled: item.tracking_type !== "INDIVIDUAL",
              onClick: () => openInstancesModal(item),
            },
            {
              key: "locations",
              label: "Locations",
              onClick: () => openLocationModal(item),
            },
            {
              key: "attachments",
              label: "Attachments",
              onClick: () => openAttachmentsModal(item),
            },
            {
              key: "qr",
              label: "QR",
              onClick: () => openQrModal(item),
            },
            { type: "divider" },
            item.is_active
              ? {
                  key: "deactivate",
                  label: "Deactivate",
                  disabled: !canApproveDeletion || saving,
                  danger: true,
                  onClick: () =>
                    Modal.confirm({
                      title: "Deactivate item?",
                      content: "This hides the item from active inventory operations but preserves history.",
                      okText: "Deactivate",
                      okButtonProps: { danger: true },
                      onOk: async () => {
                        try {
                          await deactivateItem(item.id);
                          message.success("Item deactivated");
                          await refresh();
                        } catch (err: any) {
                          setListError(getApiErrorMessage(err, "Failed to deactivate item"));
                        }
                      }
                    }),
                }
              : {
                  key: "reactivate",
                  label: "Reactivate",
                  disabled: !canApproveDeletion || saving,
                  onClick: async () => {
                    try {
                      await reactivateItem(item.id);
                      message.success("Item reactivated");
                      await refresh();
                    } catch (err: any) {
                      setListError(getApiErrorMessage(err, "Failed to reactivate item"));
                    }
                  },
                },
            {
              key: "delete",
              label: "Delete",
              danger: true,
              disabled: !canApproveDeletion || saving,
              onClick: () =>
                Modal.confirm({
                  title: "Permanently delete item?",
                  content: "This is irreversible. If the item has stock history, deletion will be blocked.",
                  okText: "Delete",
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    try {
                      await hardDeleteItem(item.id);
                      message.success("Item deleted");
                      await refresh();
                    } catch (err: any) {
                      setListError(getApiErrorMessage(err, "Failed to delete item"));
                    }
                  }
                }),
            },
          ];
          return (
            <Dropdown menu={{ items: menuItems }} trigger={["click"]}>
              <Button icon={<MoreOutlined />} className="row-action-btn">Manage</Button>
            </Dropdown>
          );
        }
      }
    ];
  }, [canApproveDeletion, categoryNameById, direction, lowOnly, refresh, saving, sort, suppliersById]);

  const mobileItemCards = useMemo(
    () =>
      items.map((item) => (
        <Card key={item.id} className="mobile-item-card">
          <div className="mobile-item-card-head">
            <div>
              <Typography.Title level={5} style={{ margin: 0 }}>
                {item.name}
              </Typography.Title>
              <Typography.Text type="secondary">{item.sku}</Typography.Text>
            </div>
            <Space>
              {isLowStock(item) ? <Tag color="red">Low</Tag> : <Tag color="green">OK</Tag>}
              {!item.is_active ? <Tag>Inactive</Tag> : null}
            </Space>
          </div>
          <div className="mobile-item-card-grid">
            <div>
              <div className="mobile-metric-label">On Hand</div>
              <div className="mobile-metric-value">{item.quantity_on_hand}</div>
            </div>
            <div>
              <div className="mobile-metric-label">Min</div>
              <div className="mobile-metric-value">{item.min_quantity}</div>
            </div>
            <div>
              <div className="mobile-metric-label">Tracking</div>
              <div className="mobile-metric-value">{item.tracking_type ?? "BATCH"}</div>
            </div>
            <div>
              <div className="mobile-metric-label">Unit Price</div>
              <div className="mobile-metric-value">{formatMoney(item.unit_price)}</div>
            </div>
          </div>
          <Space wrap style={{ marginTop: 10 }}>
            <Button size="middle" onClick={() => startEdit(item)}>
              Edit
            </Button>
            <Button size="middle" onClick={() => openStockModal(item)}>
              Stock
            </Button>
            <Button size="middle" onClick={() => openAttachmentsModal(item)}>
              Files
            </Button>
            <Button size="middle" onClick={() => openQrModal(item)}>
              QR
            </Button>
          </Space>
        </Card>
      )),
    [items]
  );

  const reorderColumns = useMemo(
    () => [
      { title: "SKU", dataIndex: "sku", key: "sku" },
      { title: "Item", dataIndex: "name", key: "name" },
      { title: "On hand", dataIndex: "quantity_on_hand", key: "quantity_on_hand" },
      { title: "Min", dataIndex: "min_quantity", key: "min_quantity" },
      {
        title: "Reorder qty",
        key: "reorder_qty",
        render: (_: unknown, item: Item) => (
          <InputNumber
            min={0}
            value={reorderQuantities[item.id] ?? 0}
            onChange={(value) =>
              setReorderQuantities((prev) => ({
                ...prev,
                [item.id]: Number(value) || 0
              }))
            }
          />
        )
      }
    ],
    [reorderQuantities]
  );
  const pagedReorderItems = useMemo(() => {
    const start = (reorderPage - 1) * reorderPageSize;
    return reorderItems.slice(start, start + reorderPageSize);
  }, [reorderItems, reorderPage, reorderPageSize]);

  const transactionColumns = useMemo(
    () => [
      { title: "Date", dataIndex: "created_at", key: "created_at", render: (value: string) => formatDateTime(value) },
      { title: "Type", dataIndex: "transaction_type", key: "transaction_type" },
      { title: "Delta", dataIndex: "quantity_delta", key: "quantity_delta", render: (value: number) => formatDelta(value) },
      {
        title: "By",
        dataIndex: "created_by_user_id",
        key: "created_by_user_id",
        render: (value: number | null) =>
          value ? usersById.get(value) ?? "Unknown user" : ""
      },
      {
        title: "Supplier",
        dataIndex: "supplier_id",
        key: "supplier_id",
        render: (value: number | null) => (value ? suppliersById.get(value)?.name ?? value : "")
      },
      { title: "Notes", dataIndex: "notes", key: "notes", render: (value: string | null) => value ?? "" }
    ],
    [suppliersById, usersById]
  );

  const [instancesItem, setInstancesItem] = useState<Item | null>(null);
  const [instances, setInstances] = useState<ItemInstance[]>([]);
  const [instancesLoading, setInstancesLoading] = useState(false);
  const [instancesError, setInstancesError] = useState<string | null>(null);

  const buildItemsCsv = useCallback(
    (rows: Item[]) =>
      buildCsv(
        ["SKU", "Name", "Supplier", "Qty On Hand", "Min Qty", "Unit Price", "Low Stock", "Description"],
        rows.map((it) => [
          it.sku,
          it.name,
          it.supplier_id ? suppliersById.get(it.supplier_id)?.name ?? it.supplier_id : "",
          it.quantity_on_hand,
          it.min_quantity,
          it.unit_price ?? "",
          isLowStock(it) ? "Yes" : "No",
          it.description ?? ""
        ])
      ),
    [suppliersById]
  );

  const [stockItem, setStockItem] = useState<Item | null>(null);
  const [stockType, setStockType] = useState<StockTransactionType>("IN");
  const [stockQty, setStockQty] = useState("1");
  const [stockSupplierId, setStockSupplierId] = useState<number | "">("");
  const [stockNotes, setStockNotes] = useState("");
  const [stockSaving, setStockSaving] = useState(false);
  const [stockError, setStockError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<StockTransaction[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [txExporting, setTxExporting] = useState(false);

  const [qrItem, setQrItem] = useState<Item | null>(null);
  const [qrSvg, setQrSvg] = useState<string | null>(null);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrError, setQrError] = useState<string | null>(null);
  const [labelWidthMm, setLabelWidthMm] = useState(50);
  const [labelHeightMm, setLabelHeightMm] = useState(30);
  const [instanceQr, setInstanceQr] = useState<{ item: Item; instance: ItemInstance } | null>(null);
  const [instanceQrSvg, setInstanceQrSvg] = useState<string | null>(null);
  const [instanceQrLoading, setInstanceQrLoading] = useState(false);
  const [instanceQrError, setInstanceQrError] = useState<string | null>(null);
  const [instanceLabelWidthMm, setInstanceLabelWidthMm] = useState(50);
  const [instanceLabelHeightMm, setInstanceLabelHeightMm] = useState(30);

  const [bulkQty, setBulkQty] = useState("1");
  const [locationItem, setLocationItem] = useState<Item | null>(null);
  const [locationStocks, setLocationStocks] = useState<LocationStock[]>([]);
  const [locationSaving, setLocationSaving] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [attachmentItem, setAttachmentItem] = useState<Item | null>(null);
  const [attachments, setAttachments] = useState<ProductAttachment[]>([]);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  const loadTransactions = useCallback(async (partId: number) => {
    setTxLoading(true);
    try {
      const tx = await listStockTransactions({ part_id: partId, limit: 25 });
      setTransactions(tx);
    } catch {
      setTransactions([]);
    } finally {
      setTxLoading(false);
    }
  }, []);

  const closeStockModal = useCallback(() => {
    setStockItem(null);
    setStockError(null);
    setTransactions([]);
    setStockNotes("");
    setStockQty("1");
    setStockType("IN");
    setStockSupplierId("");
  }, []);

  useEffect(() => {
    if (!stockItem) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") closeStockModal();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeStockModal, stockItem]);

  async function openStockModal(item: Item) {
    setStockItem(item);
    setStockType("IN");
    setStockQty("1");
    setStockSupplierId(item.supplier_id ?? "");
    setStockNotes("");
    setStockError(null);
    await loadTransactions(item.id);
  }

  function formatDelta(delta: number): string {
    return `${delta > 0 ? "+" : ""}${delta}`;
  }

  const qrDataUrl = useMemo(
    () => (qrSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(qrSvg)}` : ""),
    [qrSvg]
  );
  const qrText = useMemo(() => (qrItem ? `SKU:${qrItem.sku}` : ""), [qrItem]);
  const instanceQrDataUrl = useMemo(
    () => (instanceQrSvg ? `data:image/svg+xml;utf8,${encodeURIComponent(instanceQrSvg)}` : ""),
    [instanceQrSvg]
  );
  const instanceQrText = useMemo(
    () => (instanceQr ? `SERIAL:${instanceQr.instance.serial_number}` : ""),
    [instanceQr]
  );

  function handlePrintLabel() {
    if (!qrItem || !qrSvg) return;
    const width = Math.max(20, labelWidthMm);
    const height = Math.max(20, labelHeightMm);
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) return;
    win.document.write(`<!doctype html>
<html>
<head>
  <title>Print Label</title>
  <style>
    @page { size: ${width}mm ${height}mm; margin: 2mm; }
    html, body { margin: 0; padding: 0; width: ${width}mm; height: ${height}mm; }
    .label { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; font-family: Arial, sans-serif; }
    .sku { margin-top: 2mm; font-size: 10pt; text-align: center; }
    img { width: min(${width - 6}mm, ${height - 10}mm); height: auto; }
  </style>
</head>
<body>
  <div class="label">
    <img src="${qrDataUrl}" alt="QR" />
    <div class="sku">${qrText}</div>
  </div>
</body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  async function handleDownloadLabelPdf() {
    if (!qrItem) return;
    try {
      const blob = await downloadItemLabelPdf(qrItem.id, { width_mm: labelWidthMm, height_mm: labelHeightMm });
      downloadBlob(`label-${qrItem.sku}.pdf`, blob);
    } catch (err: any) {
      setQrError(getApiErrorMessage(err, "Failed to download label PDF"));
    }
  }

  function handlePrintInstanceLabel() {
    if (!instanceQr || !instanceQrSvg) return;
    const width = Math.max(20, instanceLabelWidthMm);
    const height = Math.max(20, instanceLabelHeightMm);
    const win = window.open("", "_blank", "width=800,height=600");
    if (!win) return;
    win.document.write(`<!doctype html>
<html>
<head>
  <title>Print Label</title>
  <style>
    @page { size: ${width}mm ${height}mm; margin: 2mm; }
    html, body { margin: 0; padding: 0; width: ${width}mm; height: ${height}mm; }
    .label { display: flex; flex-direction: column; align-items: center; justify-content: center; width: 100%; height: 100%; font-family: Arial, sans-serif; }
    .sku { margin-top: 2mm; font-size: 10pt; text-align: center; }
    img { width: min(${width - 6}mm, ${height - 10}mm); height: auto; }
  </style>
</head>
<body>
  <div class="label">
    <img src="${instanceQrDataUrl}" alt="QR" />
    <div class="sku">${instanceQrText}</div>
  </div>
</body>
</html>`);
    win.document.close();
    win.focus();
    win.print();
    win.close();
  }

  async function handleDownloadInstanceLabelPdf() {
    if (!instanceQr) return;
    try {
      const blob = await downloadItemInstanceLabelPdf(instanceQr.instance.id, {
        width_mm: instanceLabelWidthMm,
        height_mm: instanceLabelHeightMm
      });
      downloadBlob(`label-${instanceQr.instance.serial_number}.pdf`, blob);
    } catch (err: any) {
      setInstanceQrError(getApiErrorMessage(err, "Failed to download instance label PDF"));
    }
  }

  const openQrModal = useCallback(
    async (item: Item) => {
      setQrItem(item);
      setQrSvg(null);
      setQrError(null);
      setQrLoading(true);
      try {
        const svg = await getItemQrSvg(item.id);
        setQrSvg(svg);
      } catch (err: any) {
        setQrError(getApiErrorMessage(err, "Failed to load QR code"));
      } finally {
        setQrLoading(false);
      }
    },
    []
  );

  const openInstanceQrModal = useCallback(async (item: Item, instance: ItemInstance) => {
    setInstanceQr({ item, instance });
    setInstanceQrSvg(null);
    setInstanceQrError(null);
    setInstanceQrLoading(true);
    try {
      const svg = await getItemInstanceQrSvg(instance.id);
      setInstanceQrSvg(svg);
    } catch (err: any) {
      setInstanceQrError(getApiErrorMessage(err, "Failed to load QR code"));
    } finally {
      setInstanceQrLoading(false);
    }
  }, []);

  const closeQrModal = useCallback(() => {
    setQrItem(null);
    setQrSvg(null);
    setQrError(null);
    setQrLoading(false);
    setLabelWidthMm(50);
    setLabelHeightMm(30);
  }, []);

  const closeInstanceQrModal = useCallback(() => {
    setInstanceQr(null);
    setInstanceQrSvg(null);
    setInstanceQrError(null);
    setInstanceQrLoading(false);
    setInstanceLabelWidthMm(50);
    setInstanceLabelHeightMm(30);
  }, []);

  const loadInstances = useCallback(async (itemId: number) => {
    setInstancesLoading(true);
    setInstancesError(null);
    try {
      setInstances(await listItemInstances(itemId));
    } catch (err: any) {
      setInstancesError(getApiErrorMessage(err, "Failed to load instances"));
    } finally {
      setInstancesLoading(false);
    }
  }, []);

  const openInstancesModal = useCallback(
    async (item: Item) => {
      setInstancesItem(item);
      setBulkQty("1");
      await loadInstances(item.id);
    },
    [loadInstances]
  );

  const openLocationModal = useCallback(
    async (item: Item) => {
      setLocationItem(item);
      setLocationError(null);
      setLocationSaving(false);
      try {
        const stocks = await listItemLocations(item.id);
        const map = new Map(stocks.map((s) => [s.location_id, s]));
        const combined = locations.map((loc) => ({
          location_id: loc.id,
          location_name: loc.name,
          quantity_on_hand: map.get(loc.id)?.quantity_on_hand ?? 0
        }));
        setLocationStocks(combined);
      } catch (err: any) {
        setLocationError(getApiErrorMessage(err, "Failed to load item locations"));
        setLocationStocks([]);
      }
    },
    [locations]
  );

  const closeInstancesModal = useCallback(() => {
    setInstancesItem(null);
    setInstances([]);
    setInstancesError(null);
    setInstancesLoading(false);
  }, []);

  const closeLocationModal = useCallback(() => {
    setLocationItem(null);
    setLocationStocks([]);
    setLocationError(null);
    setLocationSaving(false);
  }, []);

  async function openAttachmentsModal(item: Item) {
    setAttachmentItem(item);
    setAttachmentError(null);
    setAttachmentUploading(false);
    try {
      const rows = await listItemAttachments(item.id);
      setAttachments(rows);
    } catch (err: any) {
      setAttachmentError(getApiErrorMessage(err, "Failed to load attachments"));
      setAttachments([]);
    }
  }

  function closeAttachmentsModal() {
    setAttachmentItem(null);
    setAttachments([]);
    setAttachmentError(null);
    setAttachmentUploading(false);
  }

  async function handleUploadAttachment(file: File) {
    if (!attachmentItem) return;
    setAttachmentUploading(true);
    setAttachmentError(null);
    try {
      await uploadItemAttachment(attachmentItem.id, file);
      const rows = await listItemAttachments(attachmentItem.id);
      setAttachments(rows);
      message.success("Attachment uploaded");
    } catch (err: any) {
      setAttachmentError(getApiErrorMessage(err, "Failed to upload attachment"));
    } finally {
      setAttachmentUploading(false);
    }
  }

  async function handleDownloadAttachment(attachment: ProductAttachment) {
    if (!attachmentItem) return;
    try {
      const blob = await downloadItemAttachment(attachmentItem.id, attachment.id);
      downloadBlob(attachment.file_name, blob);
    } catch (err: any) {
      setAttachmentError(getApiErrorMessage(err, "Failed to download attachment"));
    }
  }

  async function handleDeleteAttachment(attachment: ProductAttachment) {
    if (!attachmentItem) return;
    try {
      await deleteItemAttachment(attachmentItem.id, attachment.id);
      setAttachments((prev) => prev.filter((x) => x.id !== attachment.id));
      message.success("Attachment deleted");
    } catch (err: any) {
      setAttachmentError(getApiErrorMessage(err, "Failed to delete attachment"));
    }
  }

  async function handleSaveLocations() {
    if (!locationItem) return;
    setLocationSaving(true);
    setLocationError(null);
    try {
      await updateItemLocations(
        locationItem.id,
        locationStocks.map((s) => ({ location_id: s.location_id, quantity_on_hand: s.quantity_on_hand }))
      );
      message.success("Locations updated");
      await refresh();
      closeLocationModal();
    } catch (err: any) {
      setLocationError(getApiErrorMessage(err, "Failed to update locations"));
    } finally {
      setLocationSaving(false);
    }
  }

  function updateLocationQty(locationId: number, qty: number) {
    setLocationStocks((prev) =>
      prev.map((row) =>
        row.location_id === locationId ? { ...row, quantity_on_hand: Math.max(0, qty) } : row
      )
    );
  }

  async function handleBulkCreate() {
    if (!instancesItem) return;
    const qty = toInt(bulkQty);
    if (qty === null || qty <= 0) {
      setInstancesError("Quantity must be a whole number > 0");
      return;
    }
    setInstancesLoading(true);
    setInstancesError(null);
    try {
      await bulkCreateItemInstances(instancesItem.id, { quantity: qty });
      await loadInstances(instancesItem.id);
      await refresh();
      message.success("Instances created");
    } catch (err: any) {
      setInstancesError(getApiErrorMessage(err, "Failed to create instances"));
    } finally {
      setInstancesLoading(false);
    }
  }

  async function exportCurrentView() {
    setReportError(null);
    const csv = buildItemsCsv(items);
    const label = lowOnly ? "low-stock" : "current-view";
    downloadTextFile(`inventory-${label}.csv`, csv, "text/csv");
  }

  async function exportAllItems() {
    setReporting(true);
    setReportError(null);
    try {
      const all: Item[] = [];
      let pageCursor = 1;
      let totalItems = 0;
      while (true) {
        const data = await listItems({
          page: pageCursor,
          page_size: 100,
          q: q || undefined,
          sort,
          direction
        });
        totalItems = data.total;
        all.push(...data.items);
        if (all.length >= totalItems || data.items.length === 0) break;
        pageCursor += 1;
      }
      const csv = buildItemsCsv(all);
      downloadTextFile("inventory-all.csv", csv, "text/csv");
    } catch (err: any) {
      setReportError(getApiErrorMessage(err, "Failed to export inventory"));
    } finally {
      setReporting(false);
    }
  }

  async function exportLowStock() {
    setReporting(true);
    setReportError(null);
    try {
      const low = await listLowStock({ limit: 500, q: q || undefined });
      const csv = buildItemsCsv(low);
      downloadTextFile("inventory-low-stock.csv", csv, "text/csv");
    } catch (err: any) {
      setReportError(getApiErrorMessage(err, "Failed to export low stock"));
    } finally {
      setReporting(false);
    }
  }

  async function handleCreateReorderRequest() {
    setReorderError(null);
    const lines = reorderItems
      .map((item) => ({ part_id: item.id, quantity: reorderQuantities[item.id] || 0 }))
      .filter((line) => line.quantity > 0);
    if (lines.length === 0) {
      setReorderError("Add at least one reorder quantity.");
      return;
    }
    setReorderSubmitting(true);
    try {
      await createRequest({ lines });
      message.success("Reorder request created");
      await refresh();
    } catch (err: any) {
      setReorderError(getApiErrorMessage(err, "Failed to create reorder request"));
    } finally {
      setReorderSubmitting(false);
    }
  }

  function downloadImportTemplate() {
    const headers = [
      "sku",
      "name",
      "image_url",
      "description",
      "unit_price",
      "quantity_on_hand",
      "min_quantity",
      "tracking_type",
      "unit_of_measure",
      "category",
      "location",
      "supplier"
    ];
    downloadTextFile("inventory-import-template.csv", buildCsv(headers, []), "text/csv");
  }

  function findHeaderIndex(headers: string[], keys: string[]): number {
    for (const key of keys) {
      const idx = headers.indexOf(key);
      if (idx >= 0) return idx;
    }
    return -1;
  }

  async function handleImportFile(file: File) {
    setImporting(true);
    setImportErrors([]);
    setImportSummary(null);
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length === 0) {
        setImportErrors(["No rows found in the CSV."]);
        return;
      }
      const headers = rows[0].map(normalizeHeader);
      const idxName = findHeaderIndex(headers, ["name", "item_name", "item_description", "description", "item"]);
      if (idxName < 0) {
        setImportErrors(["CSV must include a name column. SKU is optional and will be auto-generated if missing."]);
        return;
      }
      const idxDescription = findHeaderIndex(headers, ["description", "desc"]);
      const idxImageUrl = findHeaderIndex(headers, ["image_url", "image", "picture_link", "picture_links"]);
      const idxUnitPrice = findHeaderIndex(headers, ["unit_price", "unitprice", "price"]);
      const idxQty = findHeaderIndex(headers, ["quantity_on_hand", "qty_on_hand", "qty"]);
      const idxMin = findHeaderIndex(headers, ["min_quantity", "min_qty", "min"]);
      const idxTracking = findHeaderIndex(headers, ["tracking_type", "tracking"]);
      const idxUom = findHeaderIndex(headers, ["unit_of_measure", "uom", "unit"]);
      const idxCategoryId = findHeaderIndex(headers, ["category_id"]);
      const idxCategory = findHeaderIndex(headers, ["category"]);
      const idxLocationId = findHeaderIndex(headers, ["location_id"]);
      const idxLocation = findHeaderIndex(headers, ["location"]);
      const idxSupplierId = findHeaderIndex(headers, ["supplier_id"]);
      const idxSupplier = findHeaderIndex(headers, ["supplier"]);

      let created = 0;
      const errors: string[] = [];

      for (let i = 1; i < rows.length; i += 1) {
        const row = rows[i];
        if (row.every((cell) => cell.trim() === "")) continue;
        const name = (row[idxName] ?? "").trim();
        if (!name) {
          errors.push(`Row ${i + 1}: name is required.`);
          continue;
        }
        const description = idxDescription >= 0 ? (row[idxDescription] ?? "").trim() : "";
        const imageUrlRaw = idxImageUrl >= 0 ? (row[idxImageUrl] ?? "").trim() : "";
        const unitPriceRaw = idxUnitPrice >= 0 ? (row[idxUnitPrice] ?? "").trim() : "";
        const qtyRaw = idxQty >= 0 ? (row[idxQty] ?? "").trim() : "";
        const minRaw = idxMin >= 0 ? (row[idxMin] ?? "").trim() : "";
        const trackingRaw = idxTracking >= 0 ? (row[idxTracking] ?? "").trim() : "";
        const uomRaw = idxUom >= 0 ? (row[idxUom] ?? "").trim() : "";

        const unitPrice = unitPriceRaw ? toFloat(unitPriceRaw) : null;
        if (unitPriceRaw && unitPrice === null) {
          errors.push(`Row ${i + 1}: invalid unit_price.`);
          continue;
        }
        const qty = qtyRaw ? toInt(qtyRaw) : 0;
        if (qtyRaw && qty === null) {
          errors.push(`Row ${i + 1}: invalid quantity_on_hand.`);
          continue;
        }
        const minQty = minRaw ? toInt(minRaw) : 0;
        if (minRaw && minQty === null) {
          errors.push(`Row ${i + 1}: invalid min_quantity.`);
          continue;
        }
        const trackingType = trackingRaw ? trackingRaw.toUpperCase() : "BATCH";
        if (!["BATCH", "INDIVIDUAL"].includes(trackingType)) {
          errors.push(`Row ${i + 1}: tracking_type must be BATCH or INDIVIDUAL.`);
          continue;
        }

        let categoryId: number | null = null;
        if (idxCategoryId >= 0 && (row[idxCategoryId] ?? "").trim()) {
          const parsed = toInt((row[idxCategoryId] ?? "").trim());
          if (parsed === null) {
            errors.push(`Row ${i + 1}: invalid category_id.`);
            continue;
          }
          categoryId = parsed;
        } else if (idxCategory >= 0 && (row[idxCategory] ?? "").trim()) {
          const key = (row[idxCategory] ?? "").trim().toLowerCase();
          const found = categoryIdByName.get(key);
          if (!found) {
            errors.push(`Row ${i + 1}: category '${row[idxCategory]}' not found.`);
            continue;
          }
          categoryId = found;
        }

        let locationId: number | null = null;
        if (idxLocationId >= 0 && (row[idxLocationId] ?? "").trim()) {
          const parsed = toInt((row[idxLocationId] ?? "").trim());
          if (parsed === null) {
            errors.push(`Row ${i + 1}: invalid location_id.`);
            continue;
          }
          locationId = parsed;
        } else if (idxLocation >= 0 && (row[idxLocation] ?? "").trim()) {
          const key = (row[idxLocation] ?? "").trim().toLowerCase();
          const found = locationIdByName.get(key);
          if (!found) {
            errors.push(`Row ${i + 1}: location '${row[idxLocation]}' not found.`);
            continue;
          }
          locationId = found;
        }

        let supplierId: number | null = null;
        if (idxSupplierId >= 0 && (row[idxSupplierId] ?? "").trim()) {
          const parsed = toInt((row[idxSupplierId] ?? "").trim());
          if (parsed === null) {
            errors.push(`Row ${i + 1}: invalid supplier_id.`);
            continue;
          }
          supplierId = parsed;
        } else if (idxSupplier >= 0 && (row[idxSupplier] ?? "").trim()) {
          const key = (row[idxSupplier] ?? "").trim().toLowerCase();
          const found = supplierIdByName.get(key);
          if (!found) {
            errors.push(`Row ${i + 1}: supplier '${row[idxSupplier]}' not found.`);
            continue;
          }
          supplierId = found;
        }

        try {
          await createItem({
            name,
            image_url: imageUrlRaw || null,
            description: description || null,
            unit_price: unitPrice,
            quantity_on_hand: qty ?? 0,
            min_quantity: minQty ?? 0,
            tracking_type: trackingType,
            unit_of_measure: uomRaw || null,
            category_id: categoryId,
            location_id: locationId,
            supplier_id: supplierId
          });
          created += 1;
        } catch (err: any) {
          errors.push(`Row ${i + 1}: ${getApiErrorMessage(err, "Failed to import item")}`);
        }
      }

      setImportErrors(errors);
      setImportSummary({ created, failed: errors.length });
      setImportSkipped(null);
      if (created > 0) {
        message.success(`Imported ${created} item(s)`);
        await refresh();
      }
    } finally {
      setImporting(false);
    }
  }

  async function handleImportXlsx(file: File) {
    setImporting(true);
    setImportErrors([]);
    setImportSummary(null);
    setImportSkipped(null);
    try {
      const summary = await importInventoryXlsx(file);
      setImportSummary({ created: summary.created, failed: summary.failed });
      setImportSkipped(summary.skipped);
      setImportErrors(summary.errors || []);
      if (summary.created > 0) {
        message.success(`Imported ${summary.created} item(s) from Excel`);
        await refresh();
      }
    } catch (err: any) {
      setImportErrors([getApiErrorMessage(err, "Failed to import Excel inventory")]);
    } finally {
      setImporting(false);
    }
  }

  async function handleNormalizeSkus() {
    setNormalizingSkus(true);
    try {
      const result = await normalizeExistingSkus();
      message.success(`Normalized SKUs: ${result.changed} updated out of ${result.total_items}.`);
      await refresh();
    } catch (err: any) {
      message.error(getApiErrorMessage(err, "Failed to normalize existing SKUs"));
    } finally {
      setNormalizingSkus(false);
    }
  }

  async function exportTransactions() {
    if (!stockItem) return;
    setTxExporting(true);
    setStockError(null);
    try {
      const tx = await listStockTransactions({ part_id: stockItem.id, limit: 200 });
      const csv = buildCsv(
        ["Date", "Type", "Delta", "Supplier", "Notes"],
        tx.map((t) => [
          formatDateTime(t.created_at),
          t.transaction_type,
          t.quantity_delta,
          t.supplier_id ? suppliersById.get(t.supplier_id)?.name ?? t.supplier_id : "",
          t.notes ?? ""
        ])
      );
      downloadTextFile(`stock-transactions-${stockItem.sku}.csv`, csv, "text/csv");
    } catch (err: any) {
      setStockError(getApiErrorMessage(err, "Failed to export transactions"));
    } finally {
      setTxExporting(false);
    }
  }

  async function handlePostStock() {
    if (!stockItem) return;

    setStockError(null);
    const qty = toInt(stockQty);
    if (qty === null) {
      setStockError(stockType === "ADJUST" ? "Adjust by must be a whole number" : "Quantity must be a whole number");
      return;
    }

    let delta: number;
    if (stockType === "IN") {
      if (qty <= 0) {
        setStockError("Receive quantity must be > 0");
        return;
      }
      delta = qty;
    } else if (stockType === "OUT") {
      if (qty <= 0) {
        setStockError("Issue quantity must be > 0");
        return;
      }
      delta = -qty;
    } else {
      if (qty === 0) {
        setStockError("Adjust by must be non-zero");
        return;
      }
      delta = qty;
    }

    setStockSaving(true);
    try {
      const tx = await createStockTransaction({
        part_id: stockItem.id,
        transaction_type: stockType,
        quantity_delta: delta,
        supplier_id: stockSupplierId === "" ? null : Number(stockSupplierId),
        notes: stockNotes.trim() || null
      });

      setStockItem((prev) => (prev ? { ...prev, quantity_on_hand: prev.quantity_on_hand + tx.quantity_delta } : prev));
      setStockNotes("");
      setStockQty("1");
      await loadTransactions(stockItem.id);
      await refresh();
      message.success("Stock transaction posted");
    } catch (err: any) {
      setStockError(getApiErrorMessage(err, "Failed to post stock transaction"));
    } finally {
      setStockSaving(false);
    }
  }

  const instanceColumns = useMemo(
    () => [
      { title: "Serial", dataIndex: "serial_number", key: "serial_number" },
      { title: "Status", dataIndex: "status", key: "status" },
      {
        title: "Created",
        dataIndex: "created_at",
        key: "created_at",
        render: (value: string) => formatDateTime(value)
      },
      {
        title: "Actions",
        key: "actions",
        render: (_: unknown, row: ItemInstance) => (
          <Space>
            {instancesItem ? (
              <Button onClick={() => openInstanceQrModal(instancesItem, row)}>QR</Button>
            ) : null}
          </Space>
        )
      }
    ],
    [instancesItem, openInstanceQrModal]
  );

  return (
    <div className="container page-shell">
      <div className="page-topbar">
        <div className="page-heading">
          <Typography.Title level={2} style={{ marginTop: 0 }}>
            Inventory
          </Typography.Title>
          <Typography.Text type="secondary" className="page-subtitle">
            Monitor stock, process receipts/issues, and manage item master data with audit-ready tracking.
          </Typography.Text>
        </div>
        <Space wrap className="page-quick-actions">
          <Button
            onClick={() => {
              if (showItemForm) {
                resetForm();
                return;
              }
              setShowItemForm(true);
            }}
          >
            {showItemForm ? (editing ? "Editing Item" : "Hide Add Item") : "Add New Item"}
          </Button>
          <Button onClick={refresh} disabled={loading}>
            Refresh
          </Button>
          <Button onClick={() => setQuickCreateOpen(true)}>Quick Add</Button>
          <Button onClick={exportCurrentView} disabled={loading || items.length === 0} type="primary">
            Export current view
          </Button>
        </Space>
      </div>
      <div className="grid stagger-group">
        {false ? <Card title="Inventory Guide" className="inventory-guide-card" style={{ gridColumn: "1 / -1" }}>
          <Typography.Paragraph className="muted" style={{ marginTop: 0 }}>
            This module manages items (parts), suppliers, and stock movements.
          </Typography.Paragraph>
          <div className="inventory-guide-grid">
            <div className="guide-block">
              <div className="guide-kicker">Concept</div>
              <Typography.Title level={5} className="guide-title">
                Item
              </Typography.Title>
              <Typography.Text className="muted">
                An item (also called a "part") is tracked in inventory.
              </Typography.Text>
              <ul className="guide-list">
                <li>SKU (auto-generated by system)</li>
                <li>Name</li>
                <li>Description</li>
                <li>Unit price (optional)</li>
                <li>Quantity on hand (current stock)</li>
                <li>Min quantity (low-stock threshold)</li>
                <li>Supplier (optional)</li>
                <li>Tracking type (Batch / Individual)</li>
                <li>Unit of measure</li>
                <li>Category</li>
                <li>Location</li>
              </ul>
            </div>

            <div className="guide-block">
              <div className="guide-kicker">Concept</div>
              <Typography.Title level={5} className="guide-title">
                Supplier
              </Typography.Title>
              <Typography.Text className="muted">A supplier is a vendor you buy inventory from.</Typography.Text>
              <ul className="guide-list">
                <li>Name (unique)</li>
                <li>Contact info (optional)</li>
                <li>Notes (optional)</li>
              </ul>
            </div>

            <div className="guide-block">
              <div className="guide-kicker">Concept</div>
              <Typography.Title level={5} className="guide-title">
                Stock transaction
              </Typography.Title>
              <Typography.Text className="muted">
                Every stock change is recorded as a transaction to keep an audit trail.
              </Typography.Text>
              <ul className="guide-list">
                <li>
                  <Typography.Text code>IN</Typography.Text> receiving stock (increases on-hand)
                </li>
                <li>
                  <Typography.Text code>OUT</Typography.Text> issuing stock (decreases on-hand)
                </li>
                <li>
                  <Typography.Text code>ADJUST</Typography.Text> correction (can increase or decrease)
                </li>
              </ul>
            </div>

            <div className="guide-block">
              <div className="guide-kicker">Workflow</div>
              <Typography.Title level={5} className="guide-title">
                Common workflows
              </Typography.Title>
              <ul className="guide-list">
                <li>Create an item</li>
                <li>Set a reorder point (min quantity)</li>
                <li>Receive stock against an item (creates an IN transaction)</li>
                <li>Issue stock (creates an OUT transaction)</li>
                <li>Investigate why on-hand changed (review transaction history)</li>
                <li>View low-stock list (items where on-hand is below threshold)</li>
                <li>Generate item QR codes for labels or quick lookup</li>
                <li>Export inventory reports (CSV)</li>
              </ul>
            </div>

            <div className="guide-block">
              <div className="guide-kicker">Behavior</div>
              <Typography.Title level={5} className="guide-title">
                Low-stock behavior
              </Typography.Title>
              <Typography.Text className="muted">An item is considered low stock when:</Typography.Text>
              <div className="guide-inline">
                <Typography.Text code>quantity_on_hand &lt;= min_quantity</Typography.Text>
              </div>
            </div>

            <div className="guide-block">
              <div className="guide-kicker">Tools</div>
              <Typography.Title level={5} className="guide-title">
                QR codes
              </Typography.Title>
              <ul className="guide-list">
                <li>Each item can generate a QR code that encodes its SKU (format: SKU:&lt;value&gt;).</li>
                <li>Individually tracked items also have per-instance QR codes (format: SERIAL:&lt;value&gt;).</li>
                <li>Use labels for quick scanning in the store or at job sites.</li>
              </ul>
            </div>

            <div className="guide-block">
              <div className="guide-kicker">Reports</div>
              <Typography.Title level={5} className="guide-title">
                Inventory exports
              </Typography.Title>
              <ul className="guide-list">
                <li>Current view (filters/search applied)</li>
                <li>All items</li>
                <li>Low stock only</li>
                <li>Stock transactions can be exported per item from the stock modal</li>
              </ul>
            </div>
          </div>
        </Card> : null}
        {showItemForm ? (
        <Card title={editing ? "Edit item" : "Add item"} style={{ gridColumn: "1 / -1" }}>
          <Form layout="vertical" onFinish={handleSave}>
            <div className="grid">
              <Form.Item label="SKU">
                <Input value={editing ? sku : "Auto-generated by system"} disabled />
              </Form.Item>
              <Form.Item label="Name" required>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </Form.Item>
              <Form.Item label="Description" style={{ gridColumn: "1 / -1" }}>
                <Input.TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
              </Form.Item>
              <Form.Item label="Image URL" required style={{ gridColumn: "1 / -1" }}>
                <Input
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://.../spare-image.jpg"
                />
              </Form.Item>
              {imageUrl.trim() ? (
                <div style={{ gridColumn: "1 / -1", marginBottom: 8 }}>
                  <img
                    src={imageUrl}
                    alt={name || "Item preview"}
                    loading="lazy"
                    decoding="async"
                    style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 10, border: "1px solid rgba(255,255,255,0.18)" }}
                  />
                </div>
              ) : null}
              <Form.Item label="Tracking">
                <Select value={trackingType} onChange={(value) => setTrackingType(value)}>
                  <Select.Option value="BATCH">Batch/Quantity</Select.Option>
                  <Select.Option value="INDIVIDUAL">Individual (Serialized)</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="Unit of measure">
                <Input value={unitOfMeasure} onChange={(e) => setUnitOfMeasure(e.target.value)} placeholder="e.g. pcs" />
              </Form.Item>
              <Form.Item label="Category" style={{ gridColumn: "1 / -1" }}>
                <Select<number>
                  value={categoryId === "" ? undefined : categoryId}
                  onChange={(value) => setCategoryId(value ?? "")}
                  placeholder="Uncategorized"
                  allowClear
                >
                  {categories.map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Supplier (optional)" style={{ gridColumn: "1 / -1" }}>
                <Select<number>
                  value={supplierId === "" ? undefined : supplierId}
                  onChange={(value) => setSupplierId(value ?? "")}
                  placeholder="None"
                  allowClear
                >
                  {suppliers.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.is_active ? s.name : `${s.name} (inactive)`}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Location" style={{ gridColumn: "1 / -1" }}>
                <Select<number>
                  value={locationId === "" ? undefined : locationId}
                  onChange={(value) => setLocationId(value ?? "")}
                  placeholder="Not set"
                  allowClear
                >
                  {locations.map((l) => (
                    <Select.Option key={l.id} value={l.id}>
                      {l.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Unit price">
                <Input
                  value={unitPrice}
                  onChange={(e) => setUnitPrice(e.target.value)}
                  inputMode="decimal"
                  placeholder="e.g. 12.50"
                />
              </Form.Item>
              <Form.Item label="Qty on hand">
                <Input value={quantityOnHand} onChange={(e) => setQuantityOnHand(e.target.value)} inputMode="numeric" />
              </Form.Item>
              <Form.Item label="Min qty">
                <Input value={minQuantity} onChange={(e) => setMinQuantity(e.target.value)} inputMode="numeric" />
              </Form.Item>
            </div>

            {formError ? <Typography.Text type="danger">{formError}</Typography.Text> : null}

            <Space style={{ marginTop: 12 }}>
              <Button type="primary" htmlType="submit" disabled={saving}>
                {editing ? "Save changes" : "Create item"}
              </Button>
              <Button onClick={resetForm} disabled={saving}>
                Cancel
              </Button>
            </Space>
          </Form>
        </Card>
        ) : null}

        <Card
          title="Item list"
          className={inventoryPulse ? "success-pulse" : undefined}
          style={{ gridColumn: "1 / -1" }}
          extra={
            isMobile ? (
              <Space>
                <Button icon={<FilterOutlined />} onClick={() => setMobileFiltersOpen(true)}>
                  Filters
                </Button>
                <Button icon={<ReloadOutlined />} onClick={refresh} disabled={loading}>
                  Refresh
                </Button>
              </Space>
            ) : (
              <Button onClick={refresh} disabled={loading}>
                Refresh
              </Button>
            )
          }
        >
          {isMobile ? (
            <Space.Compact style={{ width: "100%", marginTop: 12 }}>
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search SKU or item name"
                onPressEnter={() => {
                  setPage(1);
                  setQ(searchInput.trim());
                }}
              />
              <Button
                type="primary"
                onClick={() => {
                  setPage(1);
                  setQ(searchInput.trim());
                }}
              >
                Search
              </Button>
            </Space.Compact>
          ) : (
            <Form
              layout="inline"
              onFinish={() => {
                setPage(1);
                setQ(searchInput.trim());
              }}
              style={{ marginTop: 12, flexWrap: "wrap" }}
            >
              <Form.Item label="Search">
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search by SKU or name"
                />
              </Form.Item>
              <Form.Item label="Page size">
                <Select<number>
                  value={pageSize}
                  onChange={(value) => {
                    setPage(1);
                    setPageSize(value);
                  }}
                  disabled={lowOnly}
                  style={{ width: 120 }}
                >
                  {[10, 20, 50, 100].map((n) => (
                    <Select.Option key={n} value={n}>
                      {n}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item>
                <Space>
                  <Button htmlType="submit" disabled={loading}>
                    Search
                  </Button>
                  <Button
                    onClick={() => {
                      setSearchInput("");
                      setQ("");
                      setPage(1);
                    }}
                    disabled={loading && items.length === 0}
                  >
                    Clear
                  </Button>
                </Space>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={lowOnly}
                  onChange={(e) => {
                    setPage(1);
                    const checked = e.target.checked;
                    setLowOnly(checked);
                    if (checked) {
                      setInStockOnly(false);
                      setOutOfStockOnly(false);
                    }
                  }}
                >
                  Low stock only
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={inStockOnly}
                  onChange={(e) => {
                    setPage(1);
                    const checked = e.target.checked;
                    setInStockOnly(checked);
                    if (checked) {
                      setLowOnly(false);
                      setOutOfStockOnly(false);
                    }
                  }}
                >
                  In stock only
                </Checkbox>
              </Form.Item>
              <Form.Item>
                <Checkbox
                  checked={outOfStockOnly}
                  onChange={(e) => {
                    setPage(1);
                    const checked = e.target.checked;
                    setOutOfStockOnly(checked);
                    if (checked) {
                      setLowOnly(false);
                      setInStockOnly(false);
                    }
                  }}
                >
                  Out of stock only
                </Checkbox>
              </Form.Item>
              <Form.Item label="Category">
                <Select<number>
                  allowClear
                  value={filterCategoryId === "" ? undefined : filterCategoryId}
                  onChange={(value) => {
                    setPage(1);
                    setFilterCategoryId(value ?? "");
                  }}
                  style={{ minWidth: 180 }}
                >
                  {categories.map((c) => (
                    <Select.Option key={c.id} value={c.id}>
                      {c.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Location">
                <Select<number>
                  allowClear
                  value={filterLocationId === "" ? undefined : filterLocationId}
                  onChange={(value) => {
                    setPage(1);
                    setFilterLocationId(value ?? "");
                  }}
                  style={{ minWidth: 170 }}
                >
                  {locations.map((l) => (
                    <Select.Option key={l.id} value={l.id}>
                      {l.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Supplier">
                <Select<number>
                  allowClear
                  value={filterSupplierId === "" ? undefined : filterSupplierId}
                  onChange={(value) => {
                    setPage(1);
                    setFilterSupplierId(value ?? "");
                  }}
                  style={{ minWidth: 190 }}
                >
                  {suppliers.map((s) => (
                    <Select.Option key={s.id} value={s.id}>
                      {s.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Tracking">
                <Select
                  allowClear
                  value={filterTrackingType || undefined}
                  onChange={(value) => {
                    setPage(1);
                    setFilterTrackingType((value as "BATCH" | "INDIVIDUAL" | undefined) ?? "");
                  }}
                  style={{ width: 150 }}
                >
                  <Select.Option value="BATCH">BATCH</Select.Option>
                  <Select.Option value="INDIVIDUAL">INDIVIDUAL</Select.Option>
                </Select>
              </Form.Item>
              <Form.Item label="Min Price">
                <Input
                  type="number"
                  min={0}
                  value={filterMinPrice}
                  onChange={(e) => setFilterMinPrice(e.target.value)}
                  style={{ width: 120 }}
                />
              </Form.Item>
              <Form.Item label="Max Price">
                <Input
                  type="number"
                  min={0}
                  value={filterMaxPrice}
                  onChange={(e) => setFilterMaxPrice(e.target.value)}
                  style={{ width: 120 }}
                />
              </Form.Item>
              <Form.Item label="Min QOH">
                <Input
                  type="number"
                  min={0}
                  value={filterMinQoh}
                  onChange={(e) => setFilterMinQoh(e.target.value)}
                  style={{ width: 120 }}
                />
              </Form.Item>
              <Form.Item label="Max QOH">
                <Input
                  type="number"
                  min={0}
                  value={filterMaxQoh}
                  onChange={(e) => setFilterMaxQoh(e.target.value)}
                  style={{ width: 120 }}
                />
              </Form.Item>
            </Form>
          )}

          {listError ? <Typography.Text type="danger">{listError}</Typography.Text> : null}

          {isMobile ? (
            <PullToRefresh
              onRefresh={async () => {
                await refresh();
              }}
            >
              <div className="mobile-inventory-list">
                {loading ? (
                  <Typography.Text type="secondary">Loading inventory...</Typography.Text>
                ) : mobileItemCards.length > 0 ? (
                  mobileItemCards
                ) : lowOnly ? (
                  <SmartEmptyState compact title="No low stock items" description="Everything is currently above its minimum threshold." />
                ) : inStockOnly ? (
                  <SmartEmptyState compact title="No in-stock items" description="No items currently have quantity above zero." />
                ) : outOfStockOnly ? (
                  <SmartEmptyState compact title="No out-of-stock items" description="No items currently have quantity at zero." />
                ) : (
                  <SmartEmptyState compact title="No items found" description="Try adjusting filters or create a new item." />
                )}
              </div>
            </PullToRefresh>
          ) : (
            <Table
              className="pro-table"
              rowKey="id"
              loading={loading}
              dataSource={items}
              columns={itemColumns}
              size="small"
              scroll={{ x: 980 }}
              pagination={false}
              locale={{
                emptyText: lowOnly ? (
                  <SmartEmptyState compact title="No low stock items" description="Everything is currently above its minimum threshold." />
                ) : inStockOnly ? (
                  <SmartEmptyState compact title="No in-stock items" description="No items currently have quantity above zero." />
                ) : outOfStockOnly ? (
                  <SmartEmptyState compact title="No out-of-stock items" description="No items currently have quantity at zero." />
                ) : (
                  <SmartEmptyState compact title="No items found" description="Try adjusting filters or create a new item." />
                )
              }}
            />
          )}

          {!loading ? (
            <Space style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
              <Typography.Text type="secondary">
                Page {page} of {totalPages} | Total {total}
              </Typography.Text>
              <Space>
                <Button disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                  Prev
                </Button>
                <Button disabled={loading || page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                  Next
                </Button>
              </Space>
            </Space>
          ) : null}
        </Card>

        <Card title="Reports" style={{ gridColumn: "1 / -1" }}>
          <Typography.Text type="secondary">Export inventory data as CSV for reporting or sharing.</Typography.Text>
          <Space wrap style={{ marginTop: 8 }}>
            <Button onClick={exportCurrentView} disabled={loading || items.length === 0}>
              Export current view
            </Button>
            <Button onClick={exportAllItems} disabled={reporting}>
              Export all items
            </Button>
            <Button onClick={exportLowStock} disabled={reporting}>
              Export low stock
            </Button>
          </Space>
          {reportError ? <Typography.Text type="danger">{reportError}</Typography.Text> : null}
        </Card>

        <Card
          title="Reorder suggestions"
          style={{ gridColumn: "1 / -1" }}
          extra={
            <Button onClick={loadReorder} disabled={reorderLoading}>
              Refresh
            </Button>
          }
        >
          <Typography.Text type="secondary">
            Suggested reorder quantities based on minimum thresholds.
          </Typography.Text>
          <Table
            className="pro-table"
            rowKey="id"
            loading={reorderLoading}
            dataSource={pagedReorderItems}
            columns={reorderColumns}
            pagination={{
              current: reorderPage,
              pageSize: reorderPageSize,
              total: reorderItems.length,
              showSizeChanger: true,
              pageSizeOptions: ["10", "20", "30", "50"],
              onChange: (nextPage, nextPageSize) => {
                setReorderPage(nextPage);
                setReorderPageSize(nextPageSize);
              }
            }}
            style={{ marginTop: 12 }}
            locale={{ emptyText: <SmartEmptyState compact title="No reorder suggestions" description="No items currently require replenishment." /> }}
          />
          <Space style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
            <Typography.Text type="secondary">
              {reorderItems.length} item(s) below threshold
            </Typography.Text>
            <Button
              type="primary"
              onClick={handleCreateReorderRequest}
              disabled={reorderSubmitting || reorderItems.length === 0}
            >
              Create stock request
            </Button>
          </Space>
          {reorderError ? <Typography.Text type="danger">{reorderError}</Typography.Text> : null}
        </Card>

        <Card title="Import items" style={{ gridColumn: "1 / -1" }}>
          <Typography.Text type="secondary">
            Import items from CSV or the existing Excel inventory file. Use the template for correct CSV headers.
          </Typography.Text>
          <Space wrap style={{ marginTop: 8 }}>
            <Button onClick={downloadImportTemplate} disabled={importing}>
              Download template
            </Button>
            <Upload
              accept=".csv"
              showUploadList={false}
              beforeUpload={(file) => {
                handleImportFile(file as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} disabled={importing}>
                {importing ? "Importing..." : "Import CSV"}
              </Button>
            </Upload>
            <Upload
              accept=".xlsx"
              showUploadList={false}
              beforeUpload={(file) => {
                handleImportXlsx(file as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} disabled={importing}>
                {importing ? "Importing..." : "Import Excel (.xlsx)"}
              </Button>
            </Upload>
            {isAdmin ? (
              <Button
                danger
                loading={normalizingSkus}
                onClick={() =>
                  Modal.confirm({
                    title: "Normalize existing SKUs?",
                    content: "This renames all current SKU values to short sequential format (e.g., WP001).",
                    okText: "Normalize",
                    okButtonProps: { danger: true },
                    onOk: () => handleNormalizeSkus(),
                  })
                }
              >
                Normalize Existing SKUs
              </Button>
            ) : null}
          </Space>
          {importSummary ? (
            <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
              Imported {importSummary.created} item(s), {importSummary.failed} failed.
              {importSkipped != null ? ` Skipped ${importSkipped}.` : ""}
            </Typography.Text>
          ) : null}
          {importErrors.length > 0 ? (
            <div style={{ marginTop: 8 }}>
              <Typography.Text type="danger">Import errors:</Typography.Text>
              <ul className="import-error-list">
                {importErrors.slice(0, 10).map((err, idx) => (
                  <li key={idx}>{err}</li>
                ))}
              </ul>
              {importErrors.length > 10 ? (
                <Typography.Text type="secondary">
                  Showing first 10 errors. Fix the CSV and re-upload.
                </Typography.Text>
              ) : null}
            </div>
          ) : null}
        </Card>
      </div>

      <Drawer
        title="Inventory filters"
        placement="bottom"
        height={isMobile ? "72vh" : 420}
        open={isMobile && mobileFiltersOpen}
        onClose={() => setMobileFiltersOpen(false)}
      >
        <Form layout="vertical">
          <Form.Item label="Search">
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by SKU or name"
            />
          </Form.Item>
          <Form.Item label="Page size">
            <Select<number>
              value={pageSize}
              onChange={(value) => {
                setPage(1);
                setPageSize(value);
              }}
              disabled={lowOnly}
            >
              {[10, 20, 50, 100].map((n) => (
                <Select.Option key={n} value={n}>
                  {n}
                </Select.Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item>
            <Checkbox
              checked={lowOnly}
              onChange={(e) => {
                setPage(1);
                setLowOnly(e.target.checked);
              }}
            >
              Low stock only
            </Checkbox>
          </Form.Item>
          <Space>
            <Button
              type="primary"
              onClick={() => {
                setPage(1);
                setQ(searchInput.trim());
                setMobileFiltersOpen(false);
              }}
            >
              Apply filters
            </Button>
            <Button
              onClick={() => {
                setSearchInput("");
                setQ("");
                setPage(1);
                setLowOnly(false);
              }}
            >
              Reset
            </Button>
          </Space>
        </Form>
      </Drawer>

      {isMobile ? (
        <FloatingBubble
          axis="xy"
          magnetic="x"
          className="mobile-fab"
          onClick={() => {
            setShowItemForm(true);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <PlusOutlined />
        </FloatingBubble>
      ) : null}

      <Drawer
        title="Quick Add Item"
        open={quickCreateOpen}
        onClose={() => setQuickCreateOpen(false)}
        width={420}
        destroyOnClose
        className="motion-drawer"
      >
        <Form layout="vertical" onFinish={handleQuickCreateItem}>
          <Form.Item label="Name" required>
            <Input value={quickName} onChange={(e) => setQuickName(e.target.value)} placeholder="Item name" />
          </Form.Item>
          <Form.Item label="Tracking Type">
            <Select value={quickTrackingType} onChange={(value) => setQuickTrackingType(value)}>
              <Select.Option value="BATCH">BATCH</Select.Option>
              <Select.Option value="INDIVIDUAL">INDIVIDUAL</Select.Option>
            </Select>
          </Form.Item>
          <Space size="middle" style={{ width: "100%" }}>
            <Form.Item label="On Hand" style={{ flex: 1 }}>
              <InputNumber min={0} value={quickQtyOnHand} onChange={(value) => setQuickQtyOnHand(Number(value) || 0)} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Minimum" style={{ flex: 1 }}>
              <InputNumber min={0} value={quickMinQty} onChange={(value) => setQuickMinQty(Number(value) || 0)} style={{ width: "100%" }} />
            </Form.Item>
          </Space>
          <Form.Item label="Unit Price (optional)">
            <InputNumber
              min={0}
              value={quickUnitPrice as number | null}
              onChange={(value) => setQuickUnitPrice(value == null ? null : Number(value))}
              style={{ width: "100%" }}
            />
          </Form.Item>
          {quickError ? <Typography.Text type="danger">{quickError}</Typography.Text> : null}
          <Space style={{ marginTop: 12 }}>
            <Button onClick={() => setQuickCreateOpen(false)}>Cancel</Button>
            <Button type="primary" htmlType="submit" loading={quickSaving}>
              Create
            </Button>
          </Space>
        </Form>
      </Drawer>

      <Modal
        open={!!attachmentItem}
        onCancel={closeAttachmentsModal}
        footer={null}
        title="Item attachments"
        width={760}
      >
        {attachmentItem ? (
          <Space direction="vertical" style={{ width: "100%" }}>
            <Typography.Text type="secondary">
              {attachmentItem.sku} - {attachmentItem.name}
            </Typography.Text>
            <Upload
              showUploadList={false}
              disabled={!canUploadAttachments}
              beforeUpload={(file) => {
                handleUploadAttachment(file as File);
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={attachmentUploading} disabled={!canUploadAttachments}>
                Upload attachment
              </Button>
            </Upload>
            {attachmentError ? <Typography.Text type="danger">{attachmentError}</Typography.Text> : null}
            <Table
              className="pro-table"
              rowKey="id"
              dataSource={attachments}
              pagination={false}
              columns={[
                { title: "File", dataIndex: "file_name", key: "file_name" },
                {
                  title: "Size",
                  dataIndex: "file_size",
                  key: "file_size",
                  render: (value: number) => `${Math.ceil(value / 1024)} KB`
                },
                {
                  title: "Uploaded By",
                  dataIndex: "uploaded_by_user_id",
                  key: "uploaded_by_user_id",
                  render: (value: number | null | undefined) => (value ? usersById.get(value) ?? `User #${value}` : "-")
                },
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, row: ProductAttachment) => (
                    <Space>
                      <Button onClick={() => handleDownloadAttachment(row)}>Download</Button>
                      {canDeleteAttachments ? (
                        <Button danger onClick={() => handleDeleteAttachment(row)}>
                          Delete
                        </Button>
                      ) : null}
                    </Space>
                  )
                }
              ]}
              locale={{ emptyText: <SmartEmptyState compact title="No attachments" description="Upload drawings, manuals, or photos for this item." /> }}
            />
          </Space>
        ) : null}
      </Modal>

      <Modal open={!!stockItem} onCancel={closeStockModal} footer={null} title="Stock movement" width={900}>
        {stockItem ? (
          <div>
            <Typography.Text type="secondary">
              {stockItem.sku} - {stockItem.name}
            </Typography.Text>

            <Space style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
              <Typography.Text type="secondary">
                On hand: <strong>{stockItem.quantity_on_hand}</strong> | Min: <strong>{stockItem.min_quantity}</strong>
              </Typography.Text>
              {isLowStock(stockItem) ? <Tag color="red">Low stock</Tag> : <Tag color="green">OK</Tag>}
            </Space>

            <Card style={{ marginTop: 12 }}>
              <Form layout="vertical" onFinish={handlePostStock}>
                <Space wrap align="end">
                  <Form.Item label="Type">
                    <Select value={stockType} onChange={(value) => setStockType(value as StockTransactionType)}>
                      <Select.Option value="IN">Receive</Select.Option>
                      <Select.Option value="OUT">Issue</Select.Option>
                      <Select.Option value="ADJUST">Adjust</Select.Option>
                    </Select>
                  </Form.Item>
                  <Form.Item label={stockType === "ADJUST" ? "Adjust by (+/-)" : "Quantity"}>
                    <Input
                      type="number"
                      step={1}
                      min={stockType === "ADJUST" ? undefined : 1}
                      value={stockQty}
                      onChange={(e) => setStockQty(e.target.value)}
                    />
                  </Form.Item>
                  <Form.Item label="Supplier (optional)" style={{ minWidth: 220, flex: 1 }}>
                    <Select<number>
                      value={stockSupplierId === "" ? undefined : stockSupplierId}
                      onChange={(value) => setStockSupplierId(value ?? "")}
                      placeholder="None"
                      allowClear
                    >
                      {suppliers.map((s) => (
                        <Select.Option key={s.id} value={s.id}>
                          {s.is_active ? s.name : `${s.name} (inactive)`}
                        </Select.Option>
                      ))}
                    </Select>
                  </Form.Item>
                </Space>
                <Form.Item label="Notes (optional)">
                  <Input value={stockNotes} onChange={(e) => setStockNotes(e.target.value)} placeholder="e.g. PO #1234" />
                </Form.Item>

                {stockError ? <Typography.Text type="danger">{stockError}</Typography.Text> : null}

                <Space style={{ marginTop: 12, display: "flex", justifyContent: "space-between" }}>
                  <Typography.Text type="secondary">This will add a transaction to the stock ledger.</Typography.Text>
                  <Button type="primary" htmlType="submit" disabled={stockSaving}>
                    Post
                  </Button>
                </Space>
              </Form>
            </Card>

            <Space style={{ marginTop: 14, display: "flex", justifyContent: "space-between" }}>
              <Typography.Title level={4} style={{ margin: 0 }}>
                Recent transactions
              </Typography.Title>
              <Button onClick={exportTransactions} disabled={txExporting || txLoading}>
                Export CSV
              </Button>
            </Space>
            <Table
              className="pro-table"
              rowKey="id"
              loading={txLoading}
              dataSource={transactions}
              columns={transactionColumns}
              pagination={false}
              locale={{ emptyText: <SmartEmptyState compact title="No transactions yet" description="Stock movement history will appear here." /> }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal open={!!qrItem} onCancel={closeQrModal} footer={null} title="Item QR code" width={520}>
        {qrItem ? (
          <div>
            <Typography.Text type="secondary">
              {qrItem.sku} - {qrItem.name}
            </Typography.Text>

            {qrLoading ? (
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
                Generating QR code...
              </Typography.Text>
            ) : null}
            {qrError ? <Typography.Text type="danger">{qrError}</Typography.Text> : null}

            {qrSvg ? (
              <div style={{ marginTop: 12 }}>
                <Card style={{ display: "flex", justifyContent: "center" }}>
                  <img
                    src={qrDataUrl}
                    alt={`QR for ${qrItem.sku}`}
                    loading="lazy"
                    decoding="async"
                    style={{ width: 220, height: 220 }}
                  />
                </Card>
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                  Encoded value: <strong>{qrText}</strong>
                </Typography.Text>
                <Space wrap>
                  <Button onClick={() => downloadTextFile(`qr-${qrItem.sku}.svg`, qrSvg, "image/svg+xml")}>
                    Download SVG
                  </Button>
                  <Button onClick={() => navigator.clipboard?.writeText(qrText)}>Copy value</Button>
                  <Button onClick={handleDownloadLabelPdf}>Download Label PDF</Button>
                  <Space.Compact>
                    <Button disabled>W</Button>
                    <InputNumber min={20} value={labelWidthMm} onChange={(value) => setLabelWidthMm(Number(value) || 50)} />
                    <Button disabled>mm</Button>
                  </Space.Compact>
                  <Space.Compact>
                    <Button disabled>H</Button>
                    <InputNumber
                      min={20}
                      value={labelHeightMm}
                      onChange={(value) => setLabelHeightMm(Number(value) || 30)}
                    />
                    <Button disabled>mm</Button>
                  </Space.Compact>
                  <Button type="primary" onClick={handlePrintLabel}>
                    Print label
                  </Button>
                </Space>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!instanceQr} onCancel={closeInstanceQrModal} footer={null} title="Instance QR code" width={520}>
        {instanceQr ? (
          <div>
            <Typography.Text type="secondary">
              {instanceQr.item.sku} - {instanceQr.item.name}
            </Typography.Text>
            <Typography.Text style={{ display: "block", marginTop: 6 }}>
              Serial: <strong>{instanceQr.instance.serial_number}</strong>
            </Typography.Text>

            {instanceQrLoading ? (
              <Typography.Text type="secondary" style={{ display: "block", marginTop: 12 }}>
                Generating QR code...
              </Typography.Text>
            ) : null}
            {instanceQrError ? <Typography.Text type="danger">{instanceQrError}</Typography.Text> : null}

            {instanceQrSvg ? (
              <div style={{ marginTop: 12 }}>
                <Card style={{ display: "flex", justifyContent: "center" }}>
                  <img
                    src={instanceQrDataUrl}
                    alt={`QR for ${instanceQr.instance.serial_number}`}
                    loading="lazy"
                    decoding="async"
                    style={{ width: 220, height: 220 }}
                  />
                </Card>
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                  Encoded value: <strong>{instanceQrText}</strong>
                </Typography.Text>
                <Space wrap>
                  <Button
                    onClick={() =>
                      downloadTextFile(`qr-${instanceQr.instance.serial_number}.svg`, instanceQrSvg, "image/svg+xml")
                    }
                  >
                    Download SVG
                  </Button>
                  <Button onClick={() => navigator.clipboard?.writeText(instanceQrText)}>Copy value</Button>
                  <Button onClick={handleDownloadInstanceLabelPdf}>Download Label PDF</Button>
                  <Space.Compact>
                    <Button disabled>W</Button>
                    <InputNumber
                      min={20}
                      value={instanceLabelWidthMm}
                      onChange={(value) => setInstanceLabelWidthMm(Number(value) || 50)}
                    />
                    <Button disabled>mm</Button>
                  </Space.Compact>
                  <Space.Compact>
                    <Button disabled>H</Button>
                    <InputNumber
                      min={20}
                      value={instanceLabelHeightMm}
                      onChange={(value) => setInstanceLabelHeightMm(Number(value) || 30)}
                    />
                    <Button disabled>mm</Button>
                  </Space.Compact>
                  <Button type="primary" onClick={handlePrintInstanceLabel}>
                    Print label
                  </Button>
                </Space>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal open={!!instancesItem} onCancel={closeInstancesModal} footer={null} title="Item instances" width={700}>
        {instancesItem ? (
          <div>
            <Typography.Text type="secondary">
              {instancesItem.sku} - {instancesItem.name}
            </Typography.Text>

            <Card style={{ marginTop: 12 }}>
              <Form layout="vertical">
                <Space align="end" wrap>
                  <Form.Item label="Generate quantity">
                    <Input value={bulkQty} onChange={(e) => setBulkQty(e.target.value)} inputMode="numeric" />
                  </Form.Item>
                  <Button onClick={handleBulkCreate} disabled={instancesLoading}>
                    Generate
                  </Button>
                </Space>
                <Typography.Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                  New instances will be created with unique serial numbers and QR codes.
                </Typography.Text>
              </Form>
            </Card>

            {instancesError ? <Typography.Text type="danger">{instancesError}</Typography.Text> : null}

            <Table
              className="pro-table"
              rowKey="id"
              loading={instancesLoading}
              dataSource={instances}
              columns={instanceColumns}
              pagination={false}
              style={{ marginTop: 12 }}
              locale={{ emptyText: <SmartEmptyState compact title="No instances yet" description="Generate serialised instances for this item." /> }}
            />
          </div>
        ) : null}
      </Modal>

      <Modal
        open={!!locationItem}
        onCancel={closeLocationModal}
        onOk={handleSaveLocations}
        okText="Save locations"
        confirmLoading={locationSaving}
        title="Item locations"
        width={700}
      >
        {locationItem ? (
          <div>
            <Typography.Text type="secondary">
              {locationItem.sku} - {locationItem.name}
            </Typography.Text>
            <Table
              className="pro-table"
              rowKey="location_id"
              dataSource={locationStocks}
              pagination={false}
              style={{ marginTop: 12 }}
              columns={[
                { title: "Location", dataIndex: "location_name", key: "location_name" },
                {
                  title: "Quantity",
                  key: "quantity_on_hand",
                  render: (_: unknown, row: LocationStock) => (
                    <InputNumber
                      min={0}
                      value={row.quantity_on_hand}
                      onChange={(value) => updateLocationQty(row.location_id, Number(value) || 0)}
                    />
                  )
                }
              ]}
              locale={{ emptyText: <SmartEmptyState compact title="No location balances" description="Add quantities by location for this item." /> }}
            />
            {locationError ? (
              <Typography.Text type="danger" style={{ display: "block", marginTop: 8 }}>
                {locationError}
              </Typography.Text>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
