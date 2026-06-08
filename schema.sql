-- PostgreSQL database dump for WesternPumps
-- Generated schema export from Render PostgreSQL instance
-- Database: westernpumps_bvrn
-- Host: dpg-d8j404eq1p3s73fah45g-a.oregon-postgres.render.com
-- User: westernpumps_bvrn_user

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS public;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';

SET search_path = public, pg_catalog;

--
-- Tables for WesternPumps Application
--

-- Tenants table
CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(100) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    email VARCHAR(255) NOT NULL UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255),
    role VARCHAR(50) NOT NULL DEFAULT 'technician',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    phone VARCHAR(50),
    region VARCHAR(100),
    area_code VARCHAR(50),
    must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS ix_users_email ON users(email);

-- Categories table
CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_categories_tenant_id ON categories(tenant_id);

-- Locations table
CREATE TABLE IF NOT EXISTS locations (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_locations_tenant_id ON locations(tenant_id);

-- Customers table
CREATE TABLE IF NOT EXISTS customers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    capacity_personnel INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_customers_tenant_id ON customers(tenant_id);

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    latitude NUMERIC(9, 6),
    longitude NUMERIC(9, 6),
    driver_name VARCHAR(255),
    capacity_personnel INTEGER,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_suppliers_tenant_id ON suppliers(tenant_id);

-- Parts table
CREATE TABLE IF NOT EXISTS parts (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(120) NOT NULL UNIQUE,
    barcode_value VARCHAR(120),
    description TEXT,
    unit_price NUMERIC(12, 2),
    category_id INTEGER REFERENCES categories(id),
    location_id INTEGER REFERENCES locations(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    tracking_type VARCHAR(20) NOT NULL DEFAULT 'BATCH',
    unit_of_measure VARCHAR(50),
    image_url VARCHAR(500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    min_quantity INTEGER NOT NULL DEFAULT 0,
    allocated_quantity INTEGER NOT NULL DEFAULT 0,
    safety_stock INTEGER NOT NULL DEFAULT 0,
    lead_time_days INTEGER NOT NULL DEFAULT 7,
    reorder_quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_parts_tenant_id ON parts(tenant_id);
CREATE INDEX IF NOT EXISTS ix_parts_supplier_id ON parts(supplier_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_parts_barcode_value ON parts(barcode_value);
CREATE INDEX IF NOT EXISTS ix_parts_name ON parts(name);

-- Part Location Stocks table
CREATE TABLE IF NOT EXISTS part_location_stocks (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    location_id INTEGER NOT NULL REFERENCES locations(id),
    quantity INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(part_id, location_id)
);

CREATE INDEX IF NOT EXISTS ix_part_location_stocks_tenant_id ON part_location_stocks(tenant_id);

-- Jobs table
CREATE TABLE IF NOT EXISTS jobs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    priority VARCHAR(50),
    scheduled_date TIMESTAMP,
    completed_date TIMESTAMP,
    approved_by_user_id INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    approval_notes TEXT,
    site_location_label VARCHAR(255),
    site_latitude NUMERIC(9, 6),
    site_longitude NUMERIC(9, 6),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_jobs_tenant_id ON jobs(tenant_id);
CREATE INDEX IF NOT EXISTS ix_jobs_customer_id ON jobs(customer_id);

-- Purchase Orders table
CREATE TABLE IF NOT EXISTS purchase_orders (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    po_number VARCHAR(100) NOT NULL UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'draft',
    total_amount NUMERIC(12, 2),
    order_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expected_delivery_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_purchase_orders_tenant_id ON purchase_orders(tenant_id);
CREATE INDEX IF NOT EXISTS ix_purchase_orders_supplier_id ON purchase_orders(supplier_id);

-- Purchase Order Lines table
CREATE TABLE IF NOT EXISTS purchase_order_lines (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    quantity_ordered INTEGER NOT NULL,
    quantity_received INTEGER NOT NULL DEFAULT 0,
    unit_price NUMERIC(12, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_purchase_order_lines_tenant_id ON purchase_order_lines(tenant_id);
CREATE INDEX IF NOT EXISTS ix_purchase_order_lines_po_id ON purchase_order_lines(purchase_order_id);

-- Goods Receipt table
CREATE TABLE IF NOT EXISTS goods_receipts (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    purchase_order_id INTEGER REFERENCES purchase_orders(id),
    grn_number VARCHAR(60) NOT NULL UNIQUE,
    receipt_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    received_by INTEGER REFERENCES users(id),
    status VARCHAR(50) NOT NULL DEFAULT 'received',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_goods_receipts_tenant_id ON goods_receipts(tenant_id);
CREATE INDEX IF NOT EXISTS ix_goods_receipts_po_id ON goods_receipts(purchase_order_id);

-- Goods Receipt Lines table
CREATE TABLE IF NOT EXISTS goods_receipt_lines (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    goods_receipt_id INTEGER NOT NULL REFERENCES goods_receipts(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    quantity_received INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_goods_receipt_lines_tenant_id ON goods_receipt_lines(tenant_id);
CREATE INDEX IF NOT EXISTS ix_goods_receipt_lines_gr_id ON goods_receipt_lines(goods_receipt_id);

-- Stock Transfers table
CREATE TABLE IF NOT EXISTS stock_transfers (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    from_location_id INTEGER NOT NULL REFERENCES locations(id),
    to_location_id INTEGER NOT NULL REFERENCES locations(id),
    transfer_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_stock_transfers_tenant_id ON stock_transfers(tenant_id);

-- Stock Transfer Lines table
CREATE TABLE IF NOT EXISTS stock_transfer_lines (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    stock_transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    quantity INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_stock_transfer_lines_tenant_id ON stock_transfer_lines(tenant_id);

-- Stock Reservations table
CREATE TABLE IF NOT EXISTS stock_reservations (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    job_id INTEGER REFERENCES jobs(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    quantity_reserved INTEGER NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'reserved',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_stock_reservations_tenant_id ON stock_reservations(tenant_id);

-- Cycle Counts table
CREATE TABLE IF NOT EXISTS cycle_counts (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    location_id INTEGER NOT NULL REFERENCES locations(id),
    cycle_count_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(50) NOT NULL DEFAULT 'in_progress',
    counted_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_cycle_counts_tenant_id ON cycle_counts(tenant_id);

-- Cycle Count Lines table
CREATE TABLE IF NOT EXISTS cycle_count_lines (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    cycle_count_id INTEGER NOT NULL REFERENCES cycle_counts(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    expected_quantity INTEGER,
    counted_quantity INTEGER,
    variance INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_cycle_count_lines_tenant_id ON cycle_count_lines(tenant_id);

-- Stock Transactions table
CREATE TABLE IF NOT EXISTS stock_transactions (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    location_id INTEGER REFERENCES locations(id),
    transaction_type VARCHAR(50) NOT NULL,
    quantity INTEGER NOT NULL,
    reference_id INTEGER,
    reference_type VARCHAR(50),
    notes TEXT,
    request_id INTEGER,
    technician_id INTEGER REFERENCES users(id),
    customer_id INTEGER REFERENCES customers(id),
    job_id INTEGER REFERENCES jobs(id),
    item_instance_id INTEGER,
    movement_type VARCHAR(20),
    grn_number VARCHAR(60),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_stock_transactions_tenant_id ON stock_transactions(tenant_id);
CREATE INDEX IF NOT EXISTS ix_stock_transactions_created_at ON stock_transactions(created_at);

-- Item Instances table (for serial number tracking)
CREATE TABLE IF NOT EXISTS item_instances (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    serial_number VARCHAR(255) UNIQUE,
    barcode_value VARCHAR(120),
    status VARCHAR(50) NOT NULL DEFAULT 'available',
    location_id INTEGER REFERENCES locations(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_item_instances_tenant_id ON item_instances(tenant_id);
CREATE UNIQUE INDEX IF NOT EXISTS ix_item_instances_barcode_value ON item_instances(barcode_value);

-- Issued Batch Items table
CREATE TABLE IF NOT EXISTS issued_batch_items (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    request_id INTEGER,
    quantity_issued INTEGER NOT NULL,
    quantity_used INTEGER NOT NULL DEFAULT 0,
    quantity_returned_good INTEGER NOT NULL DEFAULT 0,
    quantity_returned_faulty INTEGER NOT NULL DEFAULT 0,
    issued_to_user_id INTEGER REFERENCES users(id),
    issued_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_issued_batch_items_tenant_id ON issued_batch_items(tenant_id);

-- Stock Requests table
CREATE TABLE IF NOT EXISTS stock_requests (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    requested_by INTEGER NOT NULL REFERENCES users(id),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    approval_status VARCHAR(50),
    approved_by INTEGER REFERENCES users(id),
    approved_comment TEXT,
    closure_type VARCHAR(20),
    closed_at TIMESTAMP,
    request_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_stock_requests_tenant_id ON stock_requests(tenant_id);
CREATE INDEX IF NOT EXISTS ix_stock_requests_requested_by ON stock_requests(requested_by);

-- Stock Request Lines table
CREATE TABLE IF NOT EXISTS stock_request_lines (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    stock_request_id INTEGER NOT NULL REFERENCES stock_requests(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    quantity_requested INTEGER NOT NULL,
    quantity_allocated INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_stock_request_lines_tenant_id ON stock_request_lines(tenant_id);

-- Usage Records table
CREATE TABLE IF NOT EXISTS usage_records (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    item_instance_id INTEGER REFERENCES item_instances(id),
    technician_id INTEGER NOT NULL REFERENCES users(id),
    job_id INTEGER REFERENCES jobs(id),
    customer_id INTEGER REFERENCES customers(id),
    quantity_used INTEGER NOT NULL,
    gps_latitude NUMERIC(9, 6),
    gps_longitude NUMERIC(9, 6),
    notes TEXT,
    used_at TIMESTAMP,
    record_hash VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_usage_records_tenant_id ON usage_records(tenant_id);

-- Batch Usage Records table
CREATE TABLE IF NOT EXISTS batch_usage_records (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    issued_batch_item_id INTEGER REFERENCES issued_batch_items(id),
    technician_id INTEGER NOT NULL REFERENCES users(id),
    job_id INTEGER REFERENCES jobs(id),
    quantity_used INTEGER NOT NULL,
    gps_latitude NUMERIC(9, 6),
    gps_longitude NUMERIC(9, 6),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_batch_usage_records_tenant_id ON batch_usage_records(tenant_id);

-- Audit Logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    user_id INTEGER REFERENCES users(id),
    entity_type VARCHAR(100) NOT NULL,
    entity_id INTEGER,
    action VARCHAR(50) NOT NULL,
    changes JSONB,
    prev_hash VARCHAR(64),
    entry_hash VARCHAR(64),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs(created_at);
CREATE INDEX IF NOT EXISTS ix_audit_logs_entry_hash ON audit_logs(entry_hash);

-- Product Attachments table
CREATE TABLE IF NOT EXISTS product_attachments (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    file_name VARCHAR(255) NOT NULL,
    file_url VARCHAR(500),
    file_size INTEGER,
    mime_type VARCHAR(100),
    uploaded_by INTEGER REFERENCES users(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_product_attachments_tenant_id ON product_attachments(tenant_id);

-- User Preferences table
CREATE TABLE IF NOT EXISTS user_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    preferences JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_user_preferences_user_id ON user_preferences(user_id);

-- Technician Zone Assignments table
CREATE TABLE IF NOT EXISTS technician_zone_assignments (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    technician_id INTEGER NOT NULL REFERENCES users(id),
    zone_name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_technician_zone_assignments_tenant_id ON technician_zone_assignments(tenant_id);

-- Part Analysis table
CREATE TABLE IF NOT EXISTS part_analysis (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    analysis_type VARCHAR(100),
    metrics JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_part_analysis_tenant_id ON part_analysis(tenant_id);

-- Demand Forecast table
CREATE TABLE IF NOT EXISTS demand_forecast (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    part_id INTEGER NOT NULL REFERENCES parts(id),
    forecast_period VARCHAR(50),
    forecasted_quantity INTEGER,
    confidence_level NUMERIC(5, 2),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_demand_forecast_tenant_id ON demand_forecast(tenant_id);

-- Pick Wave table
CREATE TABLE IF NOT EXISTS pick_wave (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    wave_number VARCHAR(100) UNIQUE,
    status VARCHAR(50) NOT NULL DEFAULT 'planned',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_pick_wave_tenant_id ON pick_wave(tenant_id);

-- Return Authorization table
CREATE TABLE IF NOT EXISTS return_authorization (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    rma_number VARCHAR(100) UNIQUE,
    part_id INTEGER NOT NULL REFERENCES parts(id),
    reason VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_return_authorization_tenant_id ON return_authorization(tenant_id);

-- Inventory Movement Cost table
CREATE TABLE IF NOT EXISTS inventory_movement_cost (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    transaction_id INTEGER REFERENCES stock_transactions(id),
    cost_amount NUMERIC(12, 2),
    cost_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_inventory_movement_cost_tenant_id ON inventory_movement_cost(tenant_id);

-- Domain Events table
CREATE TABLE IF NOT EXISTS domain_events (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    event_type VARCHAR(100) NOT NULL,
    aggregate_type VARCHAR(100),
    aggregate_id INTEGER,
    event_data JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_domain_events_tenant_id ON domain_events(tenant_id);

-- Outbox Events table
CREATE TABLE IF NOT EXISTS outbox_events (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    event_type VARCHAR(100) NOT NULL,
    event_data JSONB,
    lock_token VARCHAR(120),
    locked_at TIMESTAMP,
    published BOOLEAN NOT NULL DEFAULT FALSE,
    published_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_outbox_events_tenant_id ON outbox_events(tenant_id);

-- Delivery Requests table
CREATE TABLE IF NOT EXISTS delivery_requests (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    delivery_date TIMESTAMP,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    approved_by_user_id INTEGER REFERENCES users(id),
    approved_at TIMESTAMP,
    rejected_reason TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_delivery_requests_tenant_id ON delivery_requests(tenant_id);

-- Technician Labor table
CREATE TABLE IF NOT EXISTS technician_labor (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    technician_id INTEGER NOT NULL REFERENCES users(id),
    job_id INTEGER REFERENCES jobs(id),
    hours_worked NUMERIC(6, 2),
    labor_date TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_technician_labor_tenant_id ON technician_labor(tenant_id);

-- App Settings table
CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
    setting_key VARCHAR(255) NOT NULL UNIQUE,
    setting_value JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_app_settings_tenant_id ON app_settings(tenant_id);

--
-- Name: Default tenant insert; Type: DATA; Schema: public; Owner: -
--

INSERT INTO tenants (id, name, code, is_active, created_at, updated_at)
VALUES (1, 'WesternPumps', 'default', TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT (id) DO NOTHING;

--
-- PostgreSQL database dump complete
--
