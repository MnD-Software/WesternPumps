from __future__ import annotations

from datetime import date, datetime, time
from enum import Enum
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, LargeBinary, Numeric, String, Text, Time, func
from sqlalchemy import Enum as SAEnum
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )


class Tenant(Base, TimestampMixin):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    code: Mapped[str] = mapped_column(String(80), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    full_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    role: Mapped[str] = mapped_column(String(50), default="technician")  # admin | lead_technician | technician | store_manager | manager | approver | finance | customer_wp
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # Technician-specific fields
    region: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # Nairobi/Industrial | Nakuru | Mombasa
    area_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # For site navigation

    created_jobs: Mapped[list["Job"]] = relationship(
        back_populates="created_by",
        foreign_keys="Job.created_by_user_id",
    )
    assigned_jobs: Mapped[list["Job"]] = relationship(
        back_populates="assigned_to",
        foreign_keys="Job.assigned_to_user_id",
    )
    stock_requests: Mapped[list["StockRequest"]] = relationship(
        back_populates="requested_by",
        foreign_keys="StockRequest.requested_by_user_id",
    )
    approvals: Mapped[list["StockRequest"]] = relationship(
        back_populates="approved_by",
        foreign_keys="StockRequest.approved_by_user_id",
    )
    technician_zones: Mapped[list["TechnicianZoneAssignment"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        order_by="TechnicianZoneAssignment.zone_order.asc()",
    )
    tenant: Mapped["Tenant"] = relationship()


class LoginFailure(Base, TimestampMixin):
    __tablename__ = "login_failures"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


class PasswordResetToken(Base, TimestampMixin):
    __tablename__ = "password_reset_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    token: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)

    user: Mapped["User"] = relationship()


class Category(Base, TimestampMixin):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    parent_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    parent: Mapped[Optional["Category"]] = relationship(remote_side=[id])
    parts: Mapped[list["Part"]] = relationship(back_populates="category")


class Location(Base, TimestampMixin):
    __tablename__ = "locations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    description: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)

    parts: Mapped[list["Part"]] = relationship(back_populates="location")
    item_instances: Mapped[list["ItemInstance"]] = relationship(back_populates="location")
    location_stocks: Mapped[list["PartLocationStock"]] = relationship(back_populates="location", cascade="all, delete-orphan")


class PartLocationStock(Base, TimestampMixin):
    __tablename__ = "part_location_stocks"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0)

    part: Mapped["Part"] = relationship(back_populates="location_stocks")
    location: Mapped["Location"] = relationship(back_populates="location_stocks")


class Customer(Base, TimestampMixin):
    __tablename__ = "customers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    name: Mapped[str] = mapped_column(String(255), index=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Enhanced location and personnel fields
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    capacity_personnel: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Number of personnel

    jobs: Mapped[list["Job"]] = relationship(back_populates="customer")


class Job(Base, TimestampMixin):
    __tablename__ = "jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="open")  # open|in_progress|pending_approval|completed|canceled
    priority: Mapped[str] = mapped_column(String(50), default="medium")  # low|medium|high
    site_location_label: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    site_latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    site_longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)

    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    assigned_to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)

    # Approval workflow fields
    approved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    approval_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    customer: Mapped["Customer"] = relationship(back_populates="jobs")
    created_by: Mapped[Optional["User"]] = relationship(
        back_populates="created_jobs",
        foreign_keys=[created_by_user_id],
    )
    assigned_to: Mapped[Optional["User"]] = relationship(
        back_populates="assigned_jobs",
        foreign_keys=[assigned_to_user_id],
    )
    job_costing: Mapped[Optional["JobCosting"]] = relationship(back_populates="job")
    approved_by: Mapped[Optional["User"]] = relationship(
        foreign_keys=[approved_by_user_id],
    )


