from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.db import get_db
from app.deps import get_current_user, require_approver, require_roles
from app.event_stream import emit_domain_event
from app.models import User
from app.repositories import InventoryRepository
from app.schemas import BatchUsageCreate, BatchUsageRead, StockRequestCreate, StockRequestRead, UsageRecordCreate, UsageRecordRead
from app.services import RequestService, ServiceError


router = APIRouter(prefix="/api/requests", tags=["requests"])


class IssuedItem(BaseModel):
    item_instance_id: int
    serial_number: str
    barcode_value: str | None = None
    scan_proof_token: str | None = None
    part_id: int
    part_sku: str
    part_name: str
    request_id: int | None
    customer_id: int | None
    job_id: int | None
    status: str
    issued_at: datetime | None = None


class IssuedBatchItemRead(BaseModel):
    issued_batch_id: int
    part_id: int
    part_sku: str
    part_name: str
    quantity_remaining: int
    request_id: int | None
    customer_id: int | None
    job_id: int | None
    issued_at: datetime | None = None


class TechnicianIssuedItemsResponse(BaseModel):
    instances: list[IssuedItem]
    batches: list[IssuedBatchItemRead]


class ReturnRemarkRead(BaseModel):
    id: int
    request_id: int | None = None
    part_id: int
    part_sku: str
    part_name: str
    movement_type: str | None = None
    notes: str
    created_by_email: str | None = None
    created_at: datetime


class RejectPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class NotIssuedPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)


class ApprovePayload(BaseModel):
    comment: str | None = Field(default=None, max_length=1000)


class IssueLine(BaseModel):
    line_id: int
    quantity: int = Field(default=1, ge=1)
    item_instance_ids: list[int] = Field(default_factory=list)


class IssuePayload(BaseModel):
    lines: list[IssueLine]


def _service(db: Session) -> RequestService:
    return RequestService(InventoryRepository(db))


def _handle_service_error(exc: ServiceError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message)


def _can_view_request_values(current_user: User) -> bool:
    role = "technician" if current_user.role == "staff" else (current_user.role or "")
    return role in {"admin", "manager", "store_manager", "approver", "finance"}


def _request_read(request, current_user: User) -> StockRequestRead:
    payload = StockRequestRead.model_validate(request, from_attributes=True).model_dump()
    if request.requested_by:
        payload["requested_by_name"] = request.requested_by.full_name
        payload["requested_by_email"] = request.requested_by.email
    if not _can_view_request_values(current_user):
        payload["total_value"] = None
        for line in payload.get("lines") or []:
            line["unit_cost"] = None
    return StockRequestRead.model_validate(payload)


@router.post(
    "",
    response_model=StockRequestRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_roles("technician", "lead_technician", "store_manager", "manager"))],
)
def create_request(payload: StockRequestCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)) -> StockRequestRead:
    service = _service(db)
    try:
        request = service.create_request(
            current_user=current_user,
            customer_id=payload.customer_id,
            job_id=payload.job_id,
            customer_name=payload.customer_name,
            job_title=payload.job_title,
            lines=[line.model_dump() for line in payload.lines],
        )
    except ServiceError as exc:
        _handle_service_error(exc)
    emit_domain_event(
        db,
        event_type="request.created",
        actor_user_id=current_user.id,
        payload={"request_id": request.id, "status": str(request.status)},
    )
    return _request_read(request, current_user)


