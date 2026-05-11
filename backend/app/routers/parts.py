from __future__ import annotations

import io
import uuid

import segno
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel, Field
from reportlab.lib.pagesizes import mm
from reportlab.lib.utils import ImageReader
from reportlab.graphics.barcode import code128
from reportlab.pdfgen import canvas
from sqlalchemy import delete, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.audit import log_audit
from app.deps import get_current_user, require_admin, require_roles
from app.models import BatchUsageRecord, Category, IssuedBatchItem, ItemInstance, Location, Part, PartLocationStock, ProductAttachment, StockRequestLine, StockTransaction, StockTransactionType, Supplier, UsageRecord, User
from app.sku import SKU_PREFIX, SKU_WIDTH, generate_system_sku
from app.schemas import (
    ItemCreate,
    ItemInstanceCreate,
    ItemInstanceRead,
    ItemRead,
    ItemUpdate,
    LocationStockRead,
    LocationStockUpdate,
    PaginatedItems,
    PartCreate,
    ProductAttachmentRead,
    PartRead,
    PartUpdate,
)
from app.system_settings import get_effective_settings


router = APIRouter(prefix="/parts", tags=["parts"])
api_router = APIRouter(prefix="/api", tags=["inventory"])


class DeveloperPurgePayload(BaseModel):
    confirmation: str = Field(min_length=8, max_length=120)
    token: str = Field(min_length=8, max_length=200)


class SkuNormalizeResult(BaseModel):
    total_items: int
    changed: int
    sample: list[dict[str, str | int]]


def _can_view_stock_levels(current_user: User) -> bool:
    role = "technician" if current_user.role == "staff" else current_user.role
    return role in {"admin", "store_manager", "manager"}


def _sanitize_item_for_technician(item: Part) -> ItemRead:
    payload = ItemRead.model_validate(item, from_attributes=True).model_dump()
    payload["quantity_on_hand"] = 0
    payload["min_quantity"] = 0
    payload["unit_price"] = None
    return ItemRead.model_validate(payload)


def _item_qr_payload(item: Part) -> str:
    lines = [
        "WESTERNPUMPS ITEM",
        f"SKU:{item.sku}",
        f"BARCODE:{item.barcode_value or ''}",
        f"NAME:{item.name}",
    ]
    return "\n".join(lines)


def _instance_qr_payload(instance: ItemInstance, item: Part) -> str:
    lines = [
        "WESTERNPUMPS ITEM INSTANCE",
        f"SERIAL:{instance.serial_number}",
        f"BARCODE:{instance.barcode_value or ''}",
        f"SKU:{item.sku}",
        f"NAME:{item.name}",
    ]
    return "\n".join(lines)


def _next_part_barcode(db: Session, sku: str) -> str:
    base = f"WP-P-{(sku or 'ITEM').upper().replace(' ', '-')[:48]}"
    candidate = base
    suffix = 1
    while db.scalar(select(Part.id).where(Part.barcode_value == candidate).limit(1)) is not None:
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate


def _next_instance_barcode(db: Session, serial_number: str) -> str:
    base = f"WP-I-{serial_number.strip().upper().replace(' ', '-')[:48]}"
    candidate = base
    suffix = 1
    while db.scalar(select(ItemInstance.id).where(ItemInstance.barcode_value == candidate).limit(1)) is not None:
        suffix += 1
        candidate = f"{base}-{suffix}"
    return candidate


@router.get("", response_model=list[PartRead], dependencies=[Depends(get_current_user)])
def list_parts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    include_inactive: bool = Query(False),
) -> list[PartRead]:
    stmt = select(Part)
    if not include_inactive:
        stmt = stmt.where(Part.is_active.is_(True))
    parts = db.scalars(stmt.order_by(Part.name.asc())).all()
    if not _can_view_stock_levels(current_user):
        sanitized: list[PartRead] = []
        for p in parts:
            payload = PartRead.model_validate(p, from_attributes=True).model_dump()
            payload["quantity_on_hand"] = 0
            payload["min_quantity"] = 0
            payload["unit_price"] = None
            sanitized.append(PartRead.model_validate(payload))
        return sanitized
    return [PartRead.model_validate(p, from_attributes=True) for p in parts]