class Part(Base, TimestampMixin):
    __tablename__ = "parts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    sku: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    image_url: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    unit_price: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    quantity_on_hand: Mapped[int] = mapped_column(Integer, default=0)
    allocated_quantity: Mapped[int] = mapped_column(Integer, default=0)
    min_quantity: Mapped[int] = mapped_column(Integer, default=0)
    safety_stock: Mapped[int] = mapped_column(Integer, default=0)
    lead_time_days: Mapped[int] = mapped_column(Integer, default=7)
    reorder_quantity: Mapped[int] = mapped_column(Integer, default=0)
    tracking_type: Mapped[str] = mapped_column(String(20), default="BATCH")  # BATCH | INDIVIDUAL
    barcode_value: Mapped[Optional[str]] = mapped_column(String(120), unique=True, index=True, nullable=True)
    unit_of_measure: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    category_id: Mapped[Optional[int]] = mapped_column(ForeignKey("categories.id"), nullable=True, index=True)
    location_id: Mapped[Optional[int]] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)
    ownership_type: Mapped[str] = mapped_column(String(20), default="OWNED")  # OWNED | CONSIGNED | VENDOR_MANAGED

    supplier_id: Mapped[Optional[int]] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)

    category: Mapped[Optional["Category"]] = relationship(back_populates="parts")
    location: Mapped[Optional["Location"]] = relationship(back_populates="parts")
    supplier: Mapped[Optional["Supplier"]] = relationship(back_populates="parts")
    stock_transactions: Mapped[list["StockTransaction"]] = relationship(back_populates="part")
    item_instances: Mapped[list["ItemInstance"]] = relationship(back_populates="part")
    location_stocks: Mapped[list["PartLocationStock"]] = relationship(back_populates="part", cascade="all, delete-orphan")
    attachments: Mapped[list["ProductAttachment"]] = relationship(back_populates="part", cascade="all, delete-orphan")
    part_analysis: Mapped[Optional["PartAnalysis"]] = relationship(back_populates="part", cascade="all, delete-orphan")


class Supplier(Base, TimestampMixin):
    __tablename__ = "suppliers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    contact_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    phone: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    email: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    # Enhanced location and driver fields
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    driver_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)  # Driver for supply drops
    capacity_personnel: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)  # Number of personnel

    parts: Mapped[list["Part"]] = relationship(back_populates="supplier")


class PurchaseOrderStatus(str, Enum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    SENT = "SENT"
    RECEIVING = "RECEIVING"
    CLOSED = "CLOSED"
    CANCELED = "CANCELED"


class PurchaseOrder(Base, TimestampMixin):
    __tablename__ = "purchase_orders"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    supplier_id: Mapped[int] = mapped_column(ForeignKey("suppliers.id"), index=True)
    status: Mapped[PurchaseOrderStatus] = mapped_column(
        SAEnum(PurchaseOrderStatus, name="purchase_order_status"),
        default=PurchaseOrderStatus.DRAFT,
        index=True,
    )
    order_date: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    expected_date: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    supplier: Mapped["Supplier"] = relationship()
    approved_by: Mapped[Optional["User"]] = relationship()
    lines: Mapped[list["PurchaseOrderLine"]] = relationship(back_populates="purchase_order", cascade="all, delete-orphan")
    receipts: Mapped[list["GoodsReceipt"]] = relationship(back_populates="purchase_order", cascade="all, delete-orphan")


class PurchaseOrderLine(Base, TimestampMixin):
    __tablename__ = "purchase_order_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    ordered_quantity: Mapped[int] = mapped_column(Integer, default=1)
    received_quantity: Mapped[int] = mapped_column(Integer, default=0)
    unit_cost: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)

    purchase_order: Mapped["PurchaseOrder"] = relationship(back_populates="lines")
    part: Mapped["Part"] = relationship()


class GoodsReceipt(Base, TimestampMixin):
    __tablename__ = "goods_receipts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    purchase_order_id: Mapped[int] = mapped_column(ForeignKey("purchase_orders.id"), index=True)
    received_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    grn_number: Mapped[str] = mapped_column(String(60), unique=True, index=True)
    notes: Mapped[str] = mapped_column(Text)
    received_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    purchase_order: Mapped["PurchaseOrder"] = relationship(back_populates="receipts")
    received_by: Mapped[Optional["User"]] = relationship()
    lines: Mapped[list["GoodsReceiptLine"]] = relationship(back_populates="receipt", cascade="all, delete-orphan")


