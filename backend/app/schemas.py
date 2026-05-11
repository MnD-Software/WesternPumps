from __future__ import annotations

from datetime import date, datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserBase(BaseModel):
    tenant_id: int = 1
    email: EmailStr
    phone: Optional[str] = None
    full_name: Optional[str] = None
    role: str = "technician"
    is_active: bool = True
    must_change_password: bool = False
    # Technician-specific fields
    region: Optional[str] = None  # Nairobi/Industrial | Nakuru | Mombasa
    area_code: Optional[str] = None  # For site navigation
    zone_count: int = 0


class UserCreate(BaseModel):
    tenant_id: Optional[int] = 1
    email: EmailStr
    phone: Optional[str] = None
    password: str = Field(min_length=10, max_length=72)
    full_name: Optional[str] = None
    role: str = "technician"
    must_change_password: bool = False


class UserRead(UserBase):
    id: int
    created_at: datetime
    updated_at: datetime


class UserUpdate(BaseModel):
    phone: Optional[str] = None
    full_name: Optional[str] = None
    role: Optional[str] = None
    is_active: Optional[bool] = None
    must_change_password: Optional[bool] = None


class UserPasswordChange(BaseModel):
    current_password: str
    new_password: str = Field(min_length=10, max_length=72)


class UserAdminPasswordReset(BaseModel):
    new_password: str = Field(min_length=10, max_length=72)
    must_change_password: bool = True


class UserPreferencesRead(BaseModel):
    default_landing_page: str = "/dashboard"
    dense_mode: bool = False
    animations_enabled: bool = True
    show_email_in_header: bool = True
    display_name_override: Optional[str] = None


class TechnicianZoneRead(BaseModel):
    id: int
    region_label: str
    station_name: str
    client_code: Optional[str] = None
    zone_order: int
    created_at: datetime
    updated_at: datetime


class TechnicianZoneCreate(BaseModel):
    region_label: str = Field(min_length=1, max_length=200)
    station_name: str = Field(min_length=1, max_length=200)
    client_code: Optional[str] = Field(default=None, max_length=120)
    zone_order: int = Field(default=1, ge=1, le=10000)


class TechnicianZoneUpdate(BaseModel):
    region_label: Optional[str] = Field(default=None, min_length=1, max_length=200)
    station_name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    client_code: Optional[str] = Field(default=None, max_length=120)
    zone_order: Optional[int] = Field(default=None, ge=1, le=10000)


class UserPreferencesUpdate(BaseModel):
    default_landing_page: Optional[str] = Field(default=None, pattern=r"^/[\w/-]+$")
    dense_mode: Optional[bool] = None
    animations_enabled: Optional[bool] = None
    show_email_in_header: Optional[bool] = None
    display_name_override: Optional[str] = Field(default=None, max_length=120)


class CategoryBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_id: Optional[int] = None
    is_active: bool = True


class CategoryCreate(CategoryBase):
    pass


class CategoryUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    parent_id: Optional[int] = None
    is_active: Optional[bool] = None


class CategoryRead(CategoryBase):
    id: int
    created_at: datetime
    updated_at: datetime


class LocationBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: Optional[str] = None
    is_active: bool = True


class LocationCreate(LocationBase):
    pass


class LocationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = None
    is_active: Optional[bool] = None


class LocationRead(LocationBase):
    id: int
    created_at: datetime
    updated_at: datetime


class CustomerBase(BaseModel):
    name: str
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class CustomerCreate(CustomerBase):
    pass


class CustomerUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[EmailStr] = None
    address: Optional[str] = None
    notes: Optional[str] = None


class CustomerRead(CustomerBase):
    id: int
    created_at: datetime
    updated_at: datetime


class JobBase(BaseModel):
    customer_id: int
    title: str
    description: Optional[str] = None
    status: str = "open"
    priority: str = "medium"
    assigned_to_user_id: Optional[int] = None
    site_location_label: Optional[str] = Field(default=None, max_length=255)
    site_latitude: Optional[float] = None
    site_longitude: Optional[float] = None


class JobCreate(JobBase):
    pass


class JobUpdate(BaseModel):
    customer_id: Optional[int] = None
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_to_user_id: Optional[int] = None
    site_location_label: Optional[str] = Field(default=None, max_length=255)
    site_latitude: Optional[float] = None
    site_longitude: Optional[float] = None


