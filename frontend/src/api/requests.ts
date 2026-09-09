import { api } from "./client";
import type { StockRequest } from "./types";

export type CreateRequestPayload = {
  customer_id?: number | null;
  job_id?: number | null;
  customer_name?: string | null;
  job_title?: string | null;
  lines: Array<{ part_id: number; quantity: number }>;
};

export async function createRequest(payload: CreateRequestPayload): Promise<StockRequest> {
  return (await api.post<StockRequest>("/api/requests", payload)).data;
}

export async function listRequests(params?: { status?: string; mine?: boolean }): Promise<StockRequest[]> {
  return (await api.get<StockRequest[]>("/api/requests", { params })).data;
}

export async function approveRequest(requestId: number, comment?: string | null): Promise<StockRequest> {
  return (
    await api.post<StockRequest>(`/api/requests/${requestId}/approve`, {
      comment: comment ?? null
    })
  ).data;
}

export async function rejectRequest(requestId: number, reason: string): Promise<StockRequest> {
  return (await api.post<StockRequest>(`/api/requests/${requestId}/reject`, { reason })).data;
}

export async function markRequestNotIssued(requestId: number, reason: string): Promise<StockRequest> {
  return (await api.post<StockRequest>(`/api/requests/${requestId}/not-issued`, { reason })).data;
}

export type IssueRequestPayload = {
  lines: Array<{ line_id: number; quantity: number; item_instance_ids?: number[] }>;
};

export async function issueRequest(requestId: number, payload: IssueRequestPayload): Promise<StockRequest> {
  return (await api.post<StockRequest>(`/api/requests/${requestId}/issue`, payload)).data;
}

export type IssuedItem = {
  item_instance_id: number;
  serial_number: string;
  barcode_value?: string | null;
  scan_proof_token?: string | null;
  part_id: number;
  part_sku: string;
  part_name: string;
  request_id?: number | null;
  customer_id?: number | null;
  job_id?: number | null;
  status: string;
  issued_at?: string | null;
};

export async function listIssuedItems(requestId: number): Promise<IssuedItem[]> {
  return (await api.get<IssuedItem[]>(`/api/requests/${requestId}/issued-items`)).data;
}

export type IssuedBatchItem = {
  issued_batch_id: number;
  part_id: number;
  part_sku: string;
  part_name: string;
  quantity_remaining: number;
  request_id?: number | null;
  customer_id?: number | null;
  job_id?: number | null;
  issued_at?: string | null;
};

export type TechnicianIssuedItemsResponse = {
  instances: IssuedItem[];
  batches: IssuedBatchItem[];
};

export async function listMyIssuedItems(): Promise<TechnicianIssuedItemsResponse> {
  return (await api.get<TechnicianIssuedItemsResponse>("/api/requests/issued-items/mine")).data;
}

export async function lookupMyIssuedItemBySerial(serial: string): Promise<IssuedItem | null> {
  return (await api.get<IssuedItem | null>("/api/requests/issued-items/mine/lookup", { params: { serial } })).data;
}

export type ReturnRemark = {
  id: number;
  request_id?: number | null;
  part_id: number;
  part_sku: string;
  part_name: string;
  movement_type?: string | null;
  notes: string;
  created_by_email?: string | null;
  created_at: string;
};

export async function listMyReturnRemarks(limit = 20): Promise<ReturnRemark[]> {
  return (await api.get<ReturnRemark[]>("/api/requests/returns/mine/remarks", { params: { limit } })).data;
}

export type UsagePayload = {
  item_instance_id: number;
  scan_proof_token: string;
  request_id?: number | null;
  customer_id?: number | null;
  job_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

export async function recordUsage(payload: UsagePayload) {
  return (await api.post("/api/requests/usage", payload)).data;
}

export type BatchUsagePayload = {
  part_id: number;
  quantity: number;
  scan_code: string;
  request_id?: number | null;
  customer_id?: number | null;
  job_id?: number | null;
  latitude?: number | null;
  longitude?: number | null;
};

export async function recordBatchUsage(payload: BatchUsagePayload) {
  return (await api.post("/api/requests/usage/batch", payload)).data;
}
