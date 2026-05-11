import { api } from "./client";
import type { Item, ItemInstance, LocationStock, Paginated } from "./types";

export type ListItemsParams = {
  page?: number;
  page_size?: number;
  q?: string;
  sort?: "name" | "sku" | "quantity_on_hand" | "min_quantity" | "created_at" | "updated_at";
  direction?: "asc" | "desc";
  include_inactive?: boolean;
};

export async function listItems(params: ListItemsParams): Promise<Paginated<Item>> {
  return (
    await api.get<Paginated<Item>>("/api/items", {
      params
    })
  ).data;
}

export type CreateItemPayload = {
  sku?: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  unit_price?: number | null;
  quantity_on_hand?: number;
  min_quantity?: number;
  tracking_type?: string;
  unit_of_measure?: string | null;
  category_id?: number | null;
  location_id?: number | null;
  supplier_id?: number | null;
};

export async function createItem(payload: CreateItemPayload): Promise<Item> {
  return (await api.post<Item>("/api/items", payload)).data;
}

export type UpdateItemPayload = {
  sku?: string;
  name?: string;
  is_active?: boolean;
  description?: string | null;
  image_url?: string | null;
  unit_price?: number | null;
  quantity_on_hand?: number;
  min_quantity?: number;
  tracking_type?: string;
  unit_of_measure?: string | null;
  category_id?: number | null;
  location_id?: number | null;
  supplier_id?: number | null;
};

export async function updateItem(itemId: number, payload: UpdateItemPayload): Promise<Item> {
  return (await api.put<Item>(`/api/items/${itemId}`, payload)).data;
}

export async function deactivateItem(itemId: number): Promise<void> {
  await api.delete(`/api/items/${itemId}`);
}

export async function reactivateItem(itemId: number): Promise<void> {
  await api.post(`/api/items/${itemId}/reactivate`);
}

export async function hardDeleteItem(itemId: number): Promise<void> {
  await api.delete(`/api/items/${itemId}/hard`);
}

export async function purgeAllItems(payload: { confirmation: string; token: string }): Promise<{
  message: string;
  parts_deleted: number;
  instances_deleted: number;
  transactions_deleted: number;
  request_lines_deleted: number;
}> {
  return (await api.post("/api/items/purge-all", payload)).data;
}

export async function listLowStock(params?: { limit?: number; q?: string }): Promise<Item[]> {
  return (
    await api.get<Item[]>("/api/stock/low", {
      params
    })
  ).data;
}

export async function getItemQrSvg(itemId: number, data?: string): Promise<string> {
  return (
    await api.get<string>(`/api/items/${itemId}/qr`, {
      params: data ? { data } : undefined,
      responseType: "text"
    })
  ).data as unknown as string;
}

export async function getItemInstanceQrSvg(instanceId: number, data?: string): Promise<string> {
  return (
    await api.get<string>(`/api/items/instances/${instanceId}/qr`, {
      params: data ? { data } : undefined,
      responseType: "text"
    })
  ).data as unknown as string;
}

export async function downloadItemLabelPdf(itemId: number, params?: { width_mm?: number; height_mm?: number }): Promise<Blob> {
  return (
    await api.get(`/api/items/${itemId}/label.pdf`, {
      params,
      responseType: "blob"
    })
  ).data;
}

export async function downloadItemInstanceLabelPdf(
  instanceId: number,
  params?: { width_mm?: number; height_mm?: number }
): Promise<Blob> {
  return (
    await api.get(`/api/items/instances/${instanceId}/label.pdf`, {
      params,
      responseType: "blob"
    })
  ).data;
}

export async function listItemInstances(itemId: number, params?: { status?: string }): Promise<ItemInstance[]> {
  return (await api.get<ItemInstance[]>(`/api/items/${itemId}/instances`, { params })).data;
}

export async function createItemInstance(
  itemId: number,
  payload: { serial_number: string; status?: string; location_id?: number | null }
): Promise<ItemInstance> {
  return (await api.post<ItemInstance>(`/api/items/${itemId}/instances`, payload)).data;
}

export async function bulkCreateItemInstances(
  itemId: number,
  params: { quantity: number; prefix?: string }
): Promise<ItemInstance[]> {
  return (await api.post<ItemInstance[]>(`/api/items/${itemId}/instances/bulk`, null, { params })).data;
}

export async function listItemLocations(itemId: number): Promise<LocationStock[]> {
  return (await api.get<LocationStock[]>(`/api/items/${itemId}/locations`)).data;
}

export async function updateItemLocations(
  itemId: number,
  payload: Array<{ location_id: number; quantity_on_hand: number }>
): Promise<LocationStock[]> {
  return (await api.post<LocationStock[]>(`/api/items/${itemId}/locations`, payload)).data;
}

export type ProductAttachment = {
  id: number;
  part_id: number;
  file_name: string;
  content_type?: string | null;
  file_size: number;
  uploaded_by_user_id?: number | null;
  created_at: string;
  updated_at: string;
};

export async function listItemAttachments(itemId: number): Promise<ProductAttachment[]> {
  return (await api.get<ProductAttachment[]>(`/api/items/${itemId}/attachments`)).data;
}

export async function uploadItemAttachment(itemId: number, file: File): Promise<ProductAttachment> {
  const form = new FormData();
  form.append("file", file);
  return (
    await api.post<ProductAttachment>(`/api/items/${itemId}/attachments`, form, {
      headers: { "Content-Type": "multipart/form-data" }
    })
  ).data;
}

export async function downloadItemAttachment(itemId: number, attachmentId: number): Promise<Blob> {
  return (
    await api.get(`/api/items/${itemId}/attachments/${attachmentId}/download`, {
      responseType: "blob"
    })
  ).data;
}

export async function deleteItemAttachment(itemId: number, attachmentId: number): Promise<void> {
  await api.delete(`/api/items/${itemId}/attachments/${attachmentId}`);
}

export type ImportSummary = {
  created: number;
  skipped: number;
  failed: number;
  errors: string[];
};

export async function importInventoryXlsx(file: File, dryRun = false): Promise<ImportSummary> {
  const form = new FormData();
  form.append("file", file);
  return (
    await api.post<ImportSummary>("/api/import/inventory-xlsx", form, {
      params: dryRun ? { dry_run: true } : undefined,
      headers: { "Content-Type": "multipart/form-data" }
    })
  ).data;
}

export type NormalizeSkusResult = {
  total_items: number;
  changed: number;
  sample: Array<{ part_id: number; from: string; to: string }>;
};

export async function normalizeExistingSkus(): Promise<NormalizeSkusResult> {
  return (await api.post<NormalizeSkusResult>("/api/items/normalize-skus")).data;
}