@router.get("", response_model=list[StockRequestRead], dependencies=[Depends(get_current_user)])
def list_requests(
    db: Session = Depends(get_db),
    status: str | None = Query(None, max_length=20),
    mine: bool = Query(False),
    current_user: User = Depends(get_current_user),
) -> list[StockRequestRead]:
    service = _service(db)
    requests = service.list_requests(status_value=status, mine=mine, current_user=current_user)
    safe_rows: list[StockRequestRead] = []
    for row in requests:
        try:
            safe_rows.append(_request_read(row, current_user))
        except ValidationError:
            total_value = (
                float(row.total_value)
                if row.total_value is not None and _can_view_request_values(current_user)
                else None
            )
            safe_rows.append(
                StockRequestRead(
                    id=row.id,
                    requested_by_user_id=row.requested_by_user_id,
                    requested_by_name=row.requested_by.full_name if row.requested_by else None,
                    requested_by_email=row.requested_by.email if row.requested_by else None,
                    customer_id=row.customer_id,
                    job_id=row.job_id,
                    status=getattr(row.status, "value", str(row.status)),
                    total_value=total_value,
                    required_approval_role=row.required_approval_role,
                    approved_by_user_id=row.approved_by_user_id,
                    approved_at=row.approved_at,
                    approved_comment=row.approved_comment,
                    rejected_reason=row.rejected_reason,
                    not_issued_reason=getattr(row, "not_issued_reason", None),
                    not_issued_by_user_id=getattr(row, "not_issued_by_user_id", None),
                    not_issued_at=getattr(row, "not_issued_at", None),
                    closure_type=getattr(row, "closure_type", None),
                    closed_at=getattr(row, "closed_at", None),
                    lines=[],
                    created_at=row.created_at,
                    updated_at=row.updated_at,
                )
            )
    return safe_rows