class JobRead(JobBase):
    id: int
    created_by_user_id: Optional[int] = None
    assigned_to_user_id: Optional[int] = None
    approved_by_user_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    approval_notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PartBase(BaseModel):
    sku: str = Field(default="", max_length=100)
    name: str = Field(min_length=1, max_length=255)
    is_active: bool = True
    description: Optional[str] = None
    image_url: Optional[str] = None
    unit_price: Optional[float] = Field(default=None, ge=0)
    quantity_on_hand: int = Field(default=0, ge=0)
    allocated_quantity: int = Field(default=0, ge=0)
    min_quantity: int = Field(default=0, ge=0)
    safety_stock: int = Field(default=0, ge=0)
    lead_time_days: int = Field(default=7, ge=0, le=3650)
    reorder_quantity: int = Field(default=0, ge=0)
    tracking_type: str = Field(default="BATCH")
    barcode_value: Optional[str] = Field(default=None, max_length=120)
    unit_of_measure: Optional[str] = None
    category_id: Optional[int] = None
    location_id: Optional[int] = None
    supplier_id: Optional[int] = None
    ownership_type: str = Field(default="OWNED")  # OWNED | CONSIGNED | VENDOR_MANAGED


class PartCreate(PartBase):
    pass


class PartUpdate(BaseModel):
    sku: Optional[str] = Field(default=None, min_length=1, max_length=100)
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    is_active: Optional[bool] = None
    description: Optional[str] = None
    image_url: Optional[str] = None
    unit_price: Optional[float] = Field(default=None, ge=0)
    quantity_on_hand: Optional[int] = Field(default=None, ge=0)
    allocated_quantity: Optional[int] = Field(default=None, ge=0)
    min_quantity: Optional[int] = Field(default=None, ge=0)
    safety_stock: Optional[int] = Field(default=None, ge=0)
    lead_time_days: Optional[int] = Field(default=None, ge=0, le=3650)
    reorder_quantity: Optional[int] = Field(default=None, ge=0)
    tracking_type: Optional[str] = None
    barcode_value: Optional[str] = Field(default=None, min_length=1, max_length=120)
    unit_of_measure: Optional[str] = None
    category_id: Optional[int] = None
    location_id: Optional[int] = None
    supplier_id: Optional[int] = None
    ownership_type: Optional[str] = None


class PartRead(PartBase):
    id: int
    created_at: datetime
    updated_at: datetime


class ItemInstanceBase(BaseModel):
    serial_number: str = Field(min_length=1, max_length=100)
    barcode_value: Optional[str] = Field(default=None, max_length=120)
    lot_code: Optional[str] = Field(default=None, max_length=80)
    expiry_date: Optional[date] = None
    status: str = "AVAILABLE"
    location_id: Optional[int] = None


class ItemInstanceCreate(ItemInstanceBase):
    pass


class ItemInstanceUpdate(BaseModel):
    barcode_value: Optional[str] = Field(default=None, min_length=1, max_length=120)
    lot_code: Optional[str] = Field(default=None, min_length=1, max_length=80)
    expiry_date: Optional[date] = None
    status: Optional[str] = None
    location_id: Optional[int] = None


class ItemInstanceRead(ItemInstanceBase):
    id: int
    part_id: int
    created_at: datetime
    updated_at: datetime


class StockRequestLineBase(BaseModel):
    part_id: int
    quantity: int = Field(default=1, ge=1)


class StockRequestLineCreate(StockRequestLineBase):
    pass


class StockRequestLineRead(StockRequestLineBase):
    id: int
    unit_cost: Optional[float] = None
    tracking_type: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class StockRequestBase(BaseModel):
    customer_id: Optional[int] = None
    job_id: Optional[int] = None


class StockRequestCreate(StockRequestBase):
    customer_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    job_title: Optional[str] = Field(default=None, min_length=1, max_length=255)
    lines: list[StockRequestLineCreate]


class StockRequestRead(StockRequestBase):
    id: int
    requested_by_user_id: int
    status: str
    total_value: Optional[float] = None
    required_approval_role: Optional[str] = None
    approved_by_user_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    approved_comment: Optional[str] = None
    rejected_reason: Optional[str] = None
    closure_type: Optional[str] = None
    closed_at: Optional[datetime] = None
    lines: list[StockRequestLineRead]
    created_at: datetime
    updated_at: datetime