class GoodsReceiptLine(Base, TimestampMixin):
    __tablename__ = "goods_receipt_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    goods_receipt_id: Mapped[int] = mapped_column(ForeignKey("goods_receipts.id"), index=True)
    purchase_order_line_id: Mapped[int] = mapped_column(ForeignKey("purchase_order_lines.id"), index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    received_quantity: Mapped[int] = mapped_column(Integer, default=0)
    accepted_quantity: Mapped[int] = mapped_column(Integer, default=0)
    rejected_quantity: Mapped[int] = mapped_column(Integer, default=0)
    variance_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lot_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    receipt: Mapped["GoodsReceipt"] = relationship(back_populates="lines")
    purchase_order_line: Mapped["PurchaseOrderLine"] = relationship()
    part: Mapped["Part"] = relationship()


class TransferStatus(str, Enum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    IN_TRANSIT = "IN_TRANSIT"
    COMPLETED = "COMPLETED"
    CANCELED = "CANCELED"


class StockTransfer(Base, TimestampMixin):
    __tablename__ = "stock_transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    from_location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    to_location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    status: Mapped[TransferStatus] = mapped_column(
        SAEnum(TransferStatus, name="transfer_status"),
        default=TransferStatus.DRAFT,
        index=True,
    )
    approved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    from_location: Mapped["Location"] = relationship(foreign_keys=[from_location_id])
    to_location: Mapped["Location"] = relationship(foreign_keys=[to_location_id])
    approved_by: Mapped[Optional["User"]] = relationship()
    lines: Mapped[list["StockTransferLine"]] = relationship(back_populates="transfer", cascade="all, delete-orphan")


class StockTransferLine(Base, TimestampMixin):
    __tablename__ = "stock_transfer_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    stock_transfer_id: Mapped[int] = mapped_column(ForeignKey("stock_transfers.id"), index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)

    transfer: Mapped["StockTransfer"] = relationship(back_populates="lines")
    part: Mapped["Part"] = relationship()


class ReservationStatus(str, Enum):
    ACTIVE = "ACTIVE"
    RELEASED = "RELEASED"
    FULFILLED = "FULFILLED"


class StockReservation(Base, TimestampMixin):
    __tablename__ = "stock_reservations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    request_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_requests.id"), nullable=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[ReservationStatus] = mapped_column(
        SAEnum(ReservationStatus, name="reservation_status"),
        default=ReservationStatus.ACTIVE,
        index=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    part: Mapped["Part"] = relationship()
    request: Mapped[Optional["StockRequest"]] = relationship()


class CycleCountStatus(str, Enum):
    OPEN = "OPEN"
    SUBMITTED = "SUBMITTED"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


class CycleCount(Base, TimestampMixin):
    __tablename__ = "cycle_counts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    location_id: Mapped[int] = mapped_column(ForeignKey("locations.id"), index=True)
    status: Mapped[CycleCountStatus] = mapped_column(
        SAEnum(CycleCountStatus, name="cycle_count_status"),
        default=CycleCountStatus.OPEN,
        index=True,
    )
    submitted_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    approved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    submitted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    variance_analysis_status: Mapped[str] = mapped_column(String(50), default="OPEN")  # OPEN | ROOT_CAUSE_ASSIGNED | RESOLVED
    root_cause: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)  # SHRINKAGE | DATA_ERROR | RECOUNT_PENDING | SUPPLIER_ERROR
    resolution_deadline: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    location: Mapped["Location"] = relationship()
    submitted_by: Mapped[Optional["User"]] = relationship(foreign_keys=[submitted_by_user_id])
    approved_by: Mapped[Optional["User"]] = relationship(foreign_keys=[approved_by_user_id])
    lines: Mapped[list["CycleCountLine"]] = relationship(back_populates="cycle_count", cascade="all, delete-orphan")


class CycleCountLine(Base, TimestampMixin):
    __tablename__ = "cycle_count_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    cycle_count_id: Mapped[int] = mapped_column(ForeignKey("cycle_counts.id"), index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    expected_quantity: Mapped[int] = mapped_column(Integer, default=0)
    counted_quantity: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    variance_quantity: Mapped[int] = mapped_column(Integer, default=0)
    reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    cycle_count: Mapped["CycleCount"] = relationship(back_populates="lines")
    part: Mapped["Part"] = relationship()


class StockTransactionType(str, Enum):
    IN = "IN"
    OUT = "OUT"
    ADJUST = "ADJUST"


class StockTransaction(Base, TimestampMixin):
    __tablename__ = "stock_transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)

    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    supplier_id: Mapped[Optional[int]] = mapped_column(ForeignKey("suppliers.id"), nullable=True, index=True)
    created_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    request_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_requests.id"), nullable=True, index=True)
    technician_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    item_instance_id: Mapped[Optional[int]] = mapped_column(ForeignKey("item_instances.id"), nullable=True, index=True)
    movement_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    grn_number: Mapped[Optional[str]] = mapped_column(String(60), nullable=True, index=True)

    transaction_type: Mapped[StockTransactionType] = mapped_column(
        SAEnum(StockTransactionType, name="stock_transaction_type"),
    )
    quantity_delta: Mapped[int] = mapped_column(Integer)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    part: Mapped["Part"] = relationship(back_populates="stock_transactions")
    supplier: Mapped[Optional["Supplier"]] = relationship()
    created_by: Mapped[Optional["User"]] = relationship(foreign_keys=[created_by_user_id])
    technician: Mapped[Optional["User"]] = relationship(foreign_keys=[technician_id])
    request: Mapped[Optional["StockRequest"]] = relationship(back_populates="transactions")
    item_instance: Mapped[Optional["ItemInstance"]] = relationship(back_populates="transactions")


