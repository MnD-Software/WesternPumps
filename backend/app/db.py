from __future__ import annotations

from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy import event
from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker, with_loader_criteria
from sqlalchemy.pool import StaticPool

from app.config import settings


class Base(DeclarativeBase):
    pass


engine_kwargs: dict[str, object] = {"pool_pre_ping": True}
if settings.database_url.startswith("sqlite"):
    engine_kwargs = {"connect_args": {"check_same_thread": False}}
    if ":memory:" in settings.database_url:
        engine_kwargs["poolclass"] = StaticPool
elif settings.database_url.startswith("postgresql"):
    engine_kwargs["connect_args"] = {"connect_timeout": 5}
elif settings.database_url.startswith("mysql"):
    engine_kwargs["connect_args"] = {"connect_timeout": 5}

engine = create_engine(settings.database_url, **engine_kwargs)

SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)


def _tenant_models():
    # Local import avoids circular import while keeping declarative metadata in app.models.
    from app import models as m

    return (
        m.User,
        m.Customer,
        m.Job,
        m.Part,
        m.Supplier,
        m.PurchaseOrder,
        m.PurchaseOrderLine,
        m.GoodsReceipt,
        m.GoodsReceiptLine,
        m.StockTransfer,
        m.StockTransferLine,
        m.StockReservation,
        m.CycleCount,
        m.CycleCountLine,
        m.StockTransaction,
        m.ItemInstance,
        m.IssuedBatchItem,
        m.StockRequest,
        m.StockRequestLine,
        m.UsageRecord,
        m.BatchUsageRecord,
        m.AuditLog,
        m.ProductAttachment,
        m.TechnicianZoneAssignment,
        m.PartAnalysis,
        m.DemandForecast,
        m.PickWave,
        m.ReturnAuthorization,
        m.InventoryMovementCost,
        m.DomainEvent,
        m.OutboxEvent,
        m.DeliveryRequest,
    )


@event.listens_for(Session, "do_orm_execute")
def _tenant_scope_orm_statements(execute_state):
    tenant_id = execute_state.session.info.get("tenant_id")
    if tenant_id is None or not execute_state.is_select:
        return
    options = [
        with_loader_criteria(model, lambda cls: cls.tenant_id == tenant_id, include_aliases=True)
        for model in _tenant_models()
    ]
    execute_state.statement = execute_state.statement.options(*options)


@event.listens_for(Session, "before_flush")
def _tenant_scope_new_objects(session: Session, flush_context, instances):
    _ = flush_context, instances
    tenant_id = session.info.get("tenant_id")
    if tenant_id is None:
        return
    for obj in session.new:
        if hasattr(obj, "tenant_id") and getattr(obj, "tenant_id", None) is None:
            setattr(obj, "tenant_id", int(tenant_id))