class DeliveryRequestCreate(BaseModel):
    stock_request_id: Optional[int] = None
    technician_id: Optional[int] = None
    delivery_mode: str = Field(default="RIDER", pattern="^(RIDER|DRIVER)$")
    pickup_location: Optional[str] = Field(default=None, max_length=255)
    dropoff_location: Optional[str] = Field(default=None, max_length=255)
    equipment_summary: str = Field(min_length=3, max_length=2000)
    notes: Optional[str] = Field(default=None, max_length=2000)


class DeliveryRequestAssign(BaseModel):
    assignee_user_id: int = Field(ge=1)


class DeliveryRequestCancel(BaseModel):
    reason: str = Field(min_length=2, max_length=1000)


class DeliveryRequestReject(BaseModel):
    reason: str = Field(min_length=2, max_length=1000)


class DeliveryRequestRead(BaseModel):
    id: int
    stock_request_id: Optional[int] = None
    technician_id: int
    requested_by_user_id: int
    assigned_to_user_id: Optional[int] = None
    delivery_mode: str
    status: str
    pickup_location: Optional[str] = None
    dropoff_location: Optional[str] = None
    equipment_summary: Optional[str] = None
    notes: Optional[str] = None
    approved_by_user_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    rejected_reason: Optional[str] = None
    accepted_at: Optional[datetime] = None
    picked_up_at: Optional[datetime] = None
    delivered_at: Optional[datetime] = None
    canceled_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class UsageRecordCreate(BaseModel):
    item_instance_id: int
    scan_proof_token: str = Field(min_length=10, max_length=400)
    request_id: Optional[int] = None
    customer_id: Optional[int] = None
    job_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class UsageRecordRead(BaseModel):
    id: int
    item_instance_id: int
    request_id: Optional[int] = None
    technician_id: int
    customer_id: Optional[int] = None
    job_id: Optional[int] = None
    used_at: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    record_hash: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class BatchUsageCreate(BaseModel):
    part_id: int
    quantity: int = Field(default=1, ge=1)
    scan_code: str = Field(min_length=1, max_length=120)
    request_id: Optional[int] = None
    customer_id: Optional[int] = None
    job_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class BatchUsageRead(BaseModel):
    id: int
    part_id: int
    quantity: int
    request_id: Optional[int] = None
    technician_id: int
    customer_id: Optional[int] = None
    job_id: Optional[int] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    created_at: datetime
    updated_at: datetime