class ItemStatus(str, Enum):
    AVAILABLE = "AVAILABLE"
    ISSUED = "ISSUED"
    USED = "USED"
    RETURNED = "RETURNED"
    FAULTY = "FAULTY"


class ItemInstance(Base, TimestampMixin):
    __tablename__ = "item_instances"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    serial_number: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    barcode_value: Mapped[Optional[str]] = mapped_column(String(120), unique=True, index=True, nullable=True)
    lot_code: Mapped[Optional[str]] = mapped_column(String(80), nullable=True, index=True)
    expiry_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[ItemStatus] = mapped_column(SAEnum(ItemStatus, name="item_status"), default=ItemStatus.AVAILABLE)
    location_id: Mapped[Optional[int]] = mapped_column(ForeignKey("locations.id"), nullable=True, index=True)

    part: Mapped["Part"] = relationship(back_populates="item_instances")
    location: Mapped[Optional["Location"]] = relationship(back_populates="item_instances")
    transactions: Mapped[list["StockTransaction"]] = relationship(back_populates="item_instance")
    usage_records: Mapped[list["UsageRecord"]] = relationship(back_populates="item_instance")


class IssuedBatchItem(Base, TimestampMixin):
    __tablename__ = "issued_batch_items"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    request_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_requests.id"), nullable=True, index=True)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    quantity_remaining: Mapped[int] = mapped_column(Integer, default=0)

    part: Mapped["Part"] = relationship()
    technician: Mapped["User"] = relationship()
    request: Mapped[Optional["StockRequest"]] = relationship()


class StockRequestStatus(str, Enum):
    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    NOT_ISSUED = "NOT_ISSUED"
    ISSUED = "ISSUED"
    CLOSED = "CLOSED"


class StockRequest(Base, TimestampMixin):
    __tablename__ = "stock_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    status: Mapped[StockRequestStatus] = mapped_column(SAEnum(StockRequestStatus, name="stock_request_status"))
    total_value: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    required_approval_role: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    approved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_comment: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rejected_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    not_issued_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    not_issued_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    not_issued_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    closure_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)  # RETURNED | SOLD
    closed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    wave_id: Mapped[Optional[int]] = mapped_column(ForeignKey("pick_waves.id"), nullable=True, index=True)

    requested_by: Mapped["User"] = relationship(back_populates="stock_requests", foreign_keys=[requested_by_user_id])
    approved_by: Mapped[Optional["User"]] = relationship(back_populates="approvals", foreign_keys=[approved_by_user_id])
    not_issued_by: Mapped[Optional["User"]] = relationship(foreign_keys=[not_issued_by_user_id])
    lines: Mapped[list["StockRequestLine"]] = relationship(back_populates="request", cascade="all, delete-orphan")
    transactions: Mapped[list["StockTransaction"]] = relationship(back_populates="request")


class StockRequestLine(Base, TimestampMixin):
    __tablename__ = "stock_request_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    request_id: Mapped[int] = mapped_column(ForeignKey("stock_requests.id"), index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    unit_cost: Mapped[Optional[float]] = mapped_column(Numeric(10, 2), nullable=True)
    tracking_type: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    request: Mapped["StockRequest"] = relationship(back_populates="lines")
    part: Mapped["Part"] = relationship()


class DeliveryRequestStatus(str, Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    PICKED_UP = "PICKED_UP"
    DELIVERED = "DELIVERED"
    CANCELED = "CANCELED"


class DeliveryRequest(Base, TimestampMixin):
    __tablename__ = "delivery_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    stock_request_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_requests.id"), nullable=True, index=True)
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    assigned_to_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    delivery_mode: Mapped[str] = mapped_column(String(20), default="RIDER")  # RIDER | DRIVER
    status: Mapped[DeliveryRequestStatus] = mapped_column(
        SAEnum(DeliveryRequestStatus, name="delivery_request_status"),
        default=DeliveryRequestStatus.PENDING,
        index=True,
    )
    pickup_location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    dropoff_location: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    equipment_summary: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    approved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    rejected_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    picked_up_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    canceled_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    stock_request: Mapped[Optional["StockRequest"]] = relationship()
    technician: Mapped["User"] = relationship(foreign_keys=[technician_id])
    requested_by: Mapped["User"] = relationship(foreign_keys=[requested_by_user_id])
    assigned_to: Mapped[Optional["User"]] = relationship(foreign_keys=[assigned_to_user_id])
    approved_by: Mapped[Optional["User"]] = relationship(foreign_keys=[approved_by_user_id])