def ensure_schema(engine: Engine) -> None:
    """
    Best-effort schema setup for development.

    This project currently does not use Alembic migrations. `create_all()` only
    creates missing tables and does not add new columns to existing tables, so
    we patch forward a small set of additive changes required by the app.
    """

    Base.metadata.create_all(bind=engine)

    inspector = inspect(engine)
    dialect = engine.dialect.name
    datetime_type = "TIMESTAMP" if dialect == "postgresql" else "DATETIME"
    bool_true = "TRUE" if dialect == "postgresql" else "1"
    bool_false = "FALSE" if dialect == "postgresql" else "0"
    if not inspector.has_table("tenants"):
        table = Base.metadata.tables.get("tenants")
        if table is not None:
            table.create(bind=engine)
    with engine.begin() as conn:
        conn.execute(
            text(
                """
                INSERT INTO tenants (id, name, code, is_active, created_at, updated_at)
                SELECT 1, 'WesternPumps', 'default', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                WHERE NOT EXISTS (SELECT 1 FROM tenants WHERE id = 1)
                """
            )
        )

    if not inspector.has_table("parts"):
        return

    if not inspector.has_table("part_location_stocks"):
        table = Base.metadata.tables.get("part_location_stocks")
        if table is not None:
            table.create(bind=engine)

    if not inspector.has_table("issued_batch_items"):
        table = Base.metadata.tables.get("issued_batch_items")
        if table is not None:
            table.create(bind=engine)

    if not inspector.has_table("user_preferences"):
        table = Base.metadata.tables.get("user_preferences")
        if table is not None:
            table.create(bind=engine)
    if not inspector.has_table("technician_zone_assignments"):
        table = Base.metadata.tables.get("technician_zone_assignments")
        if table is not None:
            table.create(bind=engine)
    if not inspector.has_table("domain_events"):
        table = Base.metadata.tables.get("domain_events")
        if table is not None:
            table.create(bind=engine)
    if not inspector.has_table("outbox_events"):
        table = Base.metadata.tables.get("outbox_events")
        if table is not None:
            table.create(bind=engine)

    # Add missing columns for job approval workflow (additive migration)
    with engine.begin() as conn:
        # Check if jobs table exists and add missing columns
        if inspector.has_table("jobs"):
            existing_columns = [c["name"] for c in inspector.get_columns("jobs")]
            if "approved_by_user_id" not in existing_columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN approved_by_user_id INTEGER"))
            if "approved_at" not in existing_columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN approved_at TIMESTAMP"))
            if "approval_notes" not in existing_columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN approval_notes TEXT"))

        # Add missing columns for users table (region and area_code for technicians)
        if inspector.has_table("users"):
            user_columns = [c["name"] for c in inspector.get_columns("users")]
            if "region" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN region VARCHAR(100)"))
            if "area_code" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN area_code VARCHAR(50)"))
            if "must_change_password" not in user_columns:
                conn.execute(
                    text(
                        f"ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT {bool_false}"
                    )
                )

        # Add missing columns for customers table (latitude, longitude, capacity_personnel)
        if inspector.has_table("customers"):
            customer_columns = [c["name"] for c in inspector.get_columns("customers")]
            if "latitude" not in customer_columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN latitude NUMERIC(9, 6)"))
            if "longitude" not in customer_columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN longitude NUMERIC(9, 6)"))
            if "capacity_personnel" not in customer_columns:
                conn.execute(text("ALTER TABLE customers ADD COLUMN capacity_personnel INTEGER"))

        # Add missing columns for suppliers table (latitude, longitude, driver_name, capacity_personnel)
        if inspector.has_table("suppliers"):
            supplier_columns = [c["name"] for c in inspector.get_columns("suppliers")]
            if "latitude" not in supplier_columns:
                conn.execute(text("ALTER TABLE suppliers ADD COLUMN latitude NUMERIC(9, 6)"))
            if "longitude" not in supplier_columns:
                conn.execute(text("ALTER TABLE suppliers ADD COLUMN longitude NUMERIC(9, 6)"))
            if "driver_name" not in supplier_columns:
                conn.execute(text("ALTER TABLE suppliers ADD COLUMN driver_name VARCHAR(255)"))
            if "capacity_personnel" not in supplier_columns:
                conn.execute(text("ALTER TABLE suppliers ADD COLUMN capacity_personnel INTEGER"))

        # Create technician_labor table if not exists
        if not inspector.has_table("technician_labor"):
            table = Base.metadata.tables.get("technician_labor")
            if table is not None:
                table.create(bind=engine)

    tenant_tables = [
        "users",
        "customers",
        "jobs",
        "parts",
        "suppliers",
        "purchase_orders",
        "purchase_order_lines",
        "goods_receipts",
        "goods_receipt_lines",
        "stock_transfers",
        "stock_transfer_lines",
        "stock_reservations",
        "cycle_counts",
        "cycle_count_lines",
        "stock_transactions",
        "item_instances",
        "issued_batch_items",
        "stock_requests",
        "stock_request_lines",
        "usage_records",
        "batch_usage_records",
        "audit_logs",
        "app_settings",
        "product_attachments",
        "technician_zone_assignments",
        "domain_events",
        "outbox_events",
        "delivery_requests",
    ]
    for table_name in tenant_tables:
        if not inspector.has_table(table_name):
            continue
        columns = {c["name"] for c in inspector.get_columns(table_name)}
        if "tenant_id" not in columns:
            with engine.begin() as conn:
                conn.execute(text(f"ALTER TABLE {table_name} ADD COLUMN tenant_id INTEGER NOT NULL DEFAULT 1"))
        indexes = inspector.get_indexes(table_name)
        has_tenant_idx = any("tenant_id" in (idx.get("column_names") or []) for idx in indexes)
        if not has_tenant_idx:
            with engine.begin() as conn:
                conn.execute(text(f"CREATE INDEX ix_{table_name}_tenant_id ON {table_name} (tenant_id)"))
    if inspector.has_table("user_preferences"):
        pref_indexes = inspector.get_indexes("user_preferences")
        has_user_pref_unique = any(
            idx.get("unique") and (idx.get("column_names") or []) == ["user_id"] for idx in pref_indexes
        )
        if not has_user_pref_unique:
            with engine.begin() as conn:
                # Keep only the latest row per user before applying unique index.
                conn.execute(
                    text(
                        """
                        DELETE FROM user_preferences
                        WHERE id NOT IN (
                            SELECT MAX(id)
                            FROM user_preferences
                            GROUP BY user_id
                        )
                        """
                    )
                )
                conn.execute(text("CREATE UNIQUE INDEX ix_user_preferences_user_id ON user_preferences (user_id)"))

    existing_columns = {c["name"] for c in inspector.get_columns("parts")}

    with engine.begin() as conn:
        if "is_active" not in existing_columns:
            conn.execute(text(f"ALTER TABLE parts ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT {bool_true}"))
        if "min_quantity" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN min_quantity INTEGER NOT NULL DEFAULT 0"))
        if "allocated_quantity" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN allocated_quantity INTEGER NOT NULL DEFAULT 0"))
        if "safety_stock" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN safety_stock INTEGER NOT NULL DEFAULT 0"))
        if "lead_time_days" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN lead_time_days INTEGER NOT NULL DEFAULT 7"))
        if "reorder_quantity" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN reorder_quantity INTEGER NOT NULL DEFAULT 0"))
        if "supplier_id" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN supplier_id INTEGER NULL"))
        if "tracking_type" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN tracking_type VARCHAR(20) NOT NULL DEFAULT 'BATCH'"))
        if "barcode_value" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN barcode_value VARCHAR(120) NULL"))
        conn.execute(text("UPDATE parts SET barcode_value = sku WHERE barcode_value IS NULL"))
        if "unit_of_measure" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN unit_of_measure VARCHAR(50) NULL"))
        if "image_url" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN image_url VARCHAR(500) NULL"))
        if "category_id" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN category_id INTEGER NULL"))
        if "location_id" not in existing_columns:
            conn.execute(text("ALTER TABLE parts ADD COLUMN location_id INTEGER NULL"))

    # Create an index for supplier_id if missing (matches SQLAlchemy default name).
    indexes = inspector.get_indexes("parts")
    has_supplier_index = any("supplier_id" in (idx.get("column_names") or []) for idx in indexes)
    has_part_barcode_index = any("barcode_value" in (idx.get("column_names") or []) for idx in indexes)
    has_part_name_index = any("name" in (idx.get("column_names") or []) for idx in indexes)
    if not has_supplier_index:
        with engine.begin() as conn:
            conn.execute(text("CREATE INDEX ix_parts_supplier_id ON parts (supplier_id)"))
    if not has_part_barcode_index:
        with engine.begin() as conn:
            conn.execute(text("CREATE UNIQUE INDEX ix_parts_barcode_value ON parts (barcode_value)"))
    if not has_part_name_index:
        with engine.begin() as conn:
            conn.execute(text("CREATE INDEX ix_parts_name ON parts (name)"))

    # Patch forward item_instances barcode column.
    if inspector.has_table("item_instances"):
        item_instance_columns = {c["name"] for c in inspector.get_columns("item_instances")}
        with engine.begin() as conn:
            if "barcode_value" not in item_instance_columns:
                conn.execute(text("ALTER TABLE item_instances ADD COLUMN barcode_value VARCHAR(120) NULL"))
                conn.execute(text("UPDATE item_instances SET barcode_value = serial_number WHERE barcode_value IS NULL"))
        item_instance_indexes = inspector.get_indexes("item_instances")
        has_item_instance_barcode_index = any("barcode_value" in (idx.get("column_names") or []) for idx in item_instance_indexes)
        if not has_item_instance_barcode_index:
            with engine.begin() as conn:
                conn.execute(text("CREATE UNIQUE INDEX ix_item_instances_barcode_value ON item_instances (barcode_value)"))

    # Patch forward stock_requests approval comment column.
    if inspector.has_table("stock_requests"):
        request_columns = {c["name"] for c in inspector.get_columns("stock_requests")}
        with engine.begin() as conn:
            if "approved_comment" not in request_columns:
                conn.execute(text("ALTER TABLE stock_requests ADD COLUMN approved_comment TEXT NULL"))
            if "closure_type" not in request_columns:
                conn.execute(text("ALTER TABLE stock_requests ADD COLUMN closure_type VARCHAR(20) NULL"))
            if "closed_at" not in request_columns:
                conn.execute(text(f"ALTER TABLE stock_requests ADD COLUMN closed_at {datetime_type} NULL"))

    # Patch forward stock_transactions columns for request workflows.
    if not inspector.has_table("stock_transactions"):
        return

    if inspector.has_table("users"):
        user_columns = {c["name"] for c in inspector.get_columns("users")}
        with engine.begin() as conn:
            if "phone" not in user_columns:
                conn.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(50) NULL"))

    if inspector.has_table("jobs"):
        job_columns = {c["name"] for c in inspector.get_columns("jobs")}
        with engine.begin() as conn:
            if "site_location_label" not in job_columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN site_location_label VARCHAR(255) NULL"))
            if "site_latitude" not in job_columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN site_latitude NUMERIC(9,6) NULL"))
            if "site_longitude" not in job_columns:
                conn.execute(text("ALTER TABLE jobs ADD COLUMN site_longitude NUMERIC(9,6) NULL"))

    if inspector.has_table("outbox_events"):
        outbox_columns = {c["name"] for c in inspector.get_columns("outbox_events")}
        with engine.begin() as conn:
            if "lock_token" not in outbox_columns:
                conn.execute(text("ALTER TABLE outbox_events ADD COLUMN lock_token VARCHAR(120) NULL"))
            if "locked_at" not in outbox_columns:
                conn.execute(text(f"ALTER TABLE outbox_events ADD COLUMN locked_at {datetime_type} NULL"))

    if inspector.has_table("delivery_requests"):
        delivery_columns = {c["name"] for c in inspector.get_columns("delivery_requests")}
        with engine.begin() as conn:
            if "approved_by_user_id" not in delivery_columns:
                conn.execute(text("ALTER TABLE delivery_requests ADD COLUMN approved_by_user_id INTEGER NULL"))
            if "approved_at" not in delivery_columns:
                conn.execute(text(f"ALTER TABLE delivery_requests ADD COLUMN approved_at {datetime_type} NULL"))
            if "rejected_reason" not in delivery_columns:
                conn.execute(text("ALTER TABLE delivery_requests ADD COLUMN rejected_reason TEXT NULL"))

    tx_columns = {c["name"] for c in inspector.get_columns("stock_transactions")}
    with engine.begin() as conn:
        if "request_id" not in tx_columns:
            conn.execute(text("ALTER TABLE stock_transactions ADD COLUMN request_id INTEGER NULL"))
        if "technician_id" not in tx_columns:
            conn.execute(text("ALTER TABLE stock_transactions ADD COLUMN technician_id INTEGER NULL"))
        if "customer_id" not in tx_columns:
            conn.execute(text("ALTER TABLE stock_transactions ADD COLUMN customer_id INTEGER NULL"))
        if "job_id" not in tx_columns:
            conn.execute(text("ALTER TABLE stock_transactions ADD COLUMN job_id INTEGER NULL"))
        if "item_instance_id" not in tx_columns:
            conn.execute(text("ALTER TABLE stock_transactions ADD COLUMN item_instance_id INTEGER NULL"))
        if "movement_type" not in tx_columns:
            conn.execute(text("ALTER TABLE stock_transactions ADD COLUMN movement_type VARCHAR(20) NULL"))
        if "grn_number" not in tx_columns:
            conn.execute(text("ALTER TABLE stock_transactions ADD COLUMN grn_number VARCHAR(60) NULL"))
    tx_indexes = inspector.get_indexes("stock_transactions")
    has_tx_created_at_index = any("created_at" in (idx.get("column_names") or []) for idx in tx_indexes)
    if not has_tx_created_at_index:
        with engine.begin() as conn:
            conn.execute(text("CREATE INDEX ix_stock_transactions_created_at ON stock_transactions (created_at)"))

    # Patch forward usage_records immutable traceability columns.
    if inspector.has_table("usage_records"):
        usage_columns = {c["name"] for c in inspector.get_columns("usage_records")}
        with engine.begin() as conn:
            if "used_at" not in usage_columns:
                conn.execute(text(f"ALTER TABLE usage_records ADD COLUMN used_at {datetime_type} NULL"))
                conn.execute(text("UPDATE usage_records SET used_at = created_at WHERE used_at IS NULL"))
            if "record_hash" not in usage_columns:
                conn.execute(text("ALTER TABLE usage_records ADD COLUMN record_hash VARCHAR(64) NULL"))

    # Patch forward audit_logs tamper-evidence hash chain columns.
    if inspector.has_table("audit_logs"):
        audit_columns = {c["name"] for c in inspector.get_columns("audit_logs")}
        with engine.begin() as conn:
            if "prev_hash" not in audit_columns:
                conn.execute(text("ALTER TABLE audit_logs ADD COLUMN prev_hash VARCHAR(64) NULL"))
            if "entry_hash" not in audit_columns:
                conn.execute(text("ALTER TABLE audit_logs ADD COLUMN entry_hash VARCHAR(64) NULL"))
        audit_indexes = inspector.get_indexes("audit_logs")
        has_audit_created_at_index = any("created_at" in (idx.get("column_names") or []) for idx in audit_indexes)
        has_audit_entry_hash_index = any("entry_hash" in (idx.get("column_names") or []) for idx in audit_indexes)
        if not has_audit_created_at_index:
            with engine.begin() as conn:
                conn.execute(text("CREATE INDEX ix_audit_logs_created_at ON audit_logs (created_at)"))
        if not has_audit_entry_hash_index:
            with engine.begin() as conn:
                conn.execute(text("CREATE INDEX ix_audit_logs_entry_hash ON audit_logs (entry_hash)"))


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
