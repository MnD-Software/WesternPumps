export type Token = {
  access_token: string;
  token_type: "bearer";
};

export type UserRole = "admin" | "technician" | "lead_technician" | "store_manager" | "manager" | "approver" | "finance" | "staff" | "rider" | "driver";

export type User = {
  id: number;
  email: string;
  phone?: string | null;
  full_name?: string | null;
  role: string;
  is_active: boolean;
  must_change_password: boolean;
  region?: string | null;
  area_code?: string | null;
  zone_count: number;
  created_at: string;
  updated_at: string;
};

export type TechnicianZone = {
  id: number;
  region_label: string;
  station_name: string;
  client_code?: string | null;
  zone_order: number;
  created_at: string;
  updated_at: string;
};

export type TechnicianZoneAdminRow = TechnicianZone & {
  user_id: number;
  user_email: string;
  user_full_name?: string | null;
  user_role: string;
  user_is_active: boolean;
};

export type UserPreferences = {
  default_landing_page: string;
  dense_mode: boolean;
  animations_enabled: boolean;
  show_email_in_header: boolean;
  display_name_override?: string | null;
};

export type Customer = {
  id: number;
  name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type Job = {
  id: number;
  customer_id: number;
  title: string;
  description?: string | null;
  status: string;
  priority: string;
  assigned_to_user_id?: number | null;
  site_location_label?: string | null;
  site_latitude?: number | null;
  site_longitude?: number | null;
  created_by_user_id?: number | null;
  created_at: string;
  updated_at: string;
  // Approval workflow fields
  approved_by_user_id?: number | null;
  approved_at?: string | null;
  approval_notes?: string | null;
};

export type Item = {
  id: number;
  sku: string;
  barcode_value?: string | null;
  name: string;
  is_active: boolean;
  description?: string | null;
  image_url?: string | null;
  unit_price?: number | null;
  quantity_on_hand: number;
  min_quantity: number;
  tracking_type?: string;
  unit_of_measure?: string | null;
  category_id?: number | null;
  location_id?: number | null;
  supplier_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type Category = {
  id: number;
  name: string;
  parent_id?: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Location = {
  id: number;
  name: string;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ItemInstance = {
  id: number;
  part_id: number;
  serial_number: string;
  barcode_value?: string | null;
  status: string;
  location_id?: number | null;
  created_at: string;
  updated_at: string;
};

export type StockRequestLine = {
  id: number;
  part_id: number;
  quantity: number;
  unit_cost?: number | null;
  tracking_type?: string | null;
  created_at: string;
  updated_at: string;
};

export type StockRequest = {
  id: number;
  requested_by_user_id: number;
  customer_id?: number | null;
  job_id?: number | null;
  status: string;
  total_value?: number | null;
  required_approval_role?: string | null;
  approved_by_user_id?: number | null;
  approved_at?: string | null;
  approved_comment?: string | null;
  rejected_reason?: string | null;
  closure_type?: "RETURNED" | "SOLD" | string | null;
  closed_at?: string | null;
  lines?: StockRequestLine[] | null;
  created_at: string;
  updated_at: string;
};

export type DeliveryRequestStatus = "PENDING" | "ACCEPTED" | "PICKED_UP" | "DELIVERED" | "CANCELED";

export type DeliveryRequest = {
  id: number;
  stock_request_id?: number | null;
  technician_id: number;
  requested_by_user_id: number;
  assigned_to_user_id?: number | null;
  delivery_mode: "RIDER" | "DRIVER" | string;
  status: DeliveryRequestStatus | string;
  pickup_location?: string | null;
  dropoff_location?: string | null;
  equipment_summary?: string | null;
  notes?: string | null;
  approved_by_user_id?: number | null;
  approved_at?: string | null;
  rejected_reason?: string | null;
  accepted_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  canceled_reason?: string | null;
  created_at: string;
  updated_at: string;
};

export type Supplier = {
  id: number;
  name: string;
  contact_name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type StockTransactionType = "IN" | "OUT" | "ADJUST";

export type StockTransaction = {
  id: number;
  part_id: number;
  transaction_type: StockTransactionType;
  quantity_delta: number;
  supplier_id?: number | null;
  notes?: string | null;
  created_by_user_id?: number | null;
  request_id?: number | null;
  technician_id?: number | null;
  customer_id?: number | null;
  job_id?: number | null;
  item_instance_id?: number | null;
  movement_type?: string | null;
  grn_number?: string | null;
  created_at: string;
  updated_at: string;
};

export type PendingReturn = {
  id: number;
  part_id: number;
  part_sku: string;
  part_name: string;
  item_instance_id?: number | null;
  quantity: number;
  condition: "GOOD" | "FAULTY" | string;
  request_id?: number | null;
  technician_id?: number | null;
  submitted_by_user_id?: number | null;
  submitted_by_email?: string | null;
  notes?: string;
  latitude?: number | null;
  longitude?: number | null;
  created_at: string;
};

export type ReturnSubmission = {
  id: number;
  status: string;
  part_id: number;
  part_sku: string;
  part_name: string;
  item_instance_id?: number | null;
  quantity: number;
  condition: "GOOD" | "FAULTY" | string;
  request_id?: number | null;
  notes?: string;
  created_at: string;
};

export type StockUsageSummary = {
  part_id: number;
  total: number;
};

export type StockTrendPoint = {
  date: string;
  net: number;
  inbound: number;
  outbound: number;
};

export type LocationStock = {
  location_id: number;
  location_name: string;
  quantity_on_hand: number;
};

export type Paginated<T> = {
  items: T[];
  page: number;
  page_size: number;
  total: number;
};

export type PurchaseOrderStatus = "DRAFT" | "APPROVED" | "SENT" | "RECEIVING" | "CLOSED" | "CANCELED";
export type TransferStatus = "DRAFT" | "APPROVED" | "IN_TRANSIT" | "COMPLETED" | "CANCELED";
export type CycleCountStatus = "OPEN" | "SUBMITTED" | "APPROVED" | "REJECTED";
export type ReservationStatus = "ACTIVE" | "RELEASED" | "FULFILLED";

export type PurchaseOrderLine = {
  id: number;
  part_id: number;
  ordered_quantity: number;
  received_quantity: number;
  unit_cost?: number | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrder = {
  id: number;
  supplier_id: number;
  status: PurchaseOrderStatus;
  order_date: string;
  expected_date?: string | null;
  approved_by_user_id?: number | null;
  approved_at?: string | null;
  sent_at?: string | null;
  closed_at?: string | null;
  notes?: string | null;
  lines: PurchaseOrderLine[];
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderDispatchResult = {
  purchase_order: PurchaseOrder;
  dispatched: boolean;
  detail: string;
  recipient_email: string;
};

export type GoodsReceiptLine = {
  id: number;
  purchase_order_line_id: number;
  part_id: number;
  received_quantity: number;
  accepted_quantity: number;
  rejected_quantity: number;
  variance_reason?: string | null;
  lot_code?: string | null;
  expiry_date?: string | null;
  created_at: string;
  updated_at: string;
};

export type GoodsReceipt = {
  id: number;
  purchase_order_id: number;
  received_by_user_id?: number | null;
  grn_number: string;
  notes: string;
  received_at: string;
  lines: GoodsReceiptLine[];
  created_at: string;
  updated_at: string;
};

export type StockTransferLine = {
  id: number;
  part_id: number;
  quantity: number;
  created_at: string;
  updated_at: string;
};

export type StockTransfer = {
  id: number;
  from_location_id: number;
  to_location_id: number;
  status: TransferStatus;
  approved_by_user_id?: number | null;
  approved_at?: string | null;
  completed_at?: string | null;
  notes?: string | null;
  lines: StockTransferLine[];
  created_at: string;
  updated_at: string;
};

export type CycleCountLine = {
  id: number;
  part_id: number;
  expected_quantity: number;
  counted_quantity?: number | null;
  variance_quantity: number;
  reason?: string | null;
  created_at: string;
  updated_at: string;
};

export type CycleCount = {
  id: number;
  location_id: number;
  status: CycleCountStatus;
  submitted_by_user_id?: number | null;
  approved_by_user_id?: number | null;
  submitted_at?: string | null;
  approved_at?: string | null;
  rejected_reason?: string | null;
  notes?: string | null;
  lines: CycleCountLine[];
  created_at: string;
  updated_at: string;
};

export type Reservation = {
  id: number;
  part_id: number;
  quantity: number;
  request_id?: number | null;
  status: ReservationStatus;
  notes?: string | null;
  created_at: string;
  updated_at: string;
};

export type ReplenishmentSuggestion = {
  part_id: number;
  sku: string;
  name: string;
  quantity_on_hand: number;
  allocated_quantity: number;
  available_quantity: number;
  min_quantity: number;
  safety_stock: number;
  lead_time_days: number;
  average_daily_outbound: number;
  projected_demand_during_lead_time: number;
  suggested_order_quantity: number;
  risk_level: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | string;
};

export type KpiSummary = {
  total_items: number;
  low_stock_items: number;
  stockout_items: number;
  fill_rate_percent: number;
  stockout_rate_percent: number;
  inventory_turns_estimate: number;
  aging_over_30_days: number;
  aging_over_60_days: number;
  aging_over_90_days: number;
};

export type ExecutiveSummary = {
  period_start: string;
  period_end: string;
  purchase_orders_created: number;
  purchase_orders_closed: number;
  transfer_orders_completed: number;
  cycle_counts_approved: number;
  top_outbound_skus: string[];
};

export type SystemAbout = {
  generated_at: string;
  system_name: string;
  deployment_mode: string;
  auth_mode: string;
  database_engine: string;
  roles_supported: string[];
  modules: string[];
  key_features: string[];
  integrations: Record<string, boolean>;
  controls: Record<string, boolean>;
};