class UsageRecord(Base, TimestampMixin):
    __tablename__ = "usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    item_instance_id: Mapped[int] = mapped_column(ForeignKey("item_instances.id"), index=True)
    request_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_requests.id"), nullable=True, index=True)
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    used_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    record_hash: Mapped[str] = mapped_column(String(64), index=True)

    item_instance: Mapped["ItemInstance"] = relationship(back_populates="usage_records")


class BatchUsageRecord(Base, TimestampMixin):
    __tablename__ = "batch_usage_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    request_id: Mapped[Optional[int]] = mapped_column(ForeignKey("stock_requests.id"), nullable=True, index=True)
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    customer_id: Mapped[Optional[int]] = mapped_column(ForeignKey("customers.id"), nullable=True, index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)


class AuditLog(Base, TimestampMixin):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    action: Mapped[str] = mapped_column(String(100))
    entity_type: Mapped[str] = mapped_column(String(100))
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    detail: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    prev_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    entry_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)


class AppSetting(Base, TimestampMixin):
    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    key: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    value: Mapped[str] = mapped_column(Text)
    updated_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    updated_by: Mapped[Optional["User"]] = relationship()


class ProductAttachment(Base, TimestampMixin):
    __tablename__ = "product_attachments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    file_data: Mapped[bytes] = mapped_column(LargeBinary)
    uploaded_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)

    part: Mapped["Part"] = relationship(back_populates="attachments")
    uploaded_by: Mapped[Optional["User"]] = relationship()


class UserPreference(Base, TimestampMixin):
    __tablename__ = "user_preferences"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True, index=True)
    default_landing_page: Mapped[str] = mapped_column(String(64), default="/dashboard")
    dense_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    animations_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    show_email_in_header: Mapped[bool] = mapped_column(Boolean, default=True)
    display_name_override: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)

    user: Mapped["User"] = relationship()


class TechnicianZoneAssignment(Base, TimestampMixin):
    __tablename__ = "technician_zone_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    region_label: Mapped[str] = mapped_column(String(255), index=True)
    station_name: Mapped[str] = mapped_column(String(255))
    client_code: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    zone_order: Mapped[int] = mapped_column(Integer, default=0)

    user: Mapped["User"] = relationship(back_populates="technician_zones")


class PartAnalysis(Base, TimestampMixin):
    """ABC/VED analysis for inventory optimization"""
    __tablename__ = "part_analysis"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), unique=True, index=True)
    classification: Mapped[str] = mapped_column(String(1), index=True)  # A | B | C
    annual_usage_value: Mapped[float] = mapped_column(Numeric(12, 2))
    usage_percentage: Mapped[float] = mapped_column(Numeric(5, 2))  # % of total value
    reorder_point: Mapped[int] = mapped_column(Integer)
    economic_order_qty: Mapped[int] = mapped_column(Integer)
    review_frequency_days: Mapped[int] = mapped_column(Integer, default=30)  # How often to review
    stockout_risk_level: Mapped[str] = mapped_column(String(20), default="LOW")  # LOW | MEDIUM | HIGH
    last_analyzed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    part: Mapped["Part"] = relationship(back_populates="part_analysis")


class DemandForecast(Base, TimestampMixin):
    """Rolling demand forecast for safety stock and planning"""
    __tablename__ = "demand_forecasts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    forecast_period: Mapped[str] = mapped_column(String(50), index=True)  # "2026-02" or "week_8"
    forecast_qty: Mapped[int] = mapped_column(Integer)
    confidence_level: Mapped[float] = mapped_column(Numeric(5, 2))  # 0.0-1.0 (0-100%)
    actual_qty: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    forecast_method: Mapped[str] = mapped_column(String(50))  # ROLLING_AVG | EXPONENTIAL_SMOOTHING | ARIMA | MANUAL
    is_seasonality_adjusted: Mapped[bool] = mapped_column(Boolean, default=False)


class PickWave(Base, TimestampMixin):
    """Wave picking optimization groups multiple requests for batch picking"""
    __tablename__ = "pick_waves"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    wave_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(50), default="OPEN")  # OPEN | ALLOCATED | PICKED | PACKED | SHIPPED
    picked_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    picked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    packed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    planned_completion: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    picked_by: Mapped[Optional["User"]] = relationship()