@router.post("/{request_id}/approve", response_model=StockRequestRead, dependencies=[Depends(require_approver)])
def approve_request(
    request_id: int,
    payload: ApprovePayload | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StockRequestRead:
    service = _service(db)
    try:
        request = service.approve_request_with_comment(
            request_id=request_id,
            approver=current_user,
            comment=payload.comment if payload else None,
        )
    except ServiceError as exc:
        _handle_service_error(exc)
    emit_domain_event(
        db,
        event_type="request.approved",
        actor_user_id=current_user.id,
        payload={"request_id": request.id, "status": str(request.status)},
    )
    return _request_read(request, current_user)


@router.post("/{request_id}/reject", response_model=StockRequestRead, dependencies=[Depends(require_approver)])
def reject_request(
    request_id: int,
    payload: RejectPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StockRequestRead:
    service = _service(db)
    try:
        request = service.reject_request(request_id=request_id, approver=current_user, reason=payload.reason)
    except ServiceError as exc:
        _handle_service_error(exc)
    emit_domain_event(
        db,
        event_type="request.rejected",
        actor_user_id=current_user.id,
        payload={"request_id": request.id, "status": str(request.status)},
    )
    return _request_read(request, current_user)


@router.post("/{request_id}/not-issued", response_model=StockRequestRead, dependencies=[Depends(require_roles("store_manager", "manager"))])
def mark_request_not_issued(
    request_id: int,
    payload: NotIssuedPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StockRequestRead:
    service = _service(db)
    try:
        request = service.mark_request_not_issued(request_id=request_id, current_user=current_user, reason=payload.reason)
    except ServiceError as exc:
        _handle_service_error(exc)
    emit_domain_event(
        db,
        event_type="request.not_issued",
        actor_user_id=current_user.id,
        payload={"request_id": request.id, "status": str(request.status)},
    )
    return _request_read(request, current_user)


@router.post("/{request_id}/issue", response_model=StockRequestRead, dependencies=[Depends(require_roles("store_manager", "manager"))])
def issue_request(
    request_id: int,
    payload: IssuePayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> StockRequestRead:
    service = _service(db)
    try:
        request = service.issue_request(
            request_id=request_id,
            current_user=current_user,
            lines=[line.model_dump() for line in payload.lines],
        )
    except ServiceError as exc:
        _handle_service_error(exc)
    emit_domain_event(
        db,
        event_type="request.issued",
        actor_user_id=current_user.id,
        payload={"request_id": request.id, "status": str(request.status)},
    )
    return _request_read(request, current_user)


@router.post("/usage", response_model=UsageRecordRead, dependencies=[Depends(require_roles("technician", "lead_technician"))])
def record_usage(
    payload: UsageRecordCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UsageRecordRead:
    service = _service(db)
    try:
        usage = service.record_usage(
            current_user=current_user,
            item_instance_id=payload.item_instance_id,
            scan_proof_token=payload.scan_proof_token,
            request_id=payload.request_id,
            customer_id=payload.customer_id,
            job_id=payload.job_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
        )
    except ServiceError as exc:
        _handle_service_error(exc)
    emit_domain_event(
        db,
        event_type="usage.recorded",
        actor_user_id=current_user.id,
        payload={"usage_id": usage.id, "item_instance_id": usage.item_instance_id, "request_id": usage.request_id},
    )
    return UsageRecordRead.model_validate(usage, from_attributes=True)


@router.post("/usage/batch", response_model=BatchUsageRead, dependencies=[Depends(require_roles("technician", "lead_technician"))])
def record_batch_usage(
    payload: BatchUsageCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> BatchUsageRead:
    service = _service(db)
    try:
        usage = service.record_batch_usage(
            current_user=current_user,
            part_id=payload.part_id,
            quantity=payload.quantity,
            scan_code=payload.scan_code,
            request_id=payload.request_id,
            customer_id=payload.customer_id,
            job_id=payload.job_id,
            latitude=payload.latitude,
            longitude=payload.longitude,
        )
    except ServiceError as exc:
        _handle_service_error(exc)
    emit_domain_event(
        db,
        event_type="usage.batch_recorded",
        actor_user_id=current_user.id,
        payload={"usage_id": usage.id, "part_id": usage.part_id, "quantity": usage.quantity},
    )
    return BatchUsageRead.model_validate(usage, from_attributes=True)


@router.get(
    "/{request_id}/issued-items",
    response_model=list[IssuedItem],
    dependencies=[Depends(require_roles("technician", "store_manager", "manager", "admin"))],
)
def list_issued_items(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[IssuedItem]:
    service = _service(db)
    try:
        rows = service.list_issued_items_for_request(request_id=request_id, current_user=current_user)
    except ServiceError as exc:
        _handle_service_error(exc)
    return [IssuedItem.model_validate(row) for row in rows]


@router.get(
    "/issued-items/mine",
    response_model=TechnicianIssuedItemsResponse,
    dependencies=[Depends(require_roles("technician", "lead_technician"))],
)
def list_my_issued_items(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> TechnicianIssuedItemsResponse:
    service = _service(db)
    rows = service.list_issued_items_for_technician(current_user=current_user)
    return TechnicianIssuedItemsResponse(
        instances=[IssuedItem.model_validate(row) for row in rows["instances"]],
        batches=[IssuedBatchItemRead.model_validate(row) for row in rows["batches"]],
    )


@router.get(
    "/issued-items/mine/lookup",
    response_model=IssuedItem | None,
    dependencies=[Depends(require_roles("technician", "lead_technician"))],
)
def lookup_my_issued_item(
    serial: str = Query(..., min_length=1, max_length=120),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> IssuedItem | None:
    service = _service(db)
    row = service.find_issued_item_for_technician_by_serial(current_user=current_user, serial=serial)
    if not row:
        return None
    row["scan_proof_token"] = service.build_usage_scan_proof_token(
        current_user=current_user,
        item_instance_id=row["item_instance_id"],
    )
    return IssuedItem.model_validate(row)


@router.get(
    "/returns/mine/remarks",
    response_model=list[ReturnRemarkRead],
    dependencies=[Depends(require_roles("technician", "lead_technician"))],
)
def list_my_return_remarks(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[ReturnRemarkRead]:
    service = _service(db)
    rows = service.list_return_remarks_for_technician(current_user=current_user, limit=limit)
    return [ReturnRemarkRead.model_validate(row) for row in rows]