class SupplierBase(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None  # Use str to allow any email format including test/dev emails
    address: Optional[str] = None
    notes: Optional[str] = None
    is_active: bool = True


class SupplierCreate(SupplierBase):
    pass


class SupplierUpdate(BaseModel):
    name: Optional[str] = None
    contact_name: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None  # Use str to allow any email format including test/dev emails
    address: Optional[str] = None
    notes: Optional[str] = None
    is_active: Optional[bool] = None


class SupplierRead(SupplierBase):
    id: int
    created_at: datetime
    updated_at: datetime


class StockTransactionType(str, Enum):
    IN = "IN"
    OUT = "OUT"
    ADJUST = "ADJUST"


class StockTransactionBase(BaseModel):
    part_id: int
    transaction_type: StockTransactionType
    quantity_delta: int
    supplier_id: Optional[int] = None
    notes: Optional[str] = None
    request_id: Optional[int] = None
    technician_id: Optional[int] = None
    customer_id: Optional[int] = None
    job_id: Optional[int] = None
    item_instance_id: Optional[int] = None
    movement_type: Optional[str] = None
    grn_number: Optional[str] = Field(default=None, max_length=60)


class StockTransactionCreate(StockTransactionBase):
    pass


class StockTransactionRead(StockTransactionBase):
    id: int
    created_by_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class IssuedItemInstanceRead(BaseModel):
    item_instance_id: int
    part_id: int
    sku: str
    name: str
    serial_number: str
    status: str
    issued_at: datetime
    request_id: Optional[int] = None
    customer_id: Optional[int] = None
    job_id: Optional[int] = None
    technician_id: int


class IssuedBatchRead(BaseModel):
    issued_batch_id: int
    part_id: int
    sku: str
    name: str
    quantity_remaining: int
    issued_at: datetime
    request_id: Optional[int] = None
    customer_id: Optional[int] = None
    job_id: Optional[int] = None
    technician_id: int


class IssuedItemsResponse(BaseModel):
    instances: list[IssuedItemInstanceRead]
    batches: list[IssuedBatchRead]


class StockReturnCreate(BaseModel):
    part_id: Optional[int] = None
    item_instance_id: Optional[int] = None
    quantity: Optional[int] = None
    condition: str = "GOOD"
    notes: Optional[str] = None


class StockUsageRead(BaseModel):
    part_id: int
    total: int


class StockTrendPoint(BaseModel):
    date: str
    net: int
    inbound: int
    outbound: int


class ItemCreate(PartCreate):
    pass


class ItemUpdate(PartUpdate):
    pass


class ItemRead(PartRead):
    pass


class LocationStockRead(BaseModel):
    location_id: int
    location_name: str
    quantity_on_hand: int


class LocationStockUpdate(BaseModel):
    location_id: int
    quantity_on_hand: int = Field(ge=0)


class PaginatedItems(BaseModel):
    items: list[ItemRead]
    page: int
    page_size: int
    total: int


class PurchaseOrderLineCreate(BaseModel):
    part_id: int
    ordered_quantity: int = Field(ge=1)
    unit_cost: Optional[float] = Field(default=None, ge=0)


class PurchaseOrderCreate(BaseModel):
    supplier_id: int
    expected_date: Optional[datetime] = None
    notes: Optional[str] = None
    lines: list[PurchaseOrderLineCreate] = Field(min_length=1)


class PurchaseOrderLineRead(BaseModel):
    id: int
    part_id: int
    ordered_quantity: int
    received_quantity: int
    unit_cost: Optional[float] = None
    created_at: datetime
    updated_at: datetime


class PurchaseOrderRead(BaseModel):
    id: int
    supplier_id: int
    status: str
    order_date: date
    expected_date: Optional[datetime] = None
    approved_by_user_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    closed_at: Optional[datetime] = None
    notes: Optional[str] = None
    lines: list[PurchaseOrderLineRead]
    created_at: datetime
    updated_at: datetime


class PurchaseOrderStatusUpdate(BaseModel):
    status: str = Field(pattern="^(APPROVED|SENT|CANCELED|CLOSED)$")
    notes: Optional[str] = None


class PurchaseOrderDispatchRequest(BaseModel):
    recipient_email: Optional[EmailStr] = None
    message: Optional[str] = Field(default=None, max_length=2000)


class PurchaseOrderDispatchResult(BaseModel):
    purchase_order: PurchaseOrderRead
    dispatched: bool
    detail: str
    recipient_email: str


class GoodsReceiptLineCreate(BaseModel):
    purchase_order_line_id: int
    received_quantity: int = Field(ge=0)
    accepted_quantity: int = Field(ge=0)
    rejected_quantity: int = Field(ge=0)
    variance_reason: Optional[str] = None
    lot_code: Optional[str] = Field(default=None, max_length=80)
    expiry_date: Optional[date] = None


class GoodsReceiptCreate(BaseModel):
    grn_number: str = Field(min_length=3, max_length=60)
    notes: str = Field(min_length=3, max_length=2000)
    lines: list[GoodsReceiptLineCreate] = Field(min_length=1)


class GoodsReceiptLineRead(BaseModel):
    id: int
    purchase_order_line_id: int
    part_id: int
    received_quantity: int
    accepted_quantity: int
    rejected_quantity: int
    variance_reason: Optional[str] = None
    lot_code: Optional[str] = None
    expiry_date: Optional[date] = None
    created_at: datetime
    updated_at: datetime


class GoodsReceiptRead(BaseModel):
    id: int
    purchase_order_id: int
    received_by_user_id: Optional[int] = None
    grn_number: str
    notes: str
    received_at: datetime
    lines: list[GoodsReceiptLineRead]
    created_at: datetime
    updated_at: datetime


class StockTransferLineCreate(BaseModel):
    part_id: int
    quantity: int = Field(ge=1)


class StockTransferCreate(BaseModel):
    from_location_id: int
    to_location_id: int
    notes: Optional[str] = None
    lines: list[StockTransferLineCreate] = Field(min_length=1)


class StockTransferLineRead(BaseModel):
    id: int
    part_id: int
    quantity: int
    created_at: datetime
    updated_at: datetime


class StockTransferRead(BaseModel):
    id: int
    from_location_id: int
    to_location_id: int
    status: str
    approved_by_user_id: Optional[int] = None
    approved_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    notes: Optional[str] = None
    lines: list[StockTransferLineRead]
    created_at: datetime
    updated_at: datetime


class ReservationCreate(BaseModel):
    part_id: int
    quantity: int = Field(ge=1)
    request_id: Optional[int] = None
    notes: Optional[str] = None


class ReservationRead(BaseModel):
    id: int
    part_id: int
    quantity: int
    request_id: Optional[int] = None
    status: str
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CycleCountCreate(BaseModel):
    location_id: int
    notes: Optional[str] = None


class CycleCountLineUpdate(BaseModel):
    id: int
    counted_quantity: int = Field(ge=0)
    reason: Optional[str] = None


class CycleCountSubmit(BaseModel):
    lines: list[CycleCountLineUpdate] = Field(min_length=1)


class CycleCountDecision(BaseModel):
    notes: str = Field(min_length=3, max_length=2000)


class CycleCountLineRead(BaseModel):
    id: int
    part_id: int
    expected_quantity: int
    counted_quantity: Optional[int] = None
    variance_quantity: int
    reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class CycleCountRead(BaseModel):
    id: int
    location_id: int
    status: str
    submitted_by_user_id: Optional[int] = None
    approved_by_user_id: Optional[int] = None
    submitted_at: Optional[datetime] = None
    approved_at: Optional[datetime] = None
    rejected_reason: Optional[str] = None
    notes: Optional[str] = None
    lines: list[CycleCountLineRead]
    created_at: datetime
    updated_at: datetime


class ReplenishmentSuggestion(BaseModel):
    part_id: int
    sku: str
    name: str
    quantity_on_hand: int
    allocated_quantity: int
    available_quantity: int
    min_quantity: int
    safety_stock: int
    lead_time_days: int
    average_daily_outbound: float
    projected_demand_during_lead_time: float
    suggested_order_quantity: int
    risk_level: str


class KpiSummary(BaseModel):
    total_items: int
    low_stock_items: int
    stockout_items: int
    fill_rate_percent: float
    stockout_rate_percent: float
    inventory_turns_estimate: float
    aging_over_30_days: int
    aging_over_60_days: int
    aging_over_90_days: int


class ExecutiveSummary(BaseModel):
    period_start: date
    period_end: date
    purchase_orders_created: int
    purchase_orders_closed: int
    transfer_orders_completed: int
    cycle_counts_approved: int
    top_outbound_skus: list[str]


class AuditLogRead(BaseModel):
    id: int
    user_id: Optional[int] = None
    action: str
    entity_type: str
    entity_id: Optional[int] = None
    detail: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class AppSettingsRead(BaseModel):
    approval_threshold_manager: float
    approval_threshold_admin: float
    approval_individual_role: str = Field(default="none", pattern="^(none|manager|admin)$")
    low_stock_default_limit: int
    notification_email_enabled: bool = False
    notification_sms_enabled: bool = False
    notification_recipients: str = ""
    faulty_quarantine_location_id: Optional[int] = None
    branding_logo_url: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = ""
    smtp_use_tls: bool = True


class AppSettingsUpdate(BaseModel):
    approval_threshold_manager: Optional[float] = Field(default=None, ge=0)
    approval_threshold_admin: Optional[float] = Field(default=None, ge=0)
    approval_individual_role: Optional[str] = Field(default=None, pattern="^(none|manager|admin)$")
    low_stock_default_limit: Optional[int] = Field(default=None, ge=1, le=10000)
    notification_email_enabled: Optional[bool] = None
    notification_sms_enabled: Optional[bool] = None
    notification_recipients: Optional[str] = Field(default=None, max_length=2000)
    faulty_quarantine_location_id: Optional[int] = Field(default=None, ge=1)
    branding_logo_url: Optional[str] = Field(default=None, max_length=500000)
    smtp_host: Optional[str] = Field(default=None, max_length=255)
    smtp_port: Optional[int] = Field(default=None, ge=1, le=65535)
    smtp_username: Optional[str] = Field(default=None, max_length=255)
    smtp_password: Optional[str] = Field(default=None, max_length=255)
    smtp_from_email: Optional[str] = Field(default=None, max_length=255)
    smtp_use_tls: Optional[bool] = None


class AppSettingsTestEmailRequest(BaseModel):
    recipient: Optional[EmailStr] = None
    subject: Optional[str] = Field(default=None, max_length=255)


class AppSettingsTestEmailResponse(BaseModel):
    ok: bool
    detail: str
    recipient: str


class AppSettingsTestWhatsAppRequest(BaseModel):
    recipient: Optional[str] = None  # Phone number e.g. +254712345678


class AppSettingsTestWhatsAppResponse(BaseModel):
    ok: bool
    detail: str
    recipient: str


class BrandingSettingsRead(BaseModel):
    branding_logo_url: str = ""


class ProductAttachmentRead(BaseModel):
    id: int
    part_id: int
    file_name: str
    content_type: Optional[str] = None
    file_size: int
    uploaded_by_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


# --- New Inventory Science Schemas ---


class PartAnalysisRead(BaseModel):
    id: int
    part_id: int
    classification: str
    annual_usage_value: float
    usage_percentage: float
    reorder_point: int
    economic_order_qty: int
    review_frequency_days: int
    stockout_risk_level: str
    last_analyzed_at: datetime
    created_at: datetime
    updated_at: datetime


class PartAnalysisUpdate(BaseModel):
    classification: Optional[str] = None
    annual_usage_value: Optional[float] = None
    reorder_point: Optional[int] = None
    economic_order_qty: Optional[int] = None
    review_frequency_days: Optional[int] = None
    stockout_risk_level: Optional[str] = None


class DemandForecastRead(BaseModel):
    id: int
    part_id: int
    forecast_period: str
    forecast_qty: int
    confidence_level: float
    actual_qty: Optional[int] = None
    forecast_method: str
    is_seasonality_adjusted: bool
    created_at: datetime
    updated_at: datetime


class DemandForecastCreate(BaseModel):
    part_id: int
    forecast_period: str
    forecast_qty: int = Field(ge=0)
    confidence_level: float = Field(ge=0, le=1)
    forecast_method: str = "ROLLING_AVG"
    is_seasonality_adjusted: bool = False


class PickWaveRead(BaseModel):
    id: int
    wave_number: str
    status: str
    picked_by_user_id: Optional[int] = None
    picked_at: Optional[datetime] = None
    packed_at: Optional[datetime] = None
    planned_completion: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PickWaveCreate(BaseModel):
    wave_number: str
    planned_completion: Optional[datetime] = None
    notes: Optional[str] = None


class PickWaveUpdate(BaseModel):
    status: Optional[str] = None
    picked_by_user_id: Optional[int] = None
    picked_at: Optional[datetime] = None
    packed_at: Optional[datetime] = None
    notes: Optional[str] = None


class ReturnAuthorizationRead(BaseModel):
    id: int
    rma_number: str
    item_instance_id: int
    part_id: int
    return_reason: str
    status: str
    requested_by_user_id: int
    authorized_by_user_id: Optional[int] = None
    authorized_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    supplier_credit_memo_id: Optional[str] = None
    credit_amount: Optional[float] = None
    notes: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class ReturnAuthorizationCreate(BaseModel):
    item_instance_id: int
    part_id: int
    return_reason: str = Field(min_length=1, max_length=255)
    notes: Optional[str] = None


class ReturnAuthorizationUpdate(BaseModel):
    status: Optional[str] = None
    authorized_by_user_id: Optional[int] = None
    received_at: Optional[datetime] = None
    supplier_credit_memo_id: Optional[str] = None
    credit_amount: Optional[float] = None
    notes: Optional[str] = None


class InventoryMovementCostRead(BaseModel):
    id: int
    part_id: int
    goods_receipt_line_id: Optional[int] = None
    unit_cost: float
    quantity_available: int
    quantity_consumed: int
    cost_method: str
    layer_date: datetime
    created_at: datetime
    updated_at: datetime


class InventoryMovementCostCreate(BaseModel):
    part_id: int
    unit_cost: float = Field(ge=0)
    quantity_available: int = Field(ge=0)
    cost_method: str = "FIFO"
    goods_receipt_line_id: Optional[int] = None