@router.post("", response_model=PartRead, dependencies=[Depends(require_roles("store_manager", "manager"))])
def create_part(payload: PartCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> PartRead:
    if payload.tracking_type not in {"BATCH", "INDIVIDUAL"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking_type")
    if payload.supplier_id is not None and not db.get(Supplier, payload.supplier_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid supplier_id")
    if payload.category_id is not None and not db.get(Category, payload.category_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category_id")
    if payload.location_id is not None and not db.get(Location, payload.location_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid location_id")

    data = payload.model_dump()
    image_url = (data.get("image_url") or "").strip()
    data["image_url"] = image_url or None
    data["sku"] = generate_system_sku(db)
    barcode_value = (data.get("barcode_value") or "").strip().upper()
    data["barcode_value"] = barcode_value or _next_part_barcode(db, data["sku"])

    part = Part(**data)
    db.add(part)
    log_audit(db, current_user, "create", "part", detail=payload.model_dump())
    try:
        db.flush()
        if int(part.quantity_on_hand or 0) > 0:
            db.add(
                StockTransaction(
                    part_id=part.id,
                    created_by_user_id=current_user.id if current_user else None,
                    transaction_type=StockTransactionType.IN,
                    quantity_delta=int(part.quantity_on_hand or 0),
                    movement_type="INITIAL_STOCK",
                    notes="Initial stock captured at product creation",
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A unique identifier already exists")
    db.refresh(part)
    return PartRead.model_validate(part, from_attributes=True)


@router.get("/{part_id}", response_model=PartRead, dependencies=[Depends(get_current_user)])
def get_part(part_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> PartRead:
    part = db.get(Part, part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found")
    if not _can_view_stock_levels(current_user):
        payload = PartRead.model_validate(part, from_attributes=True).model_dump()
        payload["quantity_on_hand"] = 0
        payload["min_quantity"] = 0
        payload["unit_price"] = None
        return PartRead.model_validate(payload)
    return PartRead.model_validate(part, from_attributes=True)


@router.patch("/{part_id}", response_model=PartRead, dependencies=[Depends(require_roles("store_manager", "manager"))])
def update_part(part_id: int, payload: PartUpdate, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> PartRead:
    part = db.get(Part, part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found")

    changes = payload.model_dump(exclude_unset=True)
    changes.pop("sku", None)
    if "supplier_id" in changes and changes["supplier_id"] is not None and not db.get(Supplier, changes["supplier_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid supplier_id")
    if "category_id" in changes and changes["category_id"] is not None and not db.get(Category, changes["category_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category_id")
    if "location_id" in changes and changes["location_id"] is not None and not db.get(Location, changes["location_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid location_id")
    if "tracking_type" in changes and changes["tracking_type"] not in {"BATCH", "INDIVIDUAL"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking_type")
    if "barcode_value" in changes and changes["barcode_value"] is not None:
        changes["barcode_value"] = changes["barcode_value"].strip().upper() or None

    for k, v in changes.items():
        setattr(part, k, v)
    log_audit(db, current_user, "update", "part", entity_id=part_id, detail=changes)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A unique identifier already exists")
    db.refresh(part)
    return PartRead.model_validate(part, from_attributes=True)


@router.delete("/{part_id}", status_code=status.HTTP_200_OK, response_class=Response, dependencies=[Depends(require_roles("admin", "store_manager", "manager"))])
def delete_part(part_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> None:
    part = db.get(Part, part_id)
    if not part:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found")
    part.is_active = False
    log_audit(db, current_user, "deactivate", "part", entity_id=part_id)
    db.commit()
    return None


@api_router.get("/items", response_model=PaginatedItems, dependencies=[Depends(get_current_user)])
def list_items(
    db: Session = Depends(get_db),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=1000),
    q: str | None = Query(None, max_length=200),
    sort: str = Query("name", max_length=50),
    direction: str = Query("asc", max_length=4),
    include_inactive: bool = Query(False),
    stock_state: str | None = Query(None, max_length=10),
    category_id: int | None = Query(None, ge=1),
    location_id: int | None = Query(None, ge=1),
    supplier_id: int | None = Query(None, ge=1),
    tracking_type: str | None = Query(None, max_length=20),
    min_unit_price: float | None = Query(None, ge=0),
    max_unit_price: float | None = Query(None, ge=0),
    min_quantity_on_hand: int | None = Query(None, ge=0),
    max_quantity_on_hand: int | None = Query(None, ge=0),
    current_user: User = Depends(get_current_user),
) -> PaginatedItems:
    q_value = q.strip() if q else None

    stmt = select(Part)
    count_stmt = select(func.count()).select_from(Part)
    if not include_inactive:
        stmt = stmt.where(Part.is_active.is_(True))
        count_stmt = count_stmt.where(Part.is_active.is_(True))

    if q_value:
        like = f"%{q_value}%"
        where = or_(Part.sku.like(like), Part.name.like(like))
        stmt = stmt.where(where)
        count_stmt = count_stmt.where(where)

    if stock_state:
        state = stock_state.strip().lower()
        if state == "low":
            where = Part.quantity_on_hand <= Part.min_quantity
        elif state == "in":
            where = Part.quantity_on_hand > 0
        elif state == "out":
            where = Part.quantity_on_hand <= 0
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stock_state. Use low, in, or out.")
        stmt = stmt.where(where)
        count_stmt = count_stmt.where(where)

    if category_id is not None:
        stmt = stmt.where(Part.category_id == category_id)
        count_stmt = count_stmt.where(Part.category_id == category_id)
    if location_id is not None:
        stmt = stmt.where(Part.location_id == location_id)
        count_stmt = count_stmt.where(Part.location_id == location_id)
    if supplier_id is not None:
        stmt = stmt.where(Part.supplier_id == supplier_id)
        count_stmt = count_stmt.where(Part.supplier_id == supplier_id)
    if tracking_type:
        value = tracking_type.strip().upper()
        if value not in {"BATCH", "INDIVIDUAL"}:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking_type filter")
        stmt = stmt.where(Part.tracking_type == value)
        count_stmt = count_stmt.where(Part.tracking_type == value)
    if min_unit_price is not None:
        stmt = stmt.where(func.coalesce(Part.unit_price, 0) >= min_unit_price)
        count_stmt = count_stmt.where(func.coalesce(Part.unit_price, 0) >= min_unit_price)
    if max_unit_price is not None:
        stmt = stmt.where(func.coalesce(Part.unit_price, 0) <= max_unit_price)
        count_stmt = count_stmt.where(func.coalesce(Part.unit_price, 0) <= max_unit_price)
    if min_quantity_on_hand is not None:
        stmt = stmt.where(Part.quantity_on_hand >= min_quantity_on_hand)
        count_stmt = count_stmt.where(Part.quantity_on_hand >= min_quantity_on_hand)
    if max_quantity_on_hand is not None:
        stmt = stmt.where(Part.quantity_on_hand <= max_quantity_on_hand)
        count_stmt = count_stmt.where(Part.quantity_on_hand <= max_quantity_on_hand)

    sort_map = {
        "name": Part.name,
        "sku": Part.sku,
        "quantity_on_hand": Part.quantity_on_hand,
        "min_quantity": Part.min_quantity,
        "created_at": Part.created_at,
        "updated_at": Part.updated_at,
    }
    if sort not in sort_map:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sort field")
    if direction not in {"asc", "desc"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid sort direction")

    order_by = sort_map[sort].asc() if direction == "asc" else sort_map[sort].desc()
    stmt = stmt.order_by(order_by).offset((page - 1) * page_size).limit(page_size)

    total = int(db.scalar(count_stmt) or 0)
    items = db.scalars(stmt).all()

    if _can_view_stock_levels(current_user):
        result_items = [ItemRead.model_validate(p, from_attributes=True) for p in items]
    else:
        result_items = [_sanitize_item_for_technician(p) for p in items]

    return PaginatedItems(items=result_items, page=page, page_size=page_size, total=total)


@api_router.post("/items", response_model=ItemRead, dependencies=[Depends(require_roles("store_manager", "manager"))])
def create_item(payload: ItemCreate, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> ItemRead:
    if payload.tracking_type not in {"BATCH", "INDIVIDUAL"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking_type")
    if payload.supplier_id is not None and not db.get(Supplier, payload.supplier_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid supplier_id")
    if payload.category_id is not None and not db.get(Category, payload.category_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category_id")
    if payload.location_id is not None and not db.get(Location, payload.location_id):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid location_id")

    data = payload.model_dump()
    image_url = (data.get("image_url") or "").strip()
    data["image_url"] = image_url or None
    data["sku"] = generate_system_sku(db)
    barcode_value = (data.get("barcode_value") or "").strip().upper()
    data["barcode_value"] = barcode_value or _next_part_barcode(db, data["sku"])

    item = Part(**data)
    db.add(item)
    log_audit(db, current_user, "create", "item", detail=payload.model_dump())
    try:
        db.flush()
        if int(item.quantity_on_hand or 0) > 0:
            db.add(
                StockTransaction(
                    part_id=item.id,
                    created_by_user_id=current_user.id if current_user else None,
                    transaction_type=StockTransactionType.IN,
                    quantity_delta=int(item.quantity_on_hand or 0),
                    movement_type="INITIAL_STOCK",
                    notes="Initial stock captured at item creation",
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A unique identifier already exists")
    db.refresh(item)
    return ItemRead.model_validate(item, from_attributes=True)


@api_router.put("/items/{item_id}", response_model=ItemRead, dependencies=[Depends(require_roles("store_manager", "manager"))])
def update_item(item_id: int, payload: ItemUpdate, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> ItemRead:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    changes = payload.model_dump(exclude_unset=True)
    changes.pop("sku", None)
    if "supplier_id" in changes and changes["supplier_id"] is not None and not db.get(Supplier, changes["supplier_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid supplier_id")
    if "category_id" in changes and changes["category_id"] is not None and not db.get(Category, changes["category_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid category_id")
    if "location_id" in changes and changes["location_id"] is not None and not db.get(Location, changes["location_id"]):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid location_id")
    if "tracking_type" in changes and changes["tracking_type"] not in {"BATCH", "INDIVIDUAL"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tracking_type")
    if "barcode_value" in changes and changes["barcode_value"] is not None:
        changes["barcode_value"] = changes["barcode_value"].strip().upper() or None

    for k, v in changes.items():
        setattr(item, k, v)
    log_audit(db, current_user, "update", "item", entity_id=item_id, detail=changes)

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A unique identifier already exists")

    db.refresh(item)
    return ItemRead.model_validate(item, from_attributes=True)


@api_router.post(
    "/items/{item_id}/reactivate",
    status_code=status.HTTP_200_OK,
    response_class=Response,
    dependencies=[Depends(require_roles("approver", "store_manager", "manager"))],
)
def reactivate_item(item_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> None:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    item.is_active = True
    log_audit(db, current_user, "reactivate", "item", entity_id=item_id)
    db.commit()
    return None


@api_router.delete(
    "/items/{item_id}",
    status_code=status.HTTP_200_OK,
    response_class=Response,
    dependencies=[Depends(require_roles("approver", "store_manager", "manager"))],
)
def deactivate_item(item_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> None:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    item.is_active = False
    log_audit(db, current_user, "deactivate", "item", entity_id=item_id)
    db.commit()
    return None


@api_router.delete(
    "/items/{item_id}/hard",
    status_code=status.HTTP_200_OK,
    response_class=Response,
    dependencies=[Depends(require_admin)],
)
def hard_delete_item(item_id: int, db: Session = Depends(get_db), current_user=Depends(get_current_user)) -> None:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    has_instances = db.scalar(select(func.count(ItemInstance.id)).where(ItemInstance.part_id == item_id)) or 0
    has_transactions = db.scalar(select(func.count(StockTransaction.id)).where(StockTransaction.part_id == item_id)) or 0
    has_request_lines = db.scalar(select(func.count(StockRequestLine.id)).where(StockRequestLine.part_id == item_id)) or 0
    if int(has_instances) > 0 or int(has_transactions) > 0 or int(has_request_lines) > 0:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Item has related stock history or request lines and cannot be hard-deleted. Deactivate instead.",
        )

    db.delete(item)
    log_audit(db, current_user, "hard_delete", "item", entity_id=item_id)
    db.commit()
    return None


@api_router.post(
    "/items/purge-all",
    dependencies=[Depends(require_admin)],
)
def purge_all_items(
    payload: DeveloperPurgePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict[str, int | str]:
    token = (settings.developer_purge_token or "").strip()
    if token:
        if payload.token.strip() != token:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid developer purge token.")
    elif not settings.disable_auth:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Developer purge token is not configured.",
        )
    if payload.confirmation.strip() != "DELETE ALL PRODUCTS":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='Confirmation must be exactly "DELETE ALL PRODUCTS".')

    part_ids = list(db.scalars(select(Part.id)).all())
    if not part_ids:
        return {
            "message": "No products found",
            "parts_deleted": 0,
            "instances_deleted": 0,
            "transactions_deleted": 0,
            "request_lines_deleted": 0,
        }

    instance_ids = list(db.scalars(select(ItemInstance.id).where(ItemInstance.part_id.in_(part_ids))).all())

    usage_deleted = 0
    if instance_ids:
        usage_deleted = db.execute(delete(UsageRecord).where(UsageRecord.item_instance_id.in_(instance_ids))).rowcount or 0

    batch_usage_deleted = db.execute(delete(BatchUsageRecord).where(BatchUsageRecord.part_id.in_(part_ids))).rowcount or 0
    issued_batch_deleted = db.execute(delete(IssuedBatchItem).where(IssuedBatchItem.part_id.in_(part_ids))).rowcount or 0
    tx_deleted = db.execute(delete(StockTransaction).where(StockTransaction.part_id.in_(part_ids))).rowcount or 0
    attachments_deleted = db.execute(delete(ProductAttachment).where(ProductAttachment.part_id.in_(part_ids))).rowcount or 0
    location_stock_deleted = db.execute(delete(PartLocationStock).where(PartLocationStock.part_id.in_(part_ids))).rowcount or 0
    request_lines_deleted = db.execute(delete(StockRequestLine).where(StockRequestLine.part_id.in_(part_ids))).rowcount or 0
    instances_deleted = db.execute(delete(ItemInstance).where(ItemInstance.part_id.in_(part_ids))).rowcount or 0
    parts_deleted = db.execute(delete(Part).where(Part.id.in_(part_ids))).rowcount or 0

    log_audit(
        db,
        current_user,
        action="purge_all_products",
        entity_type="item",
        detail={
            "parts_deleted": int(parts_deleted),
            "instances_deleted": int(instances_deleted),
            "transactions_deleted": int(tx_deleted),
            "request_lines_deleted": int(request_lines_deleted),
            "usage_deleted": int(usage_deleted),
            "batch_usage_deleted": int(batch_usage_deleted),
            "issued_batch_deleted": int(issued_batch_deleted),
            "attachments_deleted": int(attachments_deleted),
            "location_stock_deleted": int(location_stock_deleted),
        },
    )
    db.commit()

    return {
        "message": "All products purged",
        "parts_deleted": int(parts_deleted),
        "instances_deleted": int(instances_deleted),
        "transactions_deleted": int(tx_deleted),
        "request_lines_deleted": int(request_lines_deleted),
    }


@api_router.post(
    "/items/normalize-skus",
    response_model=SkuNormalizeResult,
    dependencies=[Depends(require_admin)],
)
def normalize_existing_skus(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SkuNormalizeResult:
    parts = db.scalars(select(Part).order_by(Part.id.asc())).all()
    used: set[str] = set()
    next_num = 1
    changed = 0
    sample: list[dict[str, str | int]] = []
    for part in parts:
        candidate = f"{SKU_PREFIX}{next_num:0{SKU_WIDTH}d}"
        while candidate in used:
            next_num += 1
            candidate = f"{SKU_PREFIX}{next_num:0{SKU_WIDTH}d}"
        used.add(candidate)
        old = str(part.sku or "").strip()
        if old != candidate:
            part.sku = candidate
            changed += 1
            if len(sample) < 20:
                sample.append({"part_id": int(part.id), "from": old, "to": candidate})
        next_num += 1
    db.commit()
    log_audit(
        db,
        current_user,
        action="normalize_skus",
        entity_type="item",
        detail={"changed": changed, "total_items": len(parts)},
    )
    return SkuNormalizeResult(total_items=len(parts), changed=changed, sample=sample)


@api_router.get(
    "/items/{item_id}/instances",
    response_model=list[ItemInstanceRead],
    dependencies=[Depends(require_roles("store_manager", "manager"))],
)
def list_item_instances(
    item_id: int,
    db: Session = Depends(get_db),
    status: str | None = Query(None, max_length=20),
) -> list[ItemInstanceRead]:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    stmt = select(ItemInstance).where(ItemInstance.part_id == item_id)
    if status:
        stmt = stmt.where(ItemInstance.status == status)
    instances = db.scalars(stmt.order_by(ItemInstance.created_at.desc())).all()
    return [ItemInstanceRead.model_validate(i, from_attributes=True) for i in instances]


@api_router.get(
    "/items/{item_id}/locations",
    response_model=list[LocationStockRead],
    dependencies=[Depends(require_roles("store_manager", "manager"))],
)
def list_item_locations(item_id: int, db: Session = Depends(get_db)) -> list[LocationStockRead]:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    rows = (
        db.query(PartLocationStock, Location)
        .join(Location, Location.id == PartLocationStock.location_id)
        .filter(PartLocationStock.part_id == item_id)
        .order_by(Location.name.asc())
        .all()
    )
    return [
        LocationStockRead(
            location_id=loc.id,
            location_name=loc.name,
            quantity_on_hand=stock.quantity_on_hand,
        )
        for stock, loc in rows
    ]


@api_router.post(
    "/items/{item_id}/locations",
    response_model=list[LocationStockRead],
    dependencies=[Depends(require_roles("store_manager", "manager"))],
)
def update_item_locations(
    item_id: int,
    payload: list[LocationStockUpdate],
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> list[LocationStockRead]:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    total = 0
    for entry in payload:
        loc = db.get(Location, entry.location_id)
        if not loc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid location_id {entry.location_id}")
        stock = db.scalar(
            select(PartLocationStock)
            .where(PartLocationStock.part_id == item_id, PartLocationStock.location_id == entry.location_id)
            .limit(1)
        )
        if stock:
            stock.quantity_on_hand = entry.quantity_on_hand
        else:
            stock = PartLocationStock(
                part_id=item_id,
                location_id=entry.location_id,
                quantity_on_hand=entry.quantity_on_hand,
            )
            db.add(stock)
        total += entry.quantity_on_hand

    item.quantity_on_hand = total
    log_audit(db, current_user, "update", "item_locations", entity_id=item_id, detail={"locations": [e.model_dump() for e in payload]})
    db.commit()
    return list_item_locations(item_id, db)


@api_router.post(
    "/items/{item_id}/instances",
    response_model=ItemInstanceRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("store_manager", "manager"))],
)
def create_item_instance(
    item_id: int,
    payload: ItemInstanceCreate,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ItemInstanceRead:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if not item.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is inactive")
    if item.tracking_type != "INDIVIDUAL":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is not individually tracked")

    instance = ItemInstance(
        part_id=item_id,
        serial_number=payload.serial_number,
        barcode_value=(payload.barcode_value or "").strip().upper() or _next_instance_barcode(db, payload.serial_number),
        status=payload.status,
        location_id=payload.location_id,
    )
    db.add(instance)
    log_audit(db, current_user, "create", "item_instance", detail=payload.model_dump() | {"part_id": item_id})
    item.quantity_on_hand += 1
    try:
        db.flush()
        db.add(
            StockTransaction(
                part_id=item_id,
                created_by_user_id=current_user.id if current_user else None,
                item_instance_id=instance.id,
                transaction_type=StockTransactionType.IN,
                quantity_delta=1,
                movement_type="RECEIPT_INSTANCE",
                notes=f"Manual instance created: {payload.serial_number}",
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Serial number already exists")
    db.refresh(instance)
    return ItemInstanceRead.model_validate(instance, from_attributes=True)


@api_router.post(
    "/items/{item_id}/instances/bulk",
    response_model=list[ItemInstanceRead],
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("store_manager", "manager"))],
)
def create_item_instances_bulk(
    item_id: int,
    db: Session = Depends(get_db),
    quantity: int = Query(1, ge=1, le=200),
    prefix: str | None = Query(None, max_length=30),
    current_user=Depends(get_current_user),
) -> list[ItemInstanceRead]:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if not item.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is inactive")
    if item.tracking_type != "INDIVIDUAL":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Item is not individually tracked")

    created: list[ItemInstance] = []
    for _ in range(quantity):
        token = uuid.uuid4().hex[:8].upper()
        serial = f"{prefix or item.sku}-{token}"
        created.append(
            ItemInstance(
                part_id=item_id,
                serial_number=serial,
                barcode_value=_next_instance_barcode(db, serial),
                status="AVAILABLE",
                location_id=item.location_id,
            )
        )

    db.add_all(created)
    log_audit(db, current_user, "bulk_create", "item_instance", detail={"part_id": item_id, "quantity": quantity})
    item.quantity_on_hand += quantity
    try:
        db.flush()
        db.add(
            StockTransaction(
                part_id=item_id,
                created_by_user_id=current_user.id if current_user else None,
                transaction_type=StockTransactionType.IN,
                quantity_delta=quantity,
                movement_type="RECEIPT_BULK",
                notes=f"Bulk instance receipt quantity: {quantity}",
            )
        )
        for inst in created:
            db.add(
                StockTransaction(
                    part_id=item_id,
                    created_by_user_id=current_user.id if current_user else None,
                    item_instance_id=inst.id,
                    transaction_type=StockTransactionType.IN,
                    quantity_delta=0,
                    movement_type="RECEIPT_INSTANCE",
                    notes=f"Bulk instance created: {inst.serial_number}",
                )
            )
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Duplicate serial/barcode generated")
    return [ItemInstanceRead.model_validate(i, from_attributes=True) for i in created]


@api_router.get("/items/{item_id}/qr", dependencies=[Depends(get_current_user)])
def get_item_qr(
    item_id: int,
    db: Session = Depends(get_db),
    data: str | None = Query(None, max_length=400),
    scale: int = Query(6, ge=2, le=16),
) -> Response:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    payload = data.strip() if data else _item_qr_payload(item)
    qr = segno.make(payload, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=scale, xmldecl=False, dark="#000000", light="#ffffff", border=2)
    return Response(content=buf.getvalue().decode("utf-8"), media_type="image/svg+xml")


@api_router.get("/items/instances/{instance_id}/qr", dependencies=[Depends(get_current_user)])
def get_instance_qr(
    instance_id: int,
    db: Session = Depends(get_db),
    data: str | None = Query(None, max_length=400),
    scale: int = Query(6, ge=2, le=16),
) -> Response:
    instance = db.get(ItemInstance, instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item instance not found")

    item = db.get(Part, instance.part_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    payload = data.strip() if data else _instance_qr_payload(instance, item)
    qr = segno.make(payload, error="m")
    buf = io.BytesIO()
    qr.save(buf, kind="svg", scale=scale, xmldecl=False, dark="#000000", light="#ffffff", border=2)
    return Response(content=buf.getvalue().decode("utf-8"), media_type="image/svg+xml")


@api_router.get("/items/{item_id}/label.pdf", dependencies=[Depends(get_current_user)])
def get_item_label_pdf(
    item_id: int,
    db: Session = Depends(get_db),
    width_mm: float = Query(50, ge=20, le=120),
    height_mm: float = Query(30, ge=20, le=120),
) -> Response:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    payload = _item_qr_payload(item)
    qr = segno.make(payload, error="m")
    barcode_value = (item.barcode_value or item.sku or str(item.id)).strip().upper()
    svg_buf = io.StringIO()
    qr.save(svg_buf, kind="svg", scale=4, xmldecl=False)

    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width_mm * mm, height_mm * mm))
    c.setFont("Helvetica-Bold", 9)
    c.drawString(6, height_mm * mm - 14, item.sku)
    c.setFont("Helvetica", 7)
    c.drawString(6, height_mm * mm - 24, item.name[:42])
    c.drawString(6, height_mm * mm - 34, f"BARCODE: {barcode_value[:42]}")
    png = io.BytesIO()
    qr.save(png, kind="png", scale=5, border=2, dark="#000000", light="#ffffff")
    png.seek(0)
    c.drawImage(
        ImageReader(png),
        6,
        18,
        width=min(width_mm * mm - 12, height_mm * mm - 30),
        height=min(width_mm * mm - 12, height_mm * mm - 30),
        preserveAspectRatio=True,
        mask="auto",
    )
    barcode = code128.Code128(barcode_value, barHeight=8 * mm, barWidth=0.35)
    barcode.drawOn(c, 6, 4)
    c.showPage()
    c.save()

    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="label-{item.sku}.pdf"'},
    )


@api_router.get("/items/instances/{instance_id}/label.pdf", dependencies=[Depends(get_current_user)])
def get_instance_label_pdf(
    instance_id: int,
    db: Session = Depends(get_db),
    width_mm: float = Query(50, ge=20, le=120),
    height_mm: float = Query(30, ge=20, le=120),
) -> Response:
    instance = db.get(ItemInstance, instance_id)
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item instance not found")
    item = db.get(Part, instance.part_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    payload = _instance_qr_payload(instance, item)
    qr = segno.make(payload, error="m")
    barcode_value = (instance.barcode_value or instance.serial_number).strip().upper()
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=(width_mm * mm, height_mm * mm))
    c.setFont("Helvetica-Bold", 8)
    c.drawString(6, height_mm * mm - 14, instance.serial_number[:40])
    c.setFont("Helvetica", 7)
    c.drawString(6, height_mm * mm - 24, f"{item.sku} - {item.name[:30]}")
    c.drawString(6, height_mm * mm - 34, f"BARCODE: {barcode_value[:42]}")
    png = io.BytesIO()
    qr.save(png, kind="png", scale=5, border=2, dark="#000000", light="#ffffff")
    png.seek(0)
    c.drawImage(
        ImageReader(png),
        6,
        18,
        width=min(width_mm * mm - 12, height_mm * mm - 30),
        height=min(width_mm * mm - 12, height_mm * mm - 30),
        preserveAspectRatio=True,
        mask="auto",
    )
    barcode = code128.Code128(barcode_value, barHeight=8 * mm, barWidth=0.35)
    barcode.drawOn(c, 6, 4)
    c.showPage()
    c.save()

    return Response(
        content=buf.getvalue(),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="label-{instance.serial_number}.pdf"'},
    )


@api_router.get("/items/{item_id}/attachments", response_model=list[ProductAttachmentRead], dependencies=[Depends(get_current_user)])
def list_item_attachments(item_id: int, db: Session = Depends(get_db)) -> list[ProductAttachmentRead]:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    rows = db.scalars(select(ProductAttachment).where(ProductAttachment.part_id == item_id).order_by(ProductAttachment.created_at.desc())).all()
    return [ProductAttachmentRead.model_validate(row, from_attributes=True) for row in rows]


@api_router.post(
    "/items/{item_id}/attachments",
    response_model=ProductAttachmentRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("store_manager", "manager", "lead_technician", "technician"))],
)
async def upload_item_attachment(
    item_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> ProductAttachmentRead:
    item = db.get(Part, item_id)
    if not item:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Empty file")
    if len(content) > 10 * 1024 * 1024:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Attachment exceeds 10MB limit")

    attachment = ProductAttachment(
        part_id=item_id,
        file_name=file.filename or "attachment.bin",
        content_type=file.content_type,
        file_size=len(content),
        file_data=content,
        uploaded_by_user_id=current_user.id if current_user else None,
    )
    db.add(attachment)
    log_audit(db, current_user, "create", "product_attachment", entity_id=item_id, detail={"file_name": attachment.file_name})
    db.commit()
    db.refresh(attachment)
    return ProductAttachmentRead.model_validate(attachment, from_attributes=True)


@api_router.get("/items/{item_id}/attachments/{attachment_id}/download", dependencies=[Depends(get_current_user)])
def download_item_attachment(item_id: int, attachment_id: int, db: Session = Depends(get_db)) -> Response:
    row = db.get(ProductAttachment, attachment_id)
    if not row or row.part_id != item_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    headers = {"Content-Disposition": f'attachment; filename="{row.file_name}"'}
    return Response(content=row.file_data, media_type=row.content_type or "application/octet-stream", headers=headers)


@api_router.delete(
    "/items/{item_id}/attachments/{attachment_id}",
    status_code=status.HTTP_200_OK,
    response_class=Response,
    dependencies=[Depends(require_roles("store_manager", "manager"))],
)
def delete_item_attachment(
    item_id: int,
    attachment_id: int,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
) -> None:
    row = db.get(ProductAttachment, attachment_id)
    if not row or row.part_id != item_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attachment not found")
    db.delete(row)
    log_audit(db, current_user, "delete", "product_attachment", entity_id=item_id, detail={"attachment_id": attachment_id})
    db.commit()
    return None


@api_router.get("/stock/low", response_model=list[ItemRead], dependencies=[Depends(get_current_user)])
def list_low_stock(
    db: Session = Depends(get_db),
    limit: int | None = Query(None, ge=1, le=500),
    q: str | None = Query(None, max_length=200),
    current_user: User = Depends(get_current_user),
) -> list[ItemRead]:
    if limit is None:
        effective = get_effective_settings(db)
        limit = min(max(effective.low_stock_default_limit, 1), 500)
    q_value = q.strip() if q else None

    stmt = select(Part).where(Part.quantity_on_hand <= Part.min_quantity, Part.is_active.is_(True))
    if q_value:
        like = f"%{q_value}%"
        stmt = stmt.where(or_(Part.sku.like(like), Part.name.like(like)))

    items = db.scalars(stmt.order_by(Part.quantity_on_hand.asc()).limit(limit)).all()
    if _can_view_stock_levels(current_user):
        return [ItemRead.model_validate(p, from_attributes=True) for p in items]
    return [_sanitize_item_for_technician(p) for p in items]


# ============================================
# QR Code and Verification Endpoints (Public)
# ============================================


@api_router.get("/parts/{part_id}/qrcode")
def get_part_qrcode(
    part_id: int,
    db: Session = Depends(get_db),
):
    """Generate a QR code for a part that can be scanned by any QR reader."""
    part = db.get(Part, part_id)
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")

    # Generate verification URL
    # Format: https://western-pumps-np2i.vercel.app/verify/{part_id}?sku={sku}
    frontend_base = getattr(settings, 'frontend_base_url', 'https://western-pumps-np2i.vercel.app')
    verify_url = f"{frontend_base.rstrip('/')}/verify/{part_id}?sku={part.sku}"

    # Generate QR code
    qr = segno.make(verify_url)
    buffer = io.BytesIO()
    qr.save(buffer, kind="png", scale=5)
    buffer.seek(0)

    return Response(content=buffer.getvalue(), media_type="image/png")


# Public verification endpoint (no auth required)
@api_router.get("/verify/{part_id}")
def verify_part(
    part_id: int,
    sku: str = "",
    db: Session = Depends(get_db),
):
    """Public endpoint to verify a part belongs to Western Pumps."""
    part = db.get(Part, part_id)
    if not part:
        return {
            "is_valid": False,
            "message": "Item not found in Western Pumps inventory",
            "part_id": part_id,
            "sku": "",
            "name": "",
            "is_active": False,
            "category": None,
            "location": None,
            "quantity_on_hand": 0,
            "unit_price": None,
        }

    # Verify SKU matches
    if sku and part.sku != sku:
        return {
            "is_valid": False,
            "message": "SKU mismatch - this may be a counterfeit item",
            "part_id": part_id,
            "sku": part.sku,
            "name": part.name,
            "is_active": part.is_active,
            "category": part.category.name if part.category else None,
            "location": part.location.name if part.location else None,
            "quantity_on_hand": part.quantity_on_hand,
            "unit_price": part.unit_price,
        }

    return {
        "is_valid": True,
        "message": "Genuine Western Pumps item",
        "part_id": part.id,
        "sku": part.sku,
        "name": part.name,
        "is_active": part.is_active,
        "category": part.category.name if part.category else None,
        "location": part.location.name if part.location else None,
        "quantity_on_hand": part.quantity_on_hand,
        "unit_price": part.unit_price,
    }