class ReturnAuthorization(Base, TimestampMixin):
    """RMA tracking for returns from technicians or dealers"""
    __tablename__ = "return_authorizations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    rma_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    item_instance_id: Mapped[int] = mapped_column(ForeignKey("item_instances.id"), index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    return_reason: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(50), default="OPEN")  # OPEN | RECEIVED | ANALYZED | CREDITED | REJECTED
    requested_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    authorized_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    authorized_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    received_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    supplier_credit_memo_id: Mapped[Optional[str]] = mapped_column(String(80), nullable=True)
    credit_amount: Mapped[Optional[float]] = mapped_column(Numeric(12, 2), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    item_instance: Mapped["ItemInstance"] = relationship()
    part: Mapped["Part"] = relationship()
    requested_by: Mapped["User"] = relationship(foreign_keys=[requested_by_user_id])
    authorized_by: Mapped[Optional["User"]] = relationship(foreign_keys=[authorized_by_user_id])


class InventoryMovementCost(Base, TimestampMixin):
    """Cost layer tracking for FIFO/LIFO/Weighted Average cost flow"""
    __tablename__ = "inventory_movement_costs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    goods_receipt_line_id: Mapped[Optional[int]] = mapped_column(ForeignKey("goods_receipt_lines.id"), nullable=True)
    unit_cost: Mapped[float] = mapped_column(Numeric(12, 4))
    quantity_available: Mapped[int] = mapped_column(Integer)
    quantity_consumed: Mapped[int] = mapped_column(Integer, default=0)
    cost_method: Mapped[str] = mapped_column(String(50), default="FIFO")  # FIFO | LIFO | WEIGHTED_AVG
    layer_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    part: Mapped["Part"] = relationship()
    goods_receipt_line: Mapped[Optional["GoodsReceiptLine"]] = relationship()


class DomainEvent(Base, TimestampMixin):
    __tablename__ = "domain_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    event_type: Mapped[str] = mapped_column(String(120), index=True)
    actor_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    payload_json: Mapped[str] = mapped_column(Text)

    actor: Mapped[Optional["User"]] = relationship()


class OutboxEvent(Base, TimestampMixin):
    __tablename__ = "outbox_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    event_type: Mapped[str] = mapped_column(String(120), index=True)
    payload_json: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="PENDING", index=True)  # PENDING | PROCESSING | DONE | FAILED | DEAD
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=8)
    available_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    processed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)
    last_error: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    lock_token: Mapped[Optional[str]] = mapped_column(String(120), nullable=True, index=True)
    locked_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True, index=True)


# ============================================
# NEW MODELS FOR EXTENDED FEATURES
# ============================================


class JobPhoto(Base, TimestampMixin):
    """Photo documentation for jobs and returns"""
    __tablename__ = "job_photos"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    return_id: Mapped[Optional[int]] = mapped_column(ForeignKey("return_authorizations.id"), nullable=True, index=True)
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    file_name: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    file_size: Mapped[int] = mapped_column(Integer, default=0)
    file_data: Mapped[bytes] = mapped_column(LargeBinary)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    photo_type: Mapped[str] = mapped_column(String(50), default="GENERAL")  # GENERAL | BEFORE | AFTER | DEFECT | PROGRESS
    latitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)
    longitude: Mapped[Optional[float]] = mapped_column(Numeric(9, 6), nullable=True)

    job: Mapped[Optional["Job"]] = relationship(foreign_keys=[job_id])
    return_auth: Mapped[Optional["ReturnAuthorization"]] = relationship(foreign_keys=[return_id])
    uploaded_by: Mapped["User"] = relationship()


class InvoiceStatus(str, Enum):
    DRAFT = "DRAFT"
    SENT = "SENT"
    PAID = "PAID"
    PARTIAL = "PARTIAL"
    OVERDUE = "OVERDUE"
    CANCELED = "CANCELED"


