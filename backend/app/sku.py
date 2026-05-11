from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Part


SKU_PREFIX = "WP"
SKU_WIDTH = 3
_LEGACY_PATTERN = re.compile(r"^(?:WPS|WP)-?(\d+)$", re.IGNORECASE)


def _next_system_sku_number(db: Session) -> int:
    rows = db.scalars(select(Part.sku)).all()
    max_num = 0
    for sku in rows:
        value = (sku or "").strip().upper()
        match = _LEGACY_PATTERN.match(value)
        if not match:
            continue
        max_num = max(max_num, int(match.group(1)))
    return max_num + 1


def _format_sku(number: int) -> str:
    return f"{SKU_PREFIX}{number:0{SKU_WIDTH}d}"


def generate_system_sku(db: Session) -> str:
    next_num = _next_system_sku_number(db)
    # Keep SKUs very short and human-friendly for field teams.
    candidate = _format_sku(next_num)
    while db.scalar(select(Part.id).where(Part.sku == candidate).limit(1)) is not None:
        next_num += 1
        candidate = _format_sku(next_num)
    return candidate
