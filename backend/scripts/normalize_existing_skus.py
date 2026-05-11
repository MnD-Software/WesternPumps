from __future__ import annotations

import argparse

from sqlalchemy import select

from app.db import SessionLocal, engine, ensure_schema
from app.models import Part
from app.sku import SKU_PREFIX, SKU_WIDTH


def _short_sku(number: int) -> str:
    return f"{SKU_PREFIX}{number:0{SKU_WIDTH}d}"


def main() -> None:
    parser = argparse.ArgumentParser(description="Normalize existing part SKUs to short human-friendly format.")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing to DB")
    args = parser.parse_args()

    ensure_schema(engine)
    db = SessionLocal()
    try:
        parts = db.scalars(select(Part).order_by(Part.id.asc())).all()
        if not parts:
            print("No parts found.")
            return

        used: set[str] = set()
        updates: list[tuple[int, str, str]] = []
        next_num = 1

        for part in parts:
            candidate = _short_sku(next_num)
            while candidate in used:
                next_num += 1
                candidate = _short_sku(next_num)
            used.add(candidate)
            old = str(part.sku or "").strip()
            if old != candidate:
                updates.append((part.id, old, candidate))
                if not args.dry_run:
                    part.sku = candidate
            next_num += 1

        if not args.dry_run and updates:
            db.commit()

        print(f"parts_total={len(parts)}")
        print(f"skus_changed={len(updates)}")
        if updates:
            print("sample_changes:")
            for pid, old, new in updates[:20]:
                print(f"  part_id={pid}: {old} -> {new}")
        if args.dry_run:
            print("mode=dry_run (no database changes applied)")
        else:
            print("mode=apply")
    finally:
        db.close()


if __name__ == "__main__":
    main()