class Invoice(Base, TimestampMixin):
    """Invoice generation for jobs and services"""
    __tablename__ = "invoices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    invoice_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    status: Mapped[InvoiceStatus] = mapped_column(SAEnum(InvoiceStatus, name="invoice_status"), default=InvoiceStatus.DRAFT, index=True)
    issue_date: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    subtotal: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    tax_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    discount_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    total_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    paid_amount: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    terms: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    customer: Mapped["Customer"] = relationship()
    job: Mapped[Optional["Job"]] = relationship()
    lines: Mapped[list["InvoiceLine"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")
    payments: Mapped[list["Payment"]] = relationship(back_populates="invoice", cascade="all, delete-orphan")


class InvoiceLine(Base, TimestampMixin):
    """Line items for invoices"""
    __tablename__ = "invoice_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    part_id: Mapped[Optional[int]] = mapped_column(ForeignKey("parts.id"), nullable=True, index=True)
    description: Mapped[str] = mapped_column(String(255))
    quantity: Mapped[float] = mapped_column(Numeric(10, 2), default=1)
    unit_price: Mapped[float] = mapped_column(Numeric(12, 2))
    line_total: Mapped[float] = mapped_column(Numeric(12, 2))
    line_type: Mapped[str] = mapped_column(String(50), default="PRODUCT")  # PRODUCT | SERVICE | LABOR | PARTS | OTHER

    invoice: Mapped["Invoice"] = relationship(back_populates="lines")
    part: Mapped[Optional["Part"]] = relationship()


class PaymentStatus(str, Enum):
    PENDING = "PENDING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    REFUNDED = "REFUNDED"


class PaymentMethod(str, Enum):
    CASH = "CASH"
    CARD = "CARD"
    BANK_TRANSFER = "BANK_TRANSFER"
    CHECK = "CHECK"
    ONLINE = "ONLINE"
    OTHER = "OTHER"


class Payment(Base, TimestampMixin):
    """Payment tracking for invoices"""
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    invoice_id: Mapped[int] = mapped_column(ForeignKey("invoices.id"), index=True)
    payment_number: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    status: Mapped[PaymentStatus] = mapped_column(SAEnum(PaymentStatus, name="payment_status"), default=PaymentStatus.PENDING, index=True)
    payment_method: Mapped[PaymentMethod] = mapped_column(SAEnum(PaymentMethod, name="payment_method"), default=PaymentMethod.CASH)
    payment_date: Mapped[date] = mapped_column(Date, server_default=func.current_date())
    reference_number: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    recorded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    invoice: Mapped["Invoice"] = relationship(back_populates="payments")
    recorded_by: Mapped["User"] = relationship()


class JobCosting(Base, TimestampMixin):
    """Job costing - links parts usage and labor to jobs for profitability tracking"""
    __tablename__ = "job_costing"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), index=True)
    labor_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    parts_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    travel_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    other_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    total_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    revenue: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    profit_margin: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    calculated_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    job: Mapped["Job"] = relationship()


class JobSchedule(Base, TimestampMixin):
    """Job scheduling with calendar view"""
    __tablename__ = "job_schedules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    job_id: Mapped[int] = mapped_column(ForeignKey("jobs.id"), index=True)
    scheduled_date: Mapped[date] = mapped_column(Date, index=True)
    start_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    end_time: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    assigned_technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[str] = mapped_column(String(50), default="SCHEDULED")  # SCHEDULED | IN_PROGRESS | COMPLETED | CANCELLED
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    recurrence_rule: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # For recurring jobs

    job: Mapped["Job"] = relationship()
    assigned_technician: Mapped["User"] = relationship()


class TechnicianLabor(Base, TimestampMixin):
    """Technician labor tracking - tracks fuel and fare expenses for technicians"""
    __tablename__ = "technician_labor"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    labor_hours: Mapped[float] = mapped_column(Numeric(6, 2), default=0)
    labor_rate: Mapped[float] = mapped_column(Numeric(10, 2), default=0)
    labor_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    fuel_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    fare_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    other_expenses: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    total_cost: Mapped[float] = mapped_column(Numeric(12, 2), default=0)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="PENDING")
    approved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    approved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)


class TechnicianAvailability(Base, TimestampMixin):
    """Technician availability tracking"""
    __tablename__ = "technician_availability"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    technician_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    start_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    end_time: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True)
    availability_type: Mapped[str] = mapped_column(String(50), default="WORKING")  # WORKING | VACATION | SICK | TRAINING | OFF
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    technician: Mapped["User"] = relationship()


class AppointmentBooking(Base, TimestampMixin):
    """Customer self-service appointment booking"""
    __tablename__ = "appointment_bookings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    booking_reference: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    requested_date: Mapped[date] = mapped_column(Date, index=True)
    requested_time_start: Mapped[time] = mapped_column(Time)
    requested_time_end: Mapped[time] = mapped_column(Time)
    service_type: Mapped[str] = mapped_column(String(100))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(50), default="PENDING")  # PENDING | CONFIRMED | COMPLETED | CANCELLED
    job_id: Mapped[Optional[int]] = mapped_column(ForeignKey("jobs.id"), nullable=True, index=True)
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    customer_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    customer: Mapped["Customer"] = relationship()
    job: Mapped[Optional["Job"]] = relationship()


