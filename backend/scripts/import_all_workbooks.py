from __future__ import annotations

import argparse
from pathlib import Path

import openpyxl
from sqlalchemy import select

from app.config import settings
from app.db import SessionLocal, engine, ensure_schema
from app.models import User
from app.routers.imports import (
    _import_pricing_inventory,
    _import_store_inventory,
    _import_technician_workbook,
)
from app.security import get_password_hash


DEFAULT_PRICING_PATH = Path(r"C:\Users\Web Design\Downloads\TEMK CONTRACT SPARES  PRICING.xlsx")
DEFAULT_STORE_PATH = Path(r"C:\Users\Web Design\Downloads\Store A.xlsx")
DEFAULT_TECH_PATH = Path(r"C:\Users\Web Design\Downloads\Technicians Details and zones.xlsx")


def _load_wb(path: Path):
    if not path.exists():
        raise FileNotFoundError(f"Workbook not found: {path}")
    return openpyxl.load_workbook(path, read_only=True, data_only=True)


def _ensure_admin_user(db) -> User:
    email = (settings.seed_admin_email or "admin@westernpumps.local").strip().lower()
    password = settings.seed_admin_password or "WesternPumps@2026!"
    full_name = settings.seed_admin_full_name or "System Admin"

    admin = db.scalar(select(User).where(User.email == email).limit(1))
    if admin is None:
        admin = User(
            tenant_id=settings.default_tenant_id,
            email=email,
            full_name=full_name,
            role="admin",
            password_hash=get_password_hash(password),
            is_active=True,
            must_change_password=False,
        )
        db.add(admin)
        db.flush()
    else:
        admin.role = "admin"
        admin.is_active = True
        if not admin.password_hash:
            admin.password_hash = get_password_hash(password)
    return admin


def main() -> None:
    parser = argparse.ArgumentParser(description="Import TEMK pricing, Store A stock, and technician zones workbooks.")
    parser.add_argument("--pricing", default=str(DEFAULT_PRICING_PATH))
    parser.add_argument("--store", default=str(DEFAULT_STORE_PATH))
    parser.add_argument("--technicians", default=str(DEFAULT_TECH_PATH))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    ensure_schema(engine)
    db = SessionLocal()
    try:
        admin = _ensure_admin_user(db)
        db.commit()

        pricing_wb = _load_wb(Path(args.pricing))
        pricing_summary = _import_pricing_inventory(pricing_wb, db, args.dry_run)

        store_wb = _load_wb(Path(args.store))
        store_summary = _import_store_inventory(store_wb, db, admin, args.dry_run)

        tech_wb = _load_wb(Path(args.technicians))
        tech_summary = _import_technician_workbook(tech_wb, db, admin, args.dry_run)

        print("IMPORT COMPLETE")
        print(
            f"pricing created={pricing_summary.created} updated={pricing_summary.updated} "
            f"failed={pricing_summary.failed} skipped={pricing_summary.skipped}"
        )
        print(
            f"store created={store_summary.created} updated={store_summary.updated} "
            f"failed={store_summary.failed} skipped={store_summary.skipped}"
        )
        print(
            f"technicians created_users={tech_summary.created_users} updated_users={tech_summary.updated_users} "
            f"created_zones={tech_summary.created_zones} failed={tech_summary.failed}"
        )
        print(f"admin_login_email={admin.email}")
        if settings.seed_admin_password:
            print("admin_login_password=<from SEED_ADMIN_PASSWORD env>")
        else:
            print("admin_login_password=WesternPumps@2026!")
    finally:
        db.close()


if __name__ == "__main__":
    main()