class PushNotification(Base, TimestampMixin):
    """Push notifications for real-time alerts"""
    __tablename__ = "push_notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    message: Mapped[str] = mapped_column(Text)
    notification_type: Mapped[str] = mapped_column(String(50), index=True)  # JOB_ASSIGNED | JOB_UPDATED | STOCK_LOW | URGENT | APPROVAL | GENERAL
    entity_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    delivered_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()


class DeviceToken(Base, TimestampMixin):
    """Device tokens for push notifications"""
    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    token: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    device_type: Mapped[str] = mapped_column(String(50))  # ANDROID | IOS | WEB
    device_name: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    user: Mapped["User"] = relationship()


class CustomerPortalUser(Base, TimestampMixin):
    """Customer portal access for self-service"""
    __tablename__ = "customer_portal_users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    customer_id: Mapped[int] = mapped_column(ForeignKey("customers.id"), index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    email_verified: Mapped[bool] = mapped_column(Boolean, default=False)
    last_login_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_token: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    reset_token: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    reset_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)

    customer: Mapped["Customer"] = relationship()


class CustomReportDefinition(Base, TimestampMixin):
    """Custom report builder definitions"""
    __tablename__ = "custom_report_definitions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    name: Mapped[str] = mapped_column(String(200))
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    report_type: Mapped[str] = mapped_column(String(50), index=True)  # INVENTORY | JOBS | FINANCIAL | CUSTOMERS | STOCK
    entity_table: Mapped[str] = mapped_column(String(100))  # parts, jobs, invoices, etc.
    fields_json: Mapped[str] = mapped_column(Text)  # JSON array of field definitions
    filters_json: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON of default filters
    group_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    sort_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    sort_order: Mapped[str] = mapped_column(String(10), default="ASC")
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    is_public: Mapped[bool] = mapped_column(Boolean, default=False)

    created_by: Mapped["User"] = relationship()


class ReorderAlert(Base, TimestampMixin):
    """Reorder alerts when inventory falls below threshold"""
    __tablename__ = "reorder_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("parts.id"), index=True)
    alert_type: Mapped[str] = mapped_column(String(50), default="LOW_STOCK")  # LOW_STOCK | REORDER_POINT | SAFETY_STOCK
    current_quantity: Mapped[int] = mapped_column(Integer)
    threshold_quantity: Mapped[int] = mapped_column(Integer)
    is_resolved: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    resolved_by_user_id: Mapped[Optional[int]] = mapped_column(ForeignKey("users.id"), nullable=True)
    auto_created_po: Mapped[bool] = mapped_column(Boolean, default=False)
    related_po_id: Mapped[Optional[int]] = mapped_column(ForeignKey("purchase_orders.id"), nullable=True)

    part: Mapped["Part"] = relationship()
    resolved_by: Mapped[Optional["User"]] = relationship()
    related_po: Mapped[Optional["PurchaseOrder"]] = relationship()


class EmailNotificationLog(Base, TimestampMixin):
    """Email notification tracking"""
    __tablename__ = "email_notification_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    recipient_email: Mapped[str] = mapped_column(String(255), index=True)
    recipient_name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    subject: Mapped[str] = mapped_column(String(500))
    template_type: Mapped[str] = mapped_column(String(50), index=True)  # JOB_CREATED | JOB_UPDATED | INVOICE_SENT | PAYMENT_RECEIVED | STOCK_ALERT
    status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING | SENT | FAILED
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    related_entity_type: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    related_entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)


class OfflineSyncQueue(Base, TimestampMixin):
    """Offline mode sync queue for technicians working without internet"""
    __tablename__ = "offline_sync_queue"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), default=1, index=True)
    device_token_id: Mapped[int] = mapped_column(ForeignKey("device_tokens.id"), index=True)
    operation_type: Mapped[str] = mapped_column(String(50), index=True)  # CREATE | UPDATE | DELETE
    entity_type: Mapped[str] = mapped_column(String(50), index=True)  # job | stock_request | usage_record | etc.
    entity_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    payload_json: Mapped[str] = mapped_column(Text)
    local_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    server_timestamp: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    sync_status: Mapped[str] = mapped_column(String(20), default="PENDING")  # PENDING | SYNCED | FAILED | CONFLICT
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    device_token: Mapped["DeviceToken"] = relationship()


# Add QR code field to Part model (handled via migration)
# The Part model already has barcode_value field - we'll use it for QR codes too
